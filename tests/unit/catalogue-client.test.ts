// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vitest";
import { CatalogueClient } from "../../src/catalogue/catalogue-client.js";

const catalogue = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#"><dcat:Catalog rdf:about="https://example/catalog"><dcat:dataset rdf:resource="https://example/a"/></dcat:Catalog><dcat:Dataset rdf:about="https://example/a"/></rdf:RDF>`;
const config = {
  url: "https://example/catalog.rdf",
  acceptLanguage: "en-GB",
  requestTimeoutMs: 100,
};

it("reads the complete catalogue for list and single-dataset operations", async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(catalogue, {
        headers: { "Content-Type": "application/rdf+xml" },
      }),
  );
  const client = new CatalogueClient(config, fetchImpl);
  expect(await client.listDatasets()).toMatchObject([
    { datasetId: "https://example/a" },
  ]);
  expect(
    await client.listDeletedDatasetIds([
      "https://example/a",
      "https://example/removed",
    ]),
  ).toEqual(["https://example/removed"]);
  expect(await client.getDataset("https://example/a")).toMatchObject({
    datasetId: "https://example/a",
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl).toHaveBeenCalledWith(
    new URL(config.url),
    expect.objectContaining({
      headers: {
        Accept: "application/rdf+xml",
        "Accept-Language": "en-GB",
      },
    }),
  );
});

it("rejects invalid or incomplete catalogues before deletion reconciliation", async () => {
  const invalid = new CatalogueClient(
    config,
    vi.fn(
      async () =>
        new Response("<broken>", {
          headers: { "Content-Type": "application/rdf+xml" },
        }),
    ),
  );
  await expect(
    invalid.listDeletedDatasetIds(["https://example/known"]),
  ).rejects.toThrow("Invalid RDF catalogue");

  const referenceOnly = new CatalogueClient(
    config,
    vi.fn(
      async () =>
        new Response(
          `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#"><dcat:Catalog rdf:about="https://example/catalog"><dcat:dataset rdf:resource="https://example/missing"/></dcat:Catalog></rdf:RDF>`,
          { headers: { "Content-Type": "application/rdf+xml" } },
        ),
    ),
  );
  await expect(referenceOnly.listDatasets()).rejects.toThrow(
    "no embedded dataset metadata",
  );
});

it("reports missing datasets and rejects unsuccessful requests", async () => {
  const missing = new CatalogueClient(
    config,
    vi.fn(
      async () =>
        new Response(catalogue, {
          headers: { "Content-Type": "application/rdf+xml" },
        }),
    ),
  );
  await expect(
    missing.getDataset("https://example/missing"),
  ).rejects.toMatchObject({
    statusCode: 404,
  });

  const unavailable = new CatalogueClient(
    config,
    vi.fn(async () => new Response("unavailable", { status: 503 })),
  );
  await expect(unavailable.listDatasets()).rejects.toMatchObject({
    kind: "http",
    statusCode: 502,
  });
});
