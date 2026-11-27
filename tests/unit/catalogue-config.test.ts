// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";

const env = {
  DISPATCHER_URL: "https://dispatcher.example",
  DISPATCHER_API_KEY: "key",
  POSTGRES_URL: "postgres://localhost/test",
};

it("registers the RDF catalogue as the metadata source", () => {
  const config = loadConfig({
    ...env,
    DATASET_CATALOGUE_RDF_URL: "https://catalogue.example/catalog.rdf",
  });
  expect(config.catalogue).toEqual({
    url: "https://catalogue.example/catalog.rdf",
    acceptLanguage: "en-GB",
    requestTimeoutMs: 30000,
  });
});

it("rejects a malformed catalogue URL", () => {
  expect(() =>
    loadConfig({ ...env, DATASET_CATALOGUE_RDF_URL: "invalid" }),
  ).toThrow();
});
