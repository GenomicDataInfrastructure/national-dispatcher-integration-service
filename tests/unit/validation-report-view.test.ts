// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { withValidationFindings } from "../../src/api/validation-report-view.js";

const jsonld = {
  "@context": {
    sh: "http://www.w3.org/ns/shacl#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  "@graph": [
    {
      "@type": "sh:ValidationReport",
      "sh:conforms": { "@value": "false", "@type": "xsd:boolean" },
    },
    {
      "@type": "sh:ValidationResult",
      "sh:resultSeverity": { "@id": "sh:Violation" },
      "sh:resultMessage": "Title is required <script>alert(1)</script>",
      "sh:resultPath": { "@id": "http://purl.org/dc/terms/title" },
      "sh:focusNode": { "@id": "https://example.org/dataset" },
      "sh:sourceConstraintComponent": {
        "@id": "sh:MinCountConstraintComponent",
      },
    },
  ],
};

describe("HTML validation report data", () => {
  it("extracts structured findings from existing saved reports without revalidating", async () => {
    const report =
      "Conforms: false\n\nFull SHACL report (JSON-LD):\n" +
      JSON.stringify(jsonld);
    const result = await withValidationFindings({
      datasetId: "dataset-1",
      conforms: false,
      report,
    });
    expect(result.conforms).toBe(false);
    expect(result.report).toBe(report);
    expect(result.findings).toEqual([
      {
        severity: "Violation",
        message: "Title is required <script>alert(1)</script>",
        path: "http://purl.org/dc/terms/title",
        focusNode: "https://example.org/dataset",
        value: "",
        constraint: "MinCountConstraintComponent",
      },
    ]);
  });
  it("uses already structured findings without rewriting them", async () => {
    const findings = [
      {
        severity: "Warning",
        message: "Missing recommended value",
        path: "path",
        focusNode: "node",
        value: "",
        constraint: "constraint",
      },
    ];
    expect((await withValidationFindings({ findings })).findings).toBe(
      findings,
    );
  });
  it.each(["Plain-text report", "Full SHACL report (JSON-LD): broken"])(
    "preserves unrecognised reports as text",
    async (report) => {
      expect(await withValidationFindings({ report })).toEqual({
        report,
        findings: [],
      });
    },
  );
});
