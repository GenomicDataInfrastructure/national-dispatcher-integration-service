// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";

const config: any = {
  controlApiToken: "operator-test-token-at-least-32-characters",
  dispatcher: {
    baseUrl: "https://dispatcher.example",
    apiKey: "secret",
    validationEnabled: true,
    connectionTimeoutMs: 100,
    requestTimeoutMs: 100,
    verificationTimeoutMs: 100,
    pollIntervalMs: 1,
  },
};
function repository() {
  const state: any = {};
  const repo: any = {
    ping: vi.fn(async () => undefined),
    withDatasetLock: async (_id: string, work: any) => work(repo),
    get: vi.fn(async (id: string) => state[id] ?? null),
    save: vi.fn(
      async (id: string, update: any) =>
        (state[id] = {
          datasetId: id,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...state[id],
          ...update,
        }),
    ),
    remove: vi.fn(async (id: string) => delete state[id]),
  };
  return repo;
}

describe("HTTP API", () => {
  it("serves health and readiness", async () => {
    const app = await buildApp(config, repository(), vi.fn() as any);
    expect(
      (await app.inject({ method: "GET", url: "/health" })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/ready" })).statusCode,
    ).toBe(200);
    await app.close();
  });
  it("rejects an invalid submission", async () => {
    const app = await buildApp(config, repository(), vi.fn() as any);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/dataset-deliveries",
      headers: {
        "content-type": "application/rdf+xml",
        authorization: `Bearer ${config.controlApiToken}`,
      },
      payload: "",
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
