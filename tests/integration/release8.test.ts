// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MetadataValidator } from "../../src/validation/metadata-validator.js";

// Build bundles first: .venv/bin/python validator/build_release8.py
// Synthetic regression fixtures; not independently reviewed compliance examples.
describe.skipIf(process.env.TEST_RELEASE8 !== "true").each([
  ["public", "PUBLIC"],
  ["non-public", "NON_PUBLIC"],
  ["restricted", "RESTRICTED"],
])("Release 8 %s offline bundle", (level, access) => {
  it("accepts a complete fixture and detects baseline, access, vocabulary and logical failures", async () => {
    const validator = new MetadataValidator("", fetch, {
      mode: "shacl",
      shapesFile: `validator/release-8/${level}.trig`,
      pythonPath: ".venv/bin/python",
      timeoutMs: 120000,
    });
    const original = await readFile(
      "../national-dispatcher-integration-service-operator-collections/fixtures/gdi-1-corrected.rdf",
      "utf8",
    );
    const rdf = original.replaceAll(
      "access-right/NON_PUBLIC",
      `access-right/${access}`,
    );
    const positive = await validator.validate("positive", rdf);
    expect(
      positive.findings?.filter((finding) => finding.severity === "Violation"),
    ).toEqual([]);
    expect(positive.conforms).toBe(true);
    expect(positive.profile).toMatch(/^local-shacl:sha256:[a-f0-9]{64}$/);

    const invalid = rdf
      .replace(/<dct:title[^>]*>[^<]*<\/dct:title>/g, "")
      .replaceAll(`access-right/${access}`, "access-right/UNKNOWN")
      .replaceAll("data-theme/HEAL", "data-theme/UNKNOWN")
      .replace('XMLSchema#boolean">false', 'XMLSchema#boolean">true');
    const negative = await validator.validate("negative", invalid);
    expect(negative.conforms).toBe(false);
    for (const path of [
      "http://purl.org/dc/terms/title",
      "http://purl.org/dc/terms/accessRights",
      "http://www.w3.org/ns/dcat#theme",
    ]) {
      expect(negative.findings).toContainEqual(
        expect.objectContaining({ severity: "Violation", path }),
      );
    }
    expect(negative.report).toContain(
      "If healthdcatap:hasStructuredData is true",
    );
    expect(negative.findings).toContainEqual(
      expect.objectContaining({
        severity: "Violation",
        constraint: "NodeConstraintComponent",
      }),
    );
  }, 240000);
});
