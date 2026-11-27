// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { expect, it, vi } from "vitest";
import { RdfXmlParser } from "rdfxml-streaming-parser";
import { CatalogueClient } from "../../src/catalogue/catalogue-client.js";
import { parseCatalogue } from "../../src/catalogue/rdf-catalogue.js";

const header = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcat="http://www.w3.org/ns/dcat#" xmlns:dct="http://purl.org/dc/terms/" xmlns:foaf="http://xmlns.com/foaf/0.1/" xmlns:xsd="http://www.w3.org/2001/XMLSchema#">`;
const catalogue = `${header}
<dcat:Catalog rdf:about="https://example/catalog"><dcat:dataset rdf:resource="https://example/a"/><dcat:dataset rdf:resource="https://example/b"/></dcat:Catalog>
<dcat:Dataset rdf:about="https://example/a"><dct:identifier>same-id</dct:identifier><dct:title xml:lang="en">A &amp; &lt;B&gt;</dct:title><dct:modified>2026-11-19</dct:modified><dcat:distribution rdf:resource="https://example/distribution"/><dct:publisher rdf:nodeID="publisher"/></dcat:Dataset>
<dcat:Dataset rdf:about="https://example/b"><dct:identifier>same-id</dct:identifier><dct:title>Other dataset</dct:title></dcat:Dataset>
<dcat:Distribution rdf:about="https://example/distribution"><dct:title xml:lang="fr">Données</dct:title><dcat:byteSize rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">42</dcat:byteSize></dcat:Distribution>
<foaf:Agent rdf:nodeID="publisher"><foaf:name>Publisher</foaf:name><foaf:knows rdf:nodeID="publisher"/></foaf:Agent>
</rdf:RDF>`;
const config = {
  url: "https://example/catalog.rdf",
  acceptLanguage: "en",
  requestTimeoutMs: 1000,
};
async function extract(xml: string) {
  const parser = new RdfXmlParser({ validateUri: false });
  parser.end(xml);
  return parseCatalogue(parser);
}
async function triples(xml: string) {
  const parser = new RdfXmlParser();
  parser.end(xml);
  const result = [];
  for await (const q of parser)
    result.push({
      subject: q.subject.value,
      predicate: q.predicate.value,
      object: q.object.value,
      language: q.object.language,
      datatype: q.object.datatype?.value,
    });
  return result;
}
it("extracts embedded RDF with linked named nodes, blank nodes, cycles, languages and datatypes", async () => {
  const datasets = await extract(catalogue);
  expect(datasets.map((d) => d.datasetId)).toEqual([
    "https://example/a",
    "https://example/b",
  ]);
  expect(datasets[0]?.modifiedAt).toBe("2026-11-19");
  const graph = await triples(datasets[0]!.rdf);
  expect(graph).toHaveLength(12);
  expect(graph).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ object: "A & <B>", language: "en" }),
      expect.objectContaining({
        subject: "https://example/distribution",
        object: "Données",
        language: "fr",
      }),
      expect.objectContaining({
        object: "42",
        datatype: "http://www.w3.org/2001/XMLSchema#integer",
      }),
      expect.objectContaining({ object: "Publisher" }),
    ]),
  );
  expect(
    graph.some(
      (t) =>
        t.subject === "https://example/b" ||
        t.subject === "https://example/catalog",
    ),
  ).toBe(false);
});
it("downloads one catalogue without individual RDF requests, including single dataset selection", async () => {
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(catalogue, {
        headers: { "Content-Type": "application/rdf+xml" },
      }),
  );
  const client = new CatalogueClient(config, fetchImpl);
  expect(await client.listDatasets()).toHaveLength(2);
  expect(
    await client.listDeletedDatasetIds([
      "https://example/a",
      "https://example/removed",
    ]),
  ).toEqual(["https://example/removed"]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect((await client.getDataset("https://example/b")).datasetId).toBe(
    "https://example/b",
  );
  expect(
    fetchImpl.mock.calls.every((call) => String(call[0]) === config.url),
  ).toBe(true);
});
it("rejects reference-only catalogues instead of fetching external URLs", async () => {
  await expect(
    extract(
      `${header}<dcat:Catalog rdf:about="https://example/catalog"><dcat:dataset rdf:resource="https://example/missing"/></dcat:Catalog></rdf:RDF>`,
    ),
  ).rejects.toThrow("no embedded dataset metadata");
});
it("rejects malformed XML and incomplete inventories before deletion reconciliation", async () => {
  const client = new CatalogueClient(
    config,
    vi.fn(
      async () =>
        new Response("<broken>", {
          headers: { "Content-Type": "application/rdf+xml" },
        }),
    ),
  );
  await expect(
    client.listDeletedDatasetIds(["https://example/known"]),
  ).rejects.toThrow("Invalid RDF catalogue");
  await expect(extract(`${header}</rdf:RDF>`)).rejects.toThrow(
    "No dcat:Catalog",
  );
});
