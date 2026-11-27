// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  DispatcherError,
  NationalDispatcherClient,
} from "../../src/dispatcher/national-dispatcher-client.js";

const config = {
  baseUrl: "https://dispatcher.example",
  apiKey: "secret",
  validationEnabled: true,
  connectionTimeoutMs: 100,
  requestTimeoutMs: 100,
  verificationTimeoutMs: 50,
  pollIntervalMs: 1,
};

describe("NationalDispatcherClient", () => {
  it("forwards RDF with server-side credentials", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ databaseId: "db-1" }), { status: 202 }),
    );
    const client = new NationalDispatcherClient(config, fetchMock as any);
    await expect(client.create("<rdf />")).resolves.toBe("db-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dispatcher.example/national-dispatcher/datasets?disableValidation=false",
      expect.objectContaining({
        method: "POST",
        body: "<rdf />",
        headers: {
          "Content-Type": "application/rdf+xml",
          "X-API-Key": "secret",
        },
      }),
    );
  });
  it("normalizes dispatcher validation failures", async () => {
    const client = new NationalDispatcherClient(
      config,
      vi.fn(
        async () =>
          new Response("Failed to validate RDF dataset", { status: 500 }),
      ) as any,
    );
    await expect(client.create("bad")).rejects.toMatchObject({
      kind: "validation",
      statusCode: 422,
    });
  });
  it.each([
    ['{"message":"Route not found"}', '{"message":"Route not found"}'],
    ["", "Empty response body"],
    ["x".repeat(5000), "x".repeat(4000)],
  ])(
    "includes request context and bounded HTTP response details",
    async (body, detail) => {
      const client = new NationalDispatcherClient(
        config,
        vi.fn(
          async () =>
            new Response(body, { status: 404, statusText: "Not Found" }),
        ) as any,
      );
      await expect(client.create("rdf")).rejects.toMatchObject({
        kind: "http",
        statusCode: 502,
        message: `National Dispatcher returned HTTP 404 Not Found (POST https://dispatcher.example/national-dispatcher/datasets?disableValidation=false): ${detail}`,
      });
    },
  );
  it("normalizes network failures without leaking details", async () => {
    const client = new NationalDispatcherClient(
      config,
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND secret-host");
      }) as any,
    );
    await expect(client.create("rdf")).rejects.toEqual(
      expect.objectContaining<Partial<DispatcherError>>({
        kind: "network",
        message: "National Dispatcher network request failed",
      }),
    );
  });
  it("aborts dispatcher requests at the request timeout", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = new NationalDispatcherClient(
      { ...config, requestTimeoutMs: 1 },
      fetchMock as any,
    );
    await expect(client.create("rdf")).rejects.toMatchObject({
      kind: "timeout",
      statusCode: 504,
    });
  });
  it("tracks and verifies delivery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domibusMessageId: ["corr-1"],
            domibusStatus: "ACKNOWLEDGED",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              operation: "create",
              objectId: "central-1",
              correlationId: "corr-1",
              status: "SUCCESS",
            },
          ]),
        ),
      );
    const client = new NationalDispatcherClient(config, fetchMock as any);
    const correlation = await client.track("db-1");
    await expect(client.verify(correlation, "create")).resolves.toBe(
      "central-1",
    );
  });

  it("polls through missing and retrying Domibus statuses until acknowledged", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ domibusMessageId: ["corr-1"] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domibusMessageId: ["corr-1"],
            domibusStatus: "WAITING_FOR_RETRY",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domibusMessageId: ["corr-1"],
            domibusStatus: "ACKNOWLEDGED_WITH_WARNING",
          }),
        ),
      );
    const client = new NationalDispatcherClient(config, fetchMock as any);
    const statuses: string[] = [];

    await expect(
      client.track("db-1", async (status) => {
        statuses.push(status);
      }),
    ).resolves.toBe("corr-1");
    expect(statuses).toEqual([
      "WAITING_FOR_RETRY",
      "ACKNOWLEDGED_WITH_WARNING",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports each Domibus status only when it changes", async () => {
    const waiting = () =>
      new Response(
        JSON.stringify({
          domibusMessageId: ["corr-1"],
          domibusStatus: "WAITING_FOR_RECEIPT",
        }),
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(waiting())
      .mockResolvedValueOnce(waiting())
      .mockResolvedValueOnce(waiting())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            domibusMessageId: ["corr-1"],
            domibusStatus: "ACKNOWLEDGED",
          }),
        ),
      );
    const client = new NationalDispatcherClient(config, fetchMock as any);
    const statuses: string[] = [];

    await client.track("db-1", async (status) => {
      statuses.push(status);
    });

    expect(statuses).toEqual(["WAITING_FOR_RECEIPT", "ACKNOWLEDGED"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["SEND_FAILURE", "NOT_FOUND", "DELETED"] as const)(
    "stops tracking on terminal Domibus status %s",
    async (domibusStatus) => {
      const client = new NationalDispatcherClient(
        config,
        vi.fn(
          async () => new Response(JSON.stringify({ domibusStatus })),
        ) as any,
      );

      await expect(client.track("db-1")).rejects.toMatchObject({
        domibusStatus,
      });
    },
  );

  it("surfaces Central Platform business error details", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              operation: "create",
              objectId: "",
              correlationId: "corr-1",
              status: "FAILED",
              BusinessError: {
                errorCode: "ERR_HD_0101",
                errorDescription: "Invalid or missing fields",
                errorDetails: {
                  counters: { nrOfErrors: 1 },
                  reports: {
                    error: [{ description: "Missing language type" }],
                  },
                },
              },
            },
          ]),
        ),
    );
    const client = new NationalDispatcherClient(config, fetchMock as any);

    await expect(client.verify("corr-1", "create")).rejects.toMatchObject({
      kind: "http",
      statusCode: 502,
      message:
        "Central Platform reported create failure: ERR_HD_0101: Invalid or missing fields: 1 error(s): Missing language type",
    });
  });

  it("surfaces asynchronous dispatcher validation failures", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            dispatcherStatus: "ONGOING",
            validationStatus: "FAILED",
            validationInfo: {
              validationReport: {
                errorCode: "ERR_HD_0102",
                errorDescription: "Unexpected characters",
                errorDetails: {
                  counters: { nrOfErrors: 1 },
                  reports: {
                    error: [{ description: "Missing required title" }],
                  },
                },
              },
            },
          }),
        ),
    );
    const client = new NationalDispatcherClient(config, fetchMock as any);

    await expect(client.track("db-1")).rejects.toMatchObject({
      kind: "validation",
      statusCode: 422,
      message:
        "National Dispatcher rejected RDF validation: ERR_HD_0102: Unexpected characters: 1 error(s): Missing required title",
    });
  });
});
