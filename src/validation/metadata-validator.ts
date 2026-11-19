// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { applySeverityPolicy } from "./severity-policy.js";
import { createHash } from "node:crypto";
import { validateLocally } from "./local-validator.js";
import jsonld from "jsonld";
import type { ValidationFinding } from "../domain/validation-finding.js";
import { RdfXmlParser } from "rdfxml-streaming-parser";
import type { ValidationType } from "../domain/validation.js";
import { EXTERNAL_VALIDATOR_DEFAULT_TIMEOUT_MS } from "../config/config.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DCAT_DATASET = "http://www.w3.org/ns/dcat#Dataset";
const DCT_ACCESS_RIGHTS = "http://purl.org/dc/terms/accessRights";
const ACCESS_RIGHT_LEVELS = {
  "http://publications.europa.eu/resource/authority/access-right/PUBLIC":
    "public",
  "http://publications.europa.eu/resource/authority/access-right/NON_PUBLIC":
    "non-public",
  "http://publications.europa.eu/resource/authority/access-right/RESTRICTED":
    "restricted",
} as const;

export type ValidationResult = {
  datasetId: string;
  validationMode?: "shacl" | "api";
  version?: string;
  conforms: boolean;
  validatorConforms?: boolean;
  profile: string;
  report: string;
  validationType?: string;
  validatorUrl?: string;
  findings?: ValidationFinding[];
};

export type ValidatorOptions = {
  mode?: "shacl" | "itb";
  version?: string;
  shapesFile?: string;
  pythonPath?: string;
  validationType?: ValidationType;
  profile?: string;
  timeoutMs?: number;
};
const SH = "http://www.w3.org/ns/shacl#";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

async function accessLevel(rdf: string): Promise<string> {
  const parser = new RdfXmlParser();
  parser.end(rdf);
  const datasetIds = new Set<string>();
  const rights = new Map<string, Set<string>>();
  for await (const quad of parser) {
    if (quad.predicate.value === RDF_TYPE && quad.object.value === DCAT_DATASET)
      datasetIds.add(quad.subject.value);
    if (
      quad.predicate.value === DCT_ACCESS_RIGHTS &&
      quad.object.termType === "NamedNode"
    ) {
      const values = rights.get(quad.subject.value) ?? new Set<string>();
      values.add(quad.object.value);
      rights.set(quad.subject.value, values);
    }
  }
  if (datasetIds.size !== 1)
    throw new Error(
      "Automatic validation type requires exactly one dcat:Dataset",
    );
  const values = rights.get([...datasetIds][0]!);
  if (
    values?.size !== 1 ||
    !ACCESS_RIGHT_LEVELS[[...values][0]! as keyof typeof ACCESS_RIGHT_LEVELS]
  )
    throw new Error(
      "Cannot select EHDS validation type: dataset must declare one PUBLIC, NON_PUBLIC or RESTRICTED dct:accessRights IRI; configure an explicit validation type if needed",
    );
  return ACCESS_RIGHT_LEVELS[
    [...values][0]! as keyof typeof ACCESS_RIGHT_LEVELS
  ];
}

export async function parseItbReport(body: unknown) {
  // The API returns JSON-LD directly when that report syntax is requested.
  // Some ITB deployments instead return the documented base64 report envelope.
  let document = body;
  if (body && typeof body === "object" && "report" in body) {
    const envelope = body as Record<string, unknown>;
    if (
      envelope.reportSyntax !== "application/ld+json" ||
      typeof envelope.report !== "string"
    )
      throw new Error("Validator returned an unsupported report envelope");
    document = JSON.parse(
      Buffer.from(envelope.report, "base64").toString("utf8"),
    );
  }
  const nodes = (await jsonld.expand(document as jsonld.JsonLdDocument, {
    documentLoader: async () => {
      throw new Error(
        "Remote JSON-LD contexts are not supported in validation reports",
      );
    },
  })) as Array<Record<string, unknown>>;
  const reports = nodes.filter(
    (node) =>
      Array.isArray(node["@type"]) &&
      node["@type"].includes(SH + "ValidationReport"),
  );
  if (reports.length !== 1)
    throw new Error(
      "Validator returned an invalid SHACL report: expected one ValidationReport",
    );
  const values = reports[0]![SH + "conforms"] as
    Array<Record<string, unknown>> | undefined;
  const value = values?.[0];
  const rawValue = value?.["@value"];
  const validBoolean =
    value?.["@type"] === XSD_BOOLEAN
      ? [true, false, "true", "false", "1", "0"].includes(
          rawValue as string | boolean,
        )
      : value?.["@type"] === undefined && typeof rawValue === "boolean";
  if (values?.length !== 1 || !validBoolean)
    throw new Error("Validator returned an invalid SHACL conformance value");
  const conforms = [true, "true", "1"].includes(rawValue as string | boolean);
  const text = (node: Record<string, unknown>, property: string) => {
    const entries = node[SH + property] as
      Array<Record<string, unknown>> | undefined;
    return (
      entries
        ?.map((entry) => String(entry["@value"] ?? entry["@id"] ?? ""))
        .join("; ") ?? ""
    );
  };
  const results = nodes.filter(
    (node) =>
      Array.isArray(node["@type"]) &&
      node["@type"].includes(SH + "ValidationResult"),
  );
  // Refuse contradictory data rather than turning a malformed result into a pass.
  if (
    conforms &&
    results.some((node) => text(node, "resultSeverity") === SH + "Violation")
  )
    throw new Error("Validator returned contradictory SHACL results");
  const findings: ValidationFinding[] = results.map((node) => ({
    severity: text(node, "resultSeverity").replace(SH, ""),
    message: text(node, "resultMessage"),
    focusNode: text(node, "focusNode"),
    path: text(node, "resultPath"),
    value: text(node, "value"),
    constraint: text(node, "sourceConstraintComponent").replace(SH, ""),
  }));
  const outcome = applySeverityPolicy(conforms, findings);
  return {
    ...outcome,
    findings,
    report: [
      `Passed severity policy: ${outcome.conforms}`,
      `Validator conforms: ${conforms}`,
      `Reported findings: ${results.length}`,
      ...results.map((node) =>
        [
          text(node, "resultSeverity").replace(SH, ""),
          text(node, "resultMessage"),
          `Focus: ${text(node, "focusNode")}`,
          `Path: ${text(node, "resultPath")}`,
        ].join("\n"),
      ),
      "Full SHACL report (JSON-LD):",
      JSON.stringify(document, null, 2),
    ].join("\n\n"),
  };
}

