// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MetadataValidator } from "../../src/validation/metadata-validator.js";

const rdf = (title: string) =>
  `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/"><dcat:Dataset rdf:about="https://example.org/dataset">${title}</dcat:Dataset></rdf:RDF>`;
const local = (extra = {}) =>
  new MetadataValidator("", fetch, {
    mode: "shacl",
    shapesFile: "validator/example-shapes.ttl",
    pythonPath: ".venv/bin/python",
    ...extra,
  });

describe("bundled SHACL validator", () => {
  it("accepts a dataset satisfying the configured rules", async () => {
    const result = await local().validate(
      "valid",
      rdf("<dct:title>Example</dct:title>"),
    );
    expect(result).toMatchObject({
      datasetId: "valid",
      conforms: true,
      findings: [],
    });
    expect(result.profile).toMatch(/^local-shacl:sha256:[a-f0-9]{64}$/);
  });
  it("preserves SHACL violations as structured findings", async () => {
    const result = await local().validate("invalid", rdf(""));
    expect(result.conforms).toBe(false);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        severity: "Violation",
        path: "http://purl.org/dc/terms/title",
      }),
    );
  });
  it("rejects malformed RDF", async () => {
    await expect(local().validate("broken", "<broken")).rejects.toThrow(
      "Local metadata validation failed",
    );
  });
  it("rejects missing datasets rather than passing vacuous constraints", async () => {
    await expect(
      local().validate(
        "empty",
        '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>',
      ),
    ).rejects.toThrow("dcat:Dataset");
  });
  it("requires configured rules", async () => {
    await expect(
      new MetadataValidator("", fetch, { mode: "shacl" }).validate(
        "id",
        rdf(""),
      ),
    ).rejects.toThrow("SHAPES_FILE");
  });
  it("reports a missing Python runtime", async () => {
    await expect(
      local({ pythonPath: "/missing/python" }).validate("id", rdf("")),
    ).rejects.toThrow();
  });
  it("kills validation when the time limit expires", async () => {
    await expect(
      local({ timeoutMs: 1 }).validate("id", rdf("")),
    ).rejects.toThrow("timed out");
  });
});

it.each(["Warning", "Info"])(
  "passes local %s-only findings and keeps them visible",
  async (severity) => {
    const root = await mkdtemp(join(tmpdir(), "warning-shapes-"));
    try {
      const shapes = (
        await readFile("validator/example-shapes.ttl", "utf8")
      ).replace("sh:path", `sh:severity sh:${severity} ; sh:path`);
      const path = join(root, "shapes.ttl");
      await writeFile(path, shapes);
      const result = await local({ shapesFile: path }).validate(
        "warning",
        rdf(""),
      );
      expect(result).toMatchObject({
        conforms: true,
        validatorConforms: false,
      });
      expect(result.findings).toContainEqual(
        expect.objectContaining({ severity }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("keeps a nested violation inside a warning diagnostic rather than blocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "nested-warning-"));
  try {
    const shapesFile = join(root, "shapes.ttl");
    await writeFile(
      shapesFile,
      `
      @prefix sh: <http://www.w3.org/ns/shacl#> .
      @prefix dcat: <http://www.w3.org/ns/dcat#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <urn:dataset> a sh:NodeShape; sh:targetClass dcat:Dataset;
        sh:property [ sh:path dct:title; sh:severity sh:Warning;
          sh:node [ sh:pattern "^Recommended" ] ].
    `,
    );
    const result = await local({ shapesFile }).validate(
      "warning",
      rdf("<dct:title>Example</dct:title>"),
    );
    expect(result).toMatchObject({ conforms: true, validatorConforms: false });
    expect(result.findings).toHaveLength(1);
    expect(result.findings?.[0]?.severity).toBe("Warning");
    expect(result.report).toContain("PatternConstraintComponent");
    await writeFile(
      shapesFile,
      (await readFile(shapesFile, "utf8")) +
        `
      <urn:required> a sh:NodeShape; sh:targetClass dcat:Dataset;
        sh:property [ sh:path dct:description; sh:minCount 1 ].
    `,
    );
    const blocked = await local({ shapesFile }).validate(
      "blocked",
      rdf("<dct:title>Example</dct:title>"),
    );
    expect(blocked.conforms).toBe(false);
    expect(blocked.findings).toContainEqual(
      expect.objectContaining({
        severity: "Violation",
        path: "http://purl.org/dc/terms/description",
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
