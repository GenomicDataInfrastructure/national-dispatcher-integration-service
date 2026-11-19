// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { MetadataValidator } from "../../src/validation/metadata-validator.js";

describe("MetadataValidator", () => {
  const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/"><dcat:Dataset rdf:about="https://example.org/dataset"><dct:accessRights rdf:resource="http://publications.europa.eu/resource/authority/access-right/PUBLIC"/></dcat:Dataset></rdf:RDF>`;
  it("rejects malformed reports rather than assuming conformity", async () => {
    const validator = new MetadataValidator(
      "http://validator",
      vi.fn(async () => Response.json({ conforms: "true" })) as any,
      { mode: "itb" },
    );
    await expect(validator.validate("id", rdf)).rejects.toThrow(
      "invalid SHACL report",
    );
  });
  it("reports validator HTTP failures", async () => {
    const validator = new MetadataValidator(
      "http://validator",
      vi.fn(async () => new Response("", { status: 503 })) as any,
      { mode: "itb" },
    );
    await expect(validator.validate("id", rdf)).rejects.toThrow("503");
  });
});

const endpoint = "https://validator.example/shacl/ehds/api/validate";
const options = {
  mode: "itb" as const,
  profile: "ehds:release-8:managed",
  validationType: "auto" as const,
};
const rdf = (right = "NON_PUBLIC") =>
  `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/"><dcat:Dataset rdf:about="https://example.org/dataset"><dct:accessRights rdf:resource="http://publications.europa.eu/resource/authority/access-right/${right}"/></dcat:Dataset></rdf:RDF>`;
const report = (value: boolean | string) => ({
  "@context": {
    sh: "http://www.w3.org/ns/shacl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  "@graph": [
    {
      "@id": "_:report",
      "@type": "sh:ValidationReport",
      "sh:conforms": { "@value": value, "@type": "xsd:boolean" },
    },
    ...(value === false || value === "false"
      ? [
          {
            "@id": "_:result",
            "@type": "sh:ValidationResult",
            "sh:resultSeverity": { "@id": "sh:Violation" },
            "sh:resultMessage": "Missing mandatory title",
            "sh:focusNode": { "@id": "https://example.org/dataset" },
            "sh:resultPath": { "@id": "http://purl.org/dc/terms/title" },
          },
        ]
      : []),
  ],
});

describe("EHDS ITB API adapter", () => {
  it.each([
    ["PUBLIC", "public"],
    ["NON_PUBLIC", "non-public"],
    ["RESTRICTED", "restricted"],
  ])(
    "selects %s rules using RDF properties, and sends only metadata",
    async (right, validationType) => {
      const fetchImpl = vi.fn(async () => Response.json(report("false")));
      const result = await new MetadataValidator(
        endpoint,
        fetchImpl as any,
        options,
      ).validate("id", rdf(right));
      expect(result).toMatchObject({
        conforms: false,
        profile: options.profile,
        validationType,
        validatorUrl: endpoint,
      });
      expect(result.report).toContain("Missing mandatory title");
      expect(result.findings).toEqual([
        expect.objectContaining({
          severity: "Violation",
          message: "Missing mandatory title",
          path: "http://purl.org/dc/terms/title",
        }),
      ]);
      const request = fetchImpl.mock.calls[0] as any;
      expect(request[1].headers).toEqual({
        "Content-Type": "application/json",
        Accept: "application/ld+json",
      });
      expect(JSON.parse(request[1].body)).toEqual({
        contentToValidate: rdf(right),
        contentSyntax: "application/rdf+xml",
        embeddingMethod: "STRING",
        validationType,
        reportSyntax: "application/ld+json",
      });
    },
  );
  it("accepts explicit validation types for metadata whose access-rights cannot select a profile", async () => {
    const fetchImpl = vi.fn(async () => Response.json(report(true)));
    const result = await new MetadataValidator(endpoint, fetchImpl as any, {
      ...options,
      validationType: "restricted",
    }).validate("id", rdf("UNKNOWN"));
    expect(result.conforms).toBe(true);
    expect(result.validationType).toBe("restricted");
  });
  it("decodes the documented base64 report envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        reportSyntax: "application/ld+json",
        report: Buffer.from(JSON.stringify(report("true"))).toString("base64"),
      }),
    );
    expect(
      (
        await new MetadataValidator(
          endpoint,
          fetchImpl as any,
          options,
        ).validate("id", rdf())
      ).conforms,
    ).toBe(true);
  });
  it("does not assume an access level for unknown metadata", async () => {
    const fetchImpl = vi.fn();
    await expect(
      new MetadataValidator(endpoint, fetchImpl as any, options).validate(
        "id",
        rdf("UNKNOWN"),
      ),
    ).rejects.toThrow("Cannot select");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects malformed XML before submitting it", async () => {
    const fetchImpl = vi.fn();
    await expect(
      new MetadataValidator(endpoint, fetchImpl as any, options).validate(
        "id",
        "<broken",
      ),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    {},
    report("not-a-boolean"),
    {
      "@context": { sh: "http://www.w3.org/ns/shacl#" },
      "@type": "sh:ValidationReport",
      "sh:conforms": "true",
    },
  ])("rejects missing or malformed SHACL verdicts", async (body) => {
    await expect(
      new MetadataValidator(
        endpoint,
        vi.fn(async () => Response.json(body)) as any,
        options,
      ).validate("id", rdf()),
    ).rejects.toThrow();
  });
  it("does not fetch remote contexts while parsing reports", async () => {
    const body = {
      "@context": "https://untrusted.example/context",
      "@type": "ValidationReport",
      conforms: true,
    };
    await expect(
      new MetadataValidator(
        endpoint,
        vi.fn(async () => Response.json(body)) as any,
        options,
      ).validate("id", rdf()),
    ).rejects.toThrow();
  });
});

