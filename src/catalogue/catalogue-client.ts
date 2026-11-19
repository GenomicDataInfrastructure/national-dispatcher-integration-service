// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { RdfXmlParser } from "rdfxml-streaming-parser";
import type { CatalogueConfig } from "../config/config.js";
import type { MetadataDataset } from "../domain/metadata-dataset.js";
import { parseCatalogue } from "./rdf-catalogue.js";

export class CatalogueError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "network" | "http" | "protocol",
    public readonly statusCode = 502,
  ) {
    super(message);
  }
}

export class CatalogueClient {
  private lastCompleteDatasetIds: Set<string> | undefined;

  constructor(
    private readonly config: CatalogueConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listDatasets(): Promise<MetadataDataset[]> {
    const datasets = await this.readCatalogue();
    this.lastCompleteDatasetIds = new Set(
      datasets.map((dataset) => dataset.datasetId),
    );
    return datasets;
  }

  async getDataset(datasetId: string): Promise<MetadataDataset> {
    const dataset = (await this.readCatalogue()).find(
      (item) => item.datasetId === datasetId,
    );
    if (!dataset)
      throw new CatalogueError(
        `Dataset ${datasetId} is absent from the catalogue`,
        "protocol",
        404,
      );
    return dataset;
  }

  async listDeletedDatasetIds(knownDatasetIds: string[]): Promise<string[]> {
    if (knownDatasetIds.length === 0) return [];
    const current =
      this.lastCompleteDatasetIds ??
      new Set((await this.readCatalogue()).map((dataset) => dataset.datasetId));
    this.lastCompleteDatasetIds = undefined;
    return knownDatasetIds.filter((id) => !current.has(id));
  }

  assertCompatibleDatasetIds(knownDatasetIds: string[]): void {
    if (knownDatasetIds.some((id) => !/^[a-z][a-z0-9+.-]*:/i.test(id)))
      throw new CatalogueError(
        "Existing delivery state contains non-URI dataset IDs; migrate it before catalogue synchronization",
        "protocol",
      );
  }

  private async readCatalogue(): Promise<MetadataDataset[]> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(new URL(this.config.url), {
          headers: {
            Accept: "application/rdf+xml",
            "Accept-Language": this.config.acceptLanguage,
          },
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError")
          throw new CatalogueError(
            "Catalogue request timed out",
            "timeout",
            504,
          );
        throw new CatalogueError("Catalogue request failed", "network");
      }
      if (!response.ok)
        throw new CatalogueError(
          `Catalogue returned HTTP ${response.status}`,
          "http",
          response.status === 429 ? 503 : 502,
        );
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType && !contentType.includes("application/rdf+xml"))
        throw new CatalogueError(
          `Catalogue returned unexpected RDF content type ${contentType}`,
          "protocol",
        );
      const rdf = await response.text();
      if (!rdf.trim())
        throw new CatalogueError("Catalogue returned empty RDF", "protocol");
      try {
        const parser = new RdfXmlParser({
          baseIRI: this.config.url,
          validateUri: false,
        });
        parser.end(rdf);
        return await parseCatalogue(parser);
      } catch (error) {
        throw new CatalogueError(
          `Invalid RDF catalogue: ${error instanceof Error ? error.message : String(error)}`,
          "protocol",
        );
      }
    } catch (error) {
      if (error instanceof CatalogueError) throw error;
      throw new CatalogueError(
        "Catalogue response could not be read",
        "network",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
