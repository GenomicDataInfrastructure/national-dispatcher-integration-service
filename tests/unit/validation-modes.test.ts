// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/config.js";
import { MetadataValidator } from "../../src/validation/metadata-validator.js";

const env = {
  DISPATCHER_URL: "https://dispatcher.example",
  DISPATCHER_API_KEY: "key",
  POSTGRES_URL: "postgres://localhost/test",
};
const rdf =
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/"><dcat:Dataset rdf:about="https://example.org/dataset"><dct:title>Example</dct:title></dcat:Dataset></rdf:RDF>';

describe("validation modes and versions", () => {
  it("selects each backend using a single mode and defaults to shacl", () => {
    expect(loadConfig(env).metadataValidatorOptions).toMatchObject({
      mode: "shacl",
    });
    for (const mode of ["shacl", "itb"] as const) {
      expect(
        loadConfig({ ...env, VALIDATION_MODE: mode }).metadataValidatorOptions,
      ).toMatchObject({ mode });
    }
    expect(() => loadConfig({ ...env, VALIDATION_MODE: "api" })).toThrow();
    expect(() => loadConfig({ ...env, VALIDATION_MODE: "simple" })).toThrow();
    expect(() => loadConfig({ ...env, VALIDATION_MODE: "other" })).toThrow();
    expect(() =>
      loadConfig({ ...env, VALIDATION_VERSION: "../release-8" }),
    ).toThrow();
  });
  it("selects versioned shacl shapes without calling the API", async () => {
    const root = await mkdtemp(join(tmpdir(), "validator-version-"));
    try {
      await mkdir(join(root, "test-v1"));
      await copyFile(
        "validator/example-shapes.ttl",
        join(root, "test-v1", "shapes.ttl"),
      );
      const fetchImpl = vi.fn();
      const validator = new MetadataValidator(
        "https://unused.example",
        fetchImpl,
        {
          mode: "shacl",
          version: "test-v1",
          shapesFile: join(root, "{version}", "shapes.ttl"),
          pythonPath: ".venv/bin/python",
        },
      );
      expect(await validator.validate("id", rdf)).toMatchObject({
        conforms: true,
        validationMode: "shacl",
        version: "test-v1",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("uses only the versioned API in api mode", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        "@context": { sh: "http://www.w3.org/ns/shacl#" },
        "@type": "sh:ValidationReport",
        "sh:conforms": true,
      }),
    );
    const validator = new MetadataValidator(
      "https://validator.example/{version}/validate",
      fetchImpl as typeof fetch,
      {
        mode: "itb",
        version: "release-8",
        validationType: "public",
        pythonPath: "/missing/python",
        shapesFile: "/missing/shapes",
      },
    );
    expect(await validator.validate("id", rdf)).toMatchObject({
      conforms: true,
      validationMode: "api",
      version: "release-8",
      profile: "health-dcat-ap:release-8",
      validatorUrl: "https://validator.example/release-8/validate",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://validator.example/release-8/validate",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("rejects version labels that cannot select an actual resource", async () => {
    const fetchImpl = vi.fn();
    for (const mode of ["shacl", "itb"] as const) {
      const validator = new MetadataValidator(
        "https://validator.example/validate",
        fetchImpl,
        {
          mode,
          version: "release-8",
          shapesFile: "validator/example-shapes.ttl",
        },
      );
      await expect(validator.validate("id", rdf)).rejects.toThrow(
        "must contain {version}",
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("fails api validation without falling back to shacl rules", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 }));
    const validator = new MetadataValidator(
      "https://validator.example/validate",
      fetchImpl as typeof fetch,
      {
        mode: "itb",
        profile: "test",
        validationType: "public",
        shapesFile: "validator/example-shapes.ttl",
      },
    );
    await expect(validator.validate("id", rdf)).rejects.toThrow("503");
  });
});

it.each([
  ["PUBLIC", "public"],
  ["NON_PUBLIC", "non-public"],
  ["RESTRICTED", "restricted"],
])(
  "selects the local %s bundle from each dataset's access rights",
  async (right, level) => {
    const root = await mkdtemp(join(tmpdir(), "validator-level-"));
    try {
      await copyFile(
        "validator/example-shapes.ttl",
        join(root, `${level}.ttl`),
      );
      const fetchImpl = vi.fn();
      const validator = new MetadataValidator("", fetchImpl, {
        mode: "shacl",
        shapesFile: join(root, "{accessLevel}.ttl"),
        pythonPath: ".venv/bin/python",
        validationType: "auto",
      });
      const metadata = rdf.replace(
        "</dcat:Dataset>",
        `<dct:accessRights rdf:resource="http://publications.europa.eu/resource/authority/access-right/${right}"/></dcat:Dataset>`,
      );
      expect(await validator.validate("id", metadata)).toMatchObject({
        conforms: true,
        validationType: level,
      });
      await expect(validator.validate("ambiguous", rdf)).rejects.toThrow(
        "Cannot select",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
