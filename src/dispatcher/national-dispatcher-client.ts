// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { AppConfig } from "../config/config.js";
import type { DeliveryOperation } from "../domain/delivery-status.js";

export class DispatcherError extends Error {
  deliveryContext?: {
    datasetId: string;
    status: string;
    dispatcherDatabaseId: string | null;
    correlationId: string | null;
  };

  constructor(
    message: string,
    public readonly kind:
      "validation" | "timeout" | "network" | "http" | "protocol",
    public readonly statusCode = 502,
  ) {
    super(message);
  }
}

type Verification = {
  operation: DeliveryOperation;
  objectId: string;
  correlationId: string;
  status: "DELIVERED" | "SUCCESS" | "FAILED";
  BusinessError?: {
    errorCode?: string;
    errorDescription?: string;
    errorDetails?: unknown;
  };
};
type TrackingResponse = {
  domibusMessageId?: string | string[];
  dispatcherStatus?: string;
  validationStatus?: string;
  validationInfo?: {
    validationReport?: {
      errorCode?: string;
      errorDescription?: string;
      errorDetails?: unknown;
    };
  };
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type DispatcherResponse = {
  status: number;
  statusText: string;
  ok: boolean;
  body: string;
};

function describeValidationDetails(details: unknown): string | null {
  if (typeof details === "string") return details;
  if (!details || typeof details !== "object") return null;

  const report = details as {
    counters?: { nrOfErrors?: number };
    reports?: { error?: Array<{ description?: string }> };
  };
  const descriptions = report.reports?.error
    ?.map((error) => error.description)
    .filter((description): description is string => Boolean(description));
  if (descriptions?.length) {
    const count = report.counters?.nrOfErrors ?? descriptions.length;
    return `${count} error(s): ${descriptions.join("; ")}`.slice(0, 4000);
  }

  try {
    return JSON.stringify(details).slice(0, 4000);
  } catch {
    return "Structured validation details were returned";
  }
}

export class NationalDispatcherClient {
  constructor(
    private readonly config: AppConfig["dispatcher"],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async create(rdf: string): Promise<string> {
    const response = await this.request("POST", this.datasetUrl(), rdf);
    const body = this.json<{ databaseId?: string }>(response);
    if (!body.databaseId)
      throw new DispatcherError(
        "Dispatcher create response did not include databaseId",
        "protocol",
      );
    return body.databaseId;
  }

  async update(objectId: string, rdf: string): Promise<string | null> {
    const response = await this.request("PUT", this.datasetUrl(objectId), rdf);
    const body = this.optionalJson<{ databaseId?: string }>(response);
    return body?.databaseId ?? null;
  }

  async delete(
    objectId: string,
  ): Promise<{ databaseId: string | null; alreadyGone: boolean }> {
    const response = await this.request(
      "DELETE",
      this.datasetUrl(objectId),
      undefined,
      true,
    );
    if (response.status === 404) return { databaseId: null, alreadyGone: true };
    const body = this.optionalJson<{ databaseId?: string }>(response);
    return { databaseId: body?.databaseId ?? null, alreadyGone: false };
  }

  async track(databaseId: string): Promise<string> {
    const deadline = Date.now() + this.config.verificationTimeoutMs;
    const url = `${this.config.baseUrl}/national-dispatcher/trackOutgoingMessage/byDbId/${encodeURIComponent(databaseId)}`;
    do {
      const body = await this.json<TrackingResponse>(
        await this.request("GET", url),
      );
      if (body.validationStatus === "FAILED") {
        const report = body.validationInfo?.validationReport;
        const details = describeValidationDetails(report?.errorDetails);
        const detail = [report?.errorCode, report?.errorDescription, details]
          .filter(Boolean)
          .join(": ");
        throw new DispatcherError(
          `National Dispatcher rejected RDF validation${detail ? `: ${detail}` : ""}`,
          "validation",
          422,
        );
      }
      if (body.dispatcherStatus === "FAILED") {
        throw new DispatcherError(
          "National Dispatcher failed to dispatch the metadata",
          "http",
        );
      }
      const correlationId = Array.isArray(body.domibusMessageId)
        ? body.domibusMessageId[0]
        : body.domibusMessageId;
      if (correlationId) return correlationId;
      await sleep(this.config.pollIntervalMs);
    } while (Date.now() < deadline);
    throw new DispatcherError(
      `Timed out waiting for dispatcher correlation ID for database ID ${databaseId}`,
      "timeout",
      504,
    );
  }

  async verify(
    correlationId: string,
    operation?: DeliveryOperation,
  ): Promise<string> {
    const deadline = Date.now() + this.config.verificationTimeoutMs;
    const url = `${this.config.baseUrl}/national-dispatcher/incomingVerifications`;
    do {
      const reports = await this.json<Verification[]>(
        await this.request("GET", url),
      );
      const matches = reports.filter(
        (report) =>
          report.correlationId === correlationId &&
          (!operation || report.operation === operation),
      );
      const failed = matches.find((report) => report.status === "FAILED");
      if (failed) {
        const businessError = failed.BusinessError;
        const detail = [
          businessError?.errorCode,
          businessError?.errorDescription,
          describeValidationDetails(businessError?.errorDetails),
        ]
          .filter(Boolean)
          .join(": ");
        throw new DispatcherError(
          `Central Platform reported ${operation ?? "delivery"} failure${detail ? `: ${detail}` : ""}`,
          "http",
          502,
        );
      }
      const success = matches.find((report) => report.status === "SUCCESS");
      if (success) return success.objectId;
      await sleep(this.config.pollIntervalMs);
    } while (Date.now() < deadline);
    throw new DispatcherError(
      `Timed out waiting for dispatcher verification for correlation ID ${correlationId}`,
      "timeout",
      504,
    );
  }

  private datasetUrl(objectId?: string): string {
    const suffix = objectId ? `/${encodeURIComponent(objectId)}` : "";
    const url = new URL(
      `${this.config.baseUrl}/national-dispatcher/datasets${suffix}`,
    );
    url.searchParams.set(
      "disableValidation",
      String(!this.config.validationEnabled),
    );
    return url.toString();
  }

  private async request(
    method: string,
    url: string,
    body?: string,
    allow404 = false,
  ): Promise<DispatcherResponse> {
    const controller = new AbortController();
    let timedOutDuring: "connection" | "request" = "request";
    const connectionTimeout = setTimeout(() => {
      timedOutDuring = "connection";
      controller.abort();
    }, this.config.connectionTimeoutMs);
    const requestTimeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          "X-API-Key": this.config.apiKey,
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/rdf+xml" }),
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
      clearTimeout(connectionTimeout);
      const responseBody = await response.text();
      if (!response.ok && !(allow404 && response.status === 404)) {
        const detail = responseBody.trim().slice(0, 4000);
        const validation = detail.includes("Failed to validate RDF dataset");
        const summary = validation
          ? "National Dispatcher rejected RDF validation"
          : `National Dispatcher returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
        throw new DispatcherError(
          `${summary} (${method} ${url}): ${detail || "Empty response body"}`,
          validation ? "validation" : "http",
          validation ? 422 : 502,
        );
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
      };
    } catch (error) {
      if (error instanceof DispatcherError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new DispatcherError(
          `National Dispatcher ${timedOutDuring} timed out`,
          "timeout",
          504,
        );
      throw new DispatcherError(
        "National Dispatcher network request failed",
        "network",
        502,
      );
    } finally {
      clearTimeout(connectionTimeout);
      clearTimeout(requestTimeout);
    }
  }

  private json<T>(response: DispatcherResponse): T {
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new DispatcherError(
        "National Dispatcher returned invalid JSON",
        "protocol",
      );
    }
  }

  private optionalJson<T>(response: DispatcherResponse): T | null {
    const text = response.body;
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DispatcherError(
        "National Dispatcher returned invalid JSON",
        "protocol",
      );
    }
  }
}
