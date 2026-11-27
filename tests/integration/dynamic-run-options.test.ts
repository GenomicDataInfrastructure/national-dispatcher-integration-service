// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { buildApp } from "../../src/app.js";
import { createRunResolver } from "../../src/application/resolve-run.js";
import { SyncRunRepository } from "../../src/persistence/postgres/sync-run-repository.js";

const token = "dynamic-run-test-token-at-least-32-characters";
function config() {
  return loadConfig({
    DISPATCHER_URL: "https://dispatcher.example",
    DISPATCHER_API_KEY: "private-key",
    POSTGRES_URL: "postgres://localhost/test",
    CONTROL_API_TOKEN: token,
    DATASET_CATALOGUE_RDF_URL: "https://catalogue.example/catalogue.rdf",
    SYNC_ENABLED: "false",
    OPERATION_MODE: "validate_only",
    VALIDATION_MODE: "shacl",
    METADATA_VALIDATOR_SHAPES_FILE: "validator/example-shapes.ttl",
    METADATA_VALIDATOR_PYTHON: ".venv/bin/python",
    METADATA_VALIDATOR_URL: "https://validator.example/validate",
  });
}
const datasetId = "https://catalogue.example/sample";
const catalogue = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/"><dcat:Catalog rdf:about="https://catalogue.example"><dcat:dataset rdf:resource="${datasetId}"/></dcat:Catalog><dcat:Dataset rdf:about="${datasetId}"><dct:accessRights rdf:resource="http://publications.europa.eu/resource/authority/access-right/PUBLIC"/></dcat:Dataset></rdf:RDF>`;

function setup() {
  const records = new Map<string, any>();
  const runs: any = {
    create: vi.fn(async (runId, mode, sourceSystem, settings) => {
      const run = { runId, mode, sourceSystem, settings, status: "queued" };
      records.set(runId, run);
      return run;
    }),
    get: vi.fn(async (id) => records.get(id)),
    setRunning: vi.fn(),
    withSyncLock: vi.fn(async (work) => {
      await work();
      return true;
    }),
    finish: vi.fn(async (id, status, counts, error, reports) => {
      Object.assign(records.get(id), { status, ...counts, error, reports });
    }),
  };
  const states: any = { forSource: vi.fn() };
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.startsWith("https://validator.example"))
      return Response.json({
        "@context": {
          sh: "http://www.w3.org/ns/shacl#",
          xsd: "http://www.w3.org/2001/XMLSchema#",
        },
        "@graph": [
          {
            "@type": "sh:ValidationReport",
            "sh:conforms": { "@value": true, "@type": "xsd:boolean" },
          },
        ],
      });
    if (target === "https://catalogue.example/catalogue.rdf")
      return new Response(catalogue, {
        headers: { "Content-Type": "application/rdf+xml" },
      });
    throw new Error(`Unexpected external call: ${target}`);
  });
  return { runs, states, fetchImpl };
}

