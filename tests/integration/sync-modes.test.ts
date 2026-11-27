// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerSyncRoutes } from "../../src/api/sync-routes.js";
import { SyncOrchestrator } from "../../src/application/sync-orchestrator.js";

describe("sync run operation modes", () => {
  it.each([
    ["sync_only", "", "sync_only"],
    ["validate_and_sync", "", "validate_and_sync"],
    ["validate_only", "", "validate_only"],
    ["validate_and_sync", "?mode=validate_only", "validate_only"],
    ["sync_only", "?mode=validate_only", "validate_only"],
  ] as const)(
    "records %s with query '%s' as %s",
    async (configured, query, expected) => {
      const runs: any = {
        create: vi.fn(async (runId, mode) => ({
          runId,
          mode,
          status: "queued",
        })),
        withSyncLock: vi.fn(async () => null),
        finish: vi.fn(),
      };
      const orchestrator = new SyncOrchestrator(
        {} as any,
        {} as any,
        runs,
        {} as any,
        { validate: vi.fn() } as any,
        configured,
      );
      const app = Fastify();
      await registerSyncRoutes(app, orchestrator);
      try {
        for (const path of ["/api/v1/sync", "/api/v1/sync/dataset/example"]) {
          const response = await app.inject({
            method: "POST",
            url: path + query,
          });
          expect(response.statusCode).toBe(202);
          expect(response.json()).toMatchObject({
            mode: expected,
            status: "queued",
          });
          expect(runs.create).toHaveBeenLastCalledWith(
            expect.any(String),
            expected,
            "catalogue",
          );
          await vi.waitFor(() => expect(runs.finish).toHaveBeenCalled());
        }
      } finally {
        await app.close();
      }
    },
  );

  it.each([
    ["?mode=validate", undefined],
    ["?mode=deliver", undefined],
    ["?mode=sync_only", undefined],
    ["?mode=validate_only", { operationMode: "validate_and_sync" }],
  ])("rejects %s with body %j before creating a run", async (query, body) => {
    const runs: any = { create: vi.fn() };
    const orchestrator = new SyncOrchestrator(
      {} as any,
      {} as any,
      runs,
      {} as any,
      { validate: vi.fn() } as any,
    );
    const app = Fastify();
    await registerSyncRoutes(app, orchestrator);
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/sync" + query,
        ...(body ? { payload: body } : {}),
      });
      expect(response.statusCode).toBe(400);
      expect(runs.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
