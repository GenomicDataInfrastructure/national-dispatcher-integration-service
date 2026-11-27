// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { RdfXmlParser } from "rdfxml-streaming-parser";
import type { MetadataDataset } from "../domain/metadata-dataset.js";

type Quad = { subject: Term; predicate: Term; object: Term };
type Term = {
  value: string;
  termType: string;
  language?: string;
  datatype?: { value: string };
};
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const DCAT = "http://www.w3.org/ns/dcat#";
const key = (term: Term) => `${term.termType}:${term.value}`;
const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\t", "&#9;");

function serialize(quads: Quad[]): string {
  const namespaces = new Map<string, string>();
  const blanks = new Map<string, string>();
  const blank = (term: Term) => {
    if (!blanks.has(term.value)) blanks.set(term.value, `b${blanks.size}`);
    return blanks.get(term.value)!;
  };
  const name = (uri: string) => {
    const match = /^(.*[/#])([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(uri);
    if (!match) throw new Error(`Cannot serialize RDF predicate ${uri}`);
    const namespace = match[1]!;
    if (!namespaces.has(namespace))
      namespaces.set(namespace, `p${namespaces.size}`);
    return `${namespaces.get(namespace)}:${match[2]}`;
  };
  const descriptions = quads.map(({ subject, predicate, object }) => {
    const property = name(predicate.value);
    const subjectAttribute =
      subject.termType === "BlankNode"
        ? `rdf:nodeID="${blank(subject)}"`
        : `rdf:about="${escapeXml(subject.value)}"`;
    let body: string;
    if (object.termType === "NamedNode")
      body = `<${property} rdf:resource="${escapeXml(object.value)}"/>`;
    else if (object.termType === "BlankNode")
      body = `<${property} rdf:nodeID="${blank(object)}"/>`;
    else {
      const attribute = object.language
        ? ` xml:lang="${escapeXml(object.language)}"`
        : object.datatype &&
            object.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
          ? ` rdf:datatype="${escapeXml(object.datatype.value)}"`
          : "";
      body = `<${property}${attribute}>${escapeXml(object.value)}</${property}>`;
    }
    return `<rdf:Description ${subjectAttribute}>${body}</rdf:Description>`;
  });
  const declarations = [...namespaces]
    .map(([uri, prefix]) => `xmlns:${prefix}="${escapeXml(uri)}"`)
    .join(" ");
  return `<?xml version="1.0" encoding="utf-8"?>\n<rdf:RDF xmlns:rdf="${RDF}" ${declarations}>\n${descriptions.join("\n")}\n</rdf:RDF>`;
}

export async function parseCatalogue(
  parser: RdfXmlParser,
): Promise<MetadataDataset[]> {
  const quads: Quad[] = [];
  const outgoing = new Map<string, Quad[]>();
  const seen = new Set<string>();
  for await (const quad of parser) {
    const fingerprint = JSON.stringify([
      key(quad.subject),
      quad.predicate.value,
      key(quad.object),
      quad.object.language,
      quad.object.datatype?.value,
    ]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    quads.push(quad);
    const subject = key(quad.subject);
    const values = outgoing.get(subject) ?? [];
    values.push(quad);
    outgoing.set(subject, values);
  }
  const catalogues = new Set(
    quads
      .filter(
        (q) =>
          q.predicate.value === `${RDF}type` &&
          q.object.value === `${DCAT}Catalog`,
      )
      .map((q) => key(q.subject)),
  );
  if (!catalogues.size)
    throw new Error(
      "No dcat:Catalog found; refusing an incomplete dataset inventory",
    );
  if (
    quads.some((q) =>
      [
        "http://www.w3.org/ns/hydra/core#next",
        "http://www.w3.org/ns/hydra/core#nextPage",
      ].includes(q.predicate.value),
    )
  )
    throw new Error(
      "Catalogue is paginated; configure a complete RDF export before reconciliation",
    );
  const datasets = new Map<string, Term>();
  for (const q of quads) {
    if (
      catalogues.has(key(q.subject)) &&
      q.predicate.value === `${DCAT}dataset`
    ) {
      if (q.object.termType !== "NamedNode")
        throw new Error("Catalogue contains a dataset without a URI");
      datasets.set(key(q.object), q.object);
    }
  }
  return [...datasets].map(([datasetKey, dataset]) => {
    const properties = outgoing.get(datasetKey) ?? [];
    if (
      !properties.some(
        (q) =>
          q.predicate.value === `${RDF}type` &&
          q.object.value === `${DCAT}Dataset`,
      )
    )
      throw new Error(
        `Catalogue has no embedded dataset metadata for ${dataset.value}`,
      );
    const selected: Quad[] = [];
    const visited = new Set<string>();
    const pending = [datasetKey];
    while (pending.length) {
      const subject = pending.pop()!;
      if (visited.has(subject)) continue;
      visited.add(subject);
      for (const q of outgoing.get(subject) ?? []) {
        selected.push(q);
        const target = key(q.object);
        if (
          q.object.termType !== "Literal" &&
          !catalogues.has(target) &&
          (!datasets.has(target) || target === datasetKey)
        )
          pending.push(target);
      }
    }
    const modifiedAt = properties.find(
      (q) => q.predicate.value === "http://purl.org/dc/terms/modified",
    )?.object.value;
    return {
      datasetId: dataset.value,
      rdf: serialize(selected),
      ...(modifiedAt ? { modifiedAt } : {}),
    };
  });
}