describe("per-run API options", () => {
  it("selects a validator and language per request while using the catalogue source", async () => {
    const { runs, states, fetchImpl } = setup();
    const app = await buildApp(
      config(),
      states,
      fetchImpl as typeof fetch,
      runs,
    );
    try {
      const first = await app.inject({
        method: "POST",
        url: `/api/v1/sync/dataset/${encodeURIComponent(datasetId)}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          operationMode: "validate_only",
          validator: "ehds-api",
          language: "fr-LU",
          validationType: "auto",
        },
      });
      expect(first.statusCode).toBe(202);
      expect(first.json().settings).toMatchObject({
        source: "catalogue",
        validator: "ehds-api",
        validationMode: "api",
        language: "fr-LU",
      });
      await vi.waitFor(() => expect(runs.finish).toHaveBeenCalledTimes(1));
      const saved = (
        await app.inject(`/api/v1/sync/${first.json().runId}`)
      ).json();
      expect(saved.settings).toEqual(first.json().settings);
      expect(saved.reports[0]).toMatchObject({
        sourceSystem: "catalogue",
        validationType: "public",
        conforms: true,
      });
      expect(
        fetchImpl.mock.calls.find(([url]) =>
          String(url).startsWith("https://catalogue.example/"),
        ),
      ).toEqual([
        new URL("https://catalogue.example/catalogue.rdf"),
        expect.objectContaining({
          headers: expect.objectContaining({ "Accept-Language": "fr-LU" }),
        }),
      ]);
      expect(JSON.stringify(saved.settings)).not.toMatch(/https:|\.ttl/);

      const second = await app.inject({
        method: "POST",
        url: `/api/v1/sync/dataset/${encodeURIComponent(datasetId)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.statusCode).toBe(202);
      expect(second.json().settings).toMatchObject({
        source: "catalogue",
        validator: "configured",
        validationMode: "shacl",
        language: "en-GB",
      });
      await vi.waitFor(() => expect(runs.finish).toHaveBeenCalledTimes(2));
      expect(states.forSource).not.toHaveBeenCalled();
      expect(
        fetchImpl.mock.calls.filter(([url]) =>
          String(url).startsWith("https://validator.example"),
        ),
      ).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it.each([
    { source: "catalogue" },
    { source: "unknown" },
    { validator: "unknown" },
    { validatorUrl: "https://caller.example" },
    { shapesFile: "/tmp/untrusted.ttl" },
    { profile: "release-8-approved" },
    { language: "en\r\nInjected: value" },
    { validationVersion: "../rules" },
    { operationMode: "sync_only", validator: "ehds-api" },
    { validator: "release8-local", validationVersion: "release-9" },
  ])(
    "rejects unsupported or conflicting options %j before creating a run",
    async (payload) => {
      const { runs, states, fetchImpl } = setup();
      const app = await buildApp(
        config(),
        states,
        fetchImpl as typeof fetch,
        runs,
      );
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/sync",
          headers: { authorization: `Bearer ${token}` },
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(runs.create).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it("preserves delivery state under the default namespace and ties dispatcher validation to the selected mode", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ databaseId: "database-1" }),
    );
    const resolve = createRunResolver(config(), fetchImpl as typeof fetch);
    for (const operationMode of ["sync_only", "validate_and_sync"] as const) {
      const run = await resolve({ operationMode });
      expect(run.persistenceNamespace).toBe("catalogue");
      await run.dispatcher.create("<rdf/>");
      const url = String(fetchImpl.mock.calls.at(-1)?.[0]);
      expect(new URL(url).searchParams.get("disableValidation")).toBe(
        String(operationMode === "sync_only"),
      );
    }
    expect((await resolve({})).settings).toMatchObject({
      source: "catalogue",
      operationMode: "validate_only",
      validationMode: "shacl",
    });
    const missingCatalogue = config();
    delete missingCatalogue.catalogue;
    await expect(
      createRunResolver(missingCatalogue, fetchImpl as typeof fetch)({}),
    ).rejects.toThrow("DATASET_CATALOGUE_RDF_URL is not configured");
  });

  it("identifies the actual local rules when a caller selects a different installed version", async () => {
    const root = await mkdtemp(join(tmpdir(), "run-version-"));
    try {
      await mkdir(join(root, "v2"));
      await copyFile(
        "validator/example-shapes.ttl",
        join(root, "v2", "shapes.ttl"),
      );
      const configured = config();
      configured.metadataValidatorOptions = {
        mode: "shacl",
        version: "v1",
        profile: "approved-v1-only",
        shapesFile: join(root, "{version}", "shapes.ttl"),
        pythonPath: ".venv/bin/python",
      };
      const resolve = createRunResolver(configured, vi.fn());
      const selected = await resolve({ validationVersion: "v2" });
      expect(selected.settings?.validationVersion).toBe("v2");
      expect(
        (
          await selected.validator!.validate(
            "id",
            `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#"><dcat:Dataset rdf:about="https://example.org/dataset"/></rdf:RDF>`,
          )
        ).profile,
      ).toMatch(/^local-shacl:sha256:/);
      await expect(
        resolve({ validationVersion: "uninstalled" }),
      ).rejects.toThrow("unavailable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves saved run settings", async () => {
    const row = {
      run_id: "id",
      mode: "validate_only",
      source_system: "catalogue",
      reports: [],
      settings: {
        source: "catalogue",
        operationMode: "validate_only",
        language: "en",
      },
    };
    const pool: any = { query: vi.fn(async () => ({ rows: [row] })) };
    const repository = new SyncRunRepository(pool, "dataset_delivery");
    const run = await repository.create(
      "id",
      "validate_only",
      "catalogue",
      row.settings as any,
    );
    expect(run.settings).toEqual(row.settings);
    expect(pool.query.mock.calls[0][1][3]).toBe(JSON.stringify(row.settings));
    pool.query.mockResolvedValueOnce({ rows: [{ ...row, settings: null }] });
    expect((await repository.get("id"))?.settings).toBeUndefined();
  });
});