export class MetadataValidator {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: ValidatorOptions = {},
  ) {}

  async validate(datasetId: string, rdf: string): Promise<ValidationResult> {
    const mode = this.options.mode ?? "shacl";
    const version = this.options.version;
    const evidence =
      this.options.mode || version
        ? {
            validationMode:
              mode === "shacl" ? ("shacl" as const) : ("api" as const),
            ...(version ? { version } : {}),
          }
        : {};
    const selectVersion = (template: string, name: string) => {
      if (version && !template.includes("{version}"))
        throw new Error(
          `${name} must contain {version} when VALIDATION_VERSION is configured`,
        );
      if (template.includes("{version}") && !version)
        throw new Error(
          "VALIDATION_VERSION is required for versioned validation resources",
        );
      return template.replaceAll("{version}", version ?? "");
    };
    if (mode === "shacl") {
      const shapesTemplate = selectVersion(
        this.options.shapesFile ?? "",
        "METADATA_VALIDATOR_SHAPES_FILE",
      );
      const validationType = shapesTemplate.includes("{accessLevel}")
        ? this.options.validationType && this.options.validationType !== "auto"
          ? this.options.validationType
          : await accessLevel(rdf)
        : undefined;
      const shapesFile = validationType
        ? shapesTemplate.replaceAll("{accessLevel}", validationType)
        : shapesTemplate;
      return {
        ...(await validateLocally(datasetId, rdf, {
          ...this.options,
          shapesFile,
        })),
        ...(validationType ? { validationType } : {}),
        ...evidence,
      };
    }
    if (!this.url)
      throw new Error("METADATA_VALIDATOR_URL is required for api validation");
    const url = selectVersion(this.url, "METADATA_VALIDATOR_URL");
    const validationType =
      this.options.validationType && this.options.validationType !== "auto"
        ? this.options.validationType
        : await accessLevel(rdf);
    const requestBody = JSON.stringify({
      contentToValidate: rdf,
      contentSyntax: "application/rdf+xml",
      embeddingMethod: "STRING",
      validationType,
      reportSyntax: "application/ld+json",
    });
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/ld+json",
      },
      body: requestBody,
      signal: AbortSignal.timeout(
        this.options.timeoutMs ?? EXTERNAL_VALIDATOR_DEFAULT_TIMEOUT_MS,
      ),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const failure: unknown = await response.json();
        if (failure && typeof failure === "object") {
          const fields = failure as Record<string, unknown>;
          const message = [
            fields.detail,
            fields.message,
            fields.error,
            fields.title,
          ].find((value) => typeof value === "string" && value.trim());
          if (typeof message === "string")
            detail = message.replace(/[\r\n\t]+/g, " ").slice(0, 1000);
        }
      } catch {
        // Do not save arbitrary HTML or echoed request bodies in error reports.
      }
      if (response.status === 413) {
        const explanation = `Request payload too large (${Buffer.byteLength(requestBody, "utf8")} bytes). The validator or its gateway rejected the request before validation could complete.`;
        detail = detail ? `${explanation} ${detail}` : explanation;
      }
      throw new Error(
        `Validator returned HTTP ${response.status}${validationType ? ` (validation type: ${validationType})` : ""}${detail ? `: ${detail}` : ""}`,
      );
    }
    const body: unknown = await response.json();
    return {
      datasetId,
      ...(await parseItbReport(body)),
      profile:
        this.options.profile ??
        (version
          ? `health-dcat-ap:${version}`
          : `itb-endpoint:sha256:${createHash("sha256").update(url).digest("hex")}`),
      ...evidence,
      validationType,
      validatorUrl: url,
    };
  }
}