it("accepts native JSON-LD boolean conformance", async () => {
  const body = {
    "@context": { sh: "http://www.w3.org/ns/shacl#" },
    "@type": "sh:ValidationReport",
    "sh:conforms": true,
  };
  const result = await new MetadataValidator(
    endpoint,
    vi.fn(async () => Response.json(body)) as any,
    options,
  ).validate("id", rdf());
  expect(result.conforms).toBe(true);
});

it("rejects a claimed pass accompanied by SHACL violations", async () => {
  const body = report(false);
  body["@graph"][0]!["sh:conforms"] = {
    "@value": true,
    "@type": "xsd:boolean",
  };
  await expect(
    new MetadataValidator(
      endpoint,
      vi.fn(async () => Response.json(body)) as any,
      options,
    ).validate("id", rdf()),
  ).rejects.toThrow("contradictory");
});

it("validates through an unversioned ITB API without a manual profile", async () => {
  const fetchImpl = vi.fn(async () => Response.json(report(true)));
  const result = await new MetadataValidator(endpoint, fetchImpl as any, {
    mode: "itb",
    validationType: "public",
  }).validate("id", rdf("PUBLIC"));
  expect(result).toMatchObject({
    conforms: true,
    validationMode: "api",
    validatorUrl: endpoint,
  });
  expect(result.profile).toMatch(/^itb-endpoint:sha256:[a-f0-9]{64}$/);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("preserves the API explanation for rejected validation requests", async () => {
  const validator = new MetadataValidator(
    endpoint,
    vi.fn(async () =>
      Response.json(
        { message: "Unable to parse supplied RDF" },
        { status: 422 },
      ),
    ) as any,
    { mode: "itb", validationType: "public" },
  );
  await expect(validator.validate("id", rdf())).rejects.toThrow(
    "Validator returned HTTP 422 (validation type: public): Unable to parse supplied RDF",
  );
});

it("does not include arbitrary HTML in API errors", async () => {
  const validator = new MetadataValidator(
    endpoint,
    vi.fn(
      async () =>
        new Response("<html>request rejected</html>", { status: 422 }),
    ) as any,
    { mode: "itb", validationType: "public" },
  );
  await expect(validator.validate("id", rdf())).rejects.toThrow(
    "Validator returned HTTP 422 (validation type: public)",
  );
});

it.each(["Warning", "Info"])(
  "passes %s-only API results while preserving the original verdict",
  async (severity) => {
    const body = report(false);
    body["@graph"][1]!["sh:resultSeverity"] = { "@id": `sh:${severity}` };
    const validator = new MetadataValidator(
      endpoint,
      vi.fn(async () => Response.json(body)) as any,
      options,
    );
    const result = await validator.validate("id", rdf());
    expect(result).toMatchObject({ conforms: true, validatorConforms: false });
    expect(result.findings?.[0]?.severity).toBe(severity);
    expect(result.report).toContain('"sh:conforms"');
  },
);

it("keeps an unexplained negative API verdict as failed", async () => {
  const body = report(false);
  body["@graph"].splice(1);
  const result = await new MetadataValidator(
    endpoint,
    vi.fn(async () => Response.json(body)) as any,
    options,
  ).validate("id", rdf());
  expect(result).toMatchObject({ conforms: false, validatorConforms: false });
});

it("does not pass API results with unknown severity", async () => {
  const body = report(false);
  body["@graph"][1]!["sh:resultSeverity"] = { "@id": "sh:Unknown" };
  const result = await new MetadataValidator(
    endpoint,
    vi.fn(async () => Response.json(body)) as any,
    options,
  ).validate("id", rdf());
  expect(result.conforms).toBe(false);
});

it("explains HTTP 413 without treating it as a metadata validation result", async () => {
  const validator = new MetadataValidator(
    endpoint,
    vi.fn(
      async () =>
        new Response("<html>413 Request Entity Too Large</html>", {
          status: 413,
        }),
    ) as any,
    { mode: "itb", validationType: "public" },
  );
  await expect(validator.validate("id", rdf())).rejects.toThrow(
    /HTTP 413.*Request payload too large \(\d+ bytes\)/,
  );
});
