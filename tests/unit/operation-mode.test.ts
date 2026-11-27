// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { SyncOrchestrator } from "../../src/application/sync-orchestrator.js";

describe("operation modes", () => {
  it("defaults to sync_only and rejects unsupported modes", () => {
    const env = {
      DISPATCHER_URL: "https://dispatcher.example",
      DISPATCHER_API_KEY: "key",
      POSTGRES_URL: "postgres://localhost/test",
    };
    expect(loadConfig(env).operationMode).toBe("sync_only");
    expect(() => loadConfig({ ...env, OPERATION_MODE: "simulated" })).toThrow();
  });

  it.each(["validate_only", "validate_and_sync", "sync_only"] as const)(
    "enforces %s for default runs",
    async (mode) => {
      const catalogue = {
        assertCompatibleDatasetIds: vi.fn(),
        listDatasets: vi.fn(async () => [
          { datasetId: "invalid", rdf: "<rdf/>" },
        ]),
        listDeletedDatasetIds: vi.fn(async () => []),
      };
      const repo: any = {
        get: vi.fn(async () => ({ checksum: null, status: "delivered" })),
        listDatasetIds: vi.fn(async () => []),
        withDatasetLock: vi.fn(async () => {
          throw new Error("delivery attempted");
        }),
      };
      const states = { forSource: vi.fn(() => repo) };
      const runs: any = {
        create: vi.fn(async (runId) => ({ runId })),
        setRunning: vi.fn(),
        withSyncLock: vi.fn(async (work) => {
          await work();
          return true;
        }),
        finish: vi.fn(),
      };
      const validator = {
        validate: vi.fn(async () => ({
          datasetId: "invalid",
          conforms: false,
        })),
      };
      const orchestrator = new SyncOrchestrator(
        catalogue as any,
        states as any,
        runs,
        {} as any,
        validator as any,
        mode,
      );
      await orchestrator.trigger();
      expect(runs.create).toHaveBeenCalledWith(
        expect.any(String),
        mode,
        "catalogue",
      );
      await vi.waitFor(() => expect(runs.finish).toHaveBeenCalled());
      expect(validator.validate).toHaveBeenCalledTimes(
        mode === "sync_only" ? 0 : 1,
      );
      expect(repo.withDatasetLock).toHaveBeenCalledTimes(
        mode === "sync_only" ? 1 : 0,
      );
      expect(states.forSource).toHaveBeenCalledTimes(
        mode === "validate_only" ? 0 : 1,
      );
    },
  );
});
