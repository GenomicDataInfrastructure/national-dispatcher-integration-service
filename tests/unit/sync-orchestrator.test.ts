// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { MetadataValidator } from "../../src/validation/metadata-validator.js";
import { DatasetDeliveryService } from "../../src/application/dataset-delivery-service.js";
import { describe, expect, it, vi } from "vitest";
import {
  SyncAlreadyRunningError,
  SyncOrchestrator,
} from "../../src/application/sync-orchestrator.js";

describe("SyncOrchestrator", () => {
  it("prevents overlapping catalogue runs", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const catalogue = { listDatasets: vi.fn(() => blocked.then(() => [])) };
    const runs: any = {
      create: vi.fn(async (runId: string) => ({ runId, status: "queued" })),
      withSyncLock: vi.fn(async () => blocked),
      finish: vi.fn(async () => undefined),
    };
    const orchestrator = new SyncOrchestrator(
      catalogue as any,
      {} as any,
      runs,
      {} as any,
    );

    await orchestrator.trigger();
    await expect(orchestrator.trigger()).rejects.toBeInstanceOf(
      SyncAlreadyRunningError,
    );
    release();
  });
});

describe("validation-only sync", () => {
  it("stores per-dataset results without reading or writing delivery state or calling dispatcher", async () => {
    const catalogue = {
      listDatasets: vi.fn(async () => [
        { datasetId: "valid", rdf: "<valid />" },
        { datasetId: "invalid", rdf: "<invalid />" },
        { datasetId: "unavailable", rdf: "<error />" },
      ]),
    };
    const states = { forSource: vi.fn() };
    const dispatcher = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const runs: any = {
      create: vi.fn(async (runId: string) => ({ runId, status: "queued" })),
      setRunning: vi.fn(),
      withSyncLock: vi.fn(async (work: () => Promise<void>) => {
        await work();
        return true;
      }),
      finish: vi.fn(),
    };
    const validator = {
      validate: vi.fn(async (datasetId: string) => {
        if (datasetId === "unavailable") throw new Error("Validator offline");
        return {
          datasetId,
          conforms: datasetId === "valid",
          profile: "test",
          report: "report",
        };
      }),
    };
    const orchestrator = new SyncOrchestrator(
      catalogue as any,
      states as any,
      runs,
      dispatcher as any,
      validator as any,
    );
    await orchestrator.trigger(undefined, "validate");
    await vi.waitFor(() => expect(runs.finish).toHaveBeenCalled());
    expect(runs.create).toHaveBeenCalledWith(
      expect.any(String),
      "validate_only",
      "userportal",
    );
    expect(runs.finish).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({
        datasetsSeen: 3,
        datasetsFailed: 2,
        datasetsCreated: 0,
        datasetsUpdated: 0,
        datasetsDeleted: 0,
      }),
      null,
      [
        {
          datasetId: "valid",
          checksum: expect.any(String),
          sourceSystem: "userportal",
          conforms: true,
          profile: "test",
          report: "report",
        },
        {
          datasetId: "invalid",
          checksum: expect.any(String),
          sourceSystem: "userportal",
          conforms: false,
          profile: "test",
          report: "report",
        },
        {
          datasetId: "unavailable",
          checksum: expect.any(String),
          sourceSystem: "userportal",
          error: "Validator offline",
        },
      ],
    );
    expect(states.forSource).not.toHaveBeenCalled();
    for (const call of Object.values(dispatcher))
      expect(call).not.toHaveBeenCalled();
  });

  it("rejects missing validator before creating a run", async () => {
    const runs = { create: vi.fn() };
    const orchestrator = new SyncOrchestrator(
      {} as any,
      {} as any,
      runs as any,
      {} as any,
    );
    await expect(orchestrator.trigger(undefined, "validate")).rejects.toThrow(
      "METADATA_VALIDATOR_URL",
    );
    expect(runs.create).not.toHaveBeenCalled();
  });
});

it("delivers warnings-only datasets without counting validation failures", async () => {
  const synchronize = vi
    .spyOn(DatasetDeliveryService.prototype, "synchronize")
    .mockResolvedValue({
      state: { status: "delivered" } as any,
      operation: "created",
    });
  const runs: any = {
    create: vi.fn(async (runId: string) => ({ runId })),
    setRunning: vi.fn(),
    withSyncLock: vi.fn(async (work: () => Promise<void>) => {
      await work();
      return true;
    }),
    finish: vi.fn(),
  };
  const body = {
    "@context": { sh: "http://www.w3.org/ns/shacl#" },
    "@graph": [
      { "@type": "sh:ValidationReport", "sh:conforms": false },
      {
        "@type": "sh:ValidationResult",
        "sh:resultSeverity": { "@id": "sh:Warning" },
        "sh:resultMessage": "Recommended property missing",
      },
    ],
  };
  const validator = new MetadataValidator(
    "https://validator.example",
    vi.fn(async () => Response.json(body)) as any,
    { mode: "itb", validationType: "public" },
  );
  const catalogue: any = {
    assertCompatibleDatasetIds: vi.fn(),
    listDatasets: vi.fn(async () => [{ datasetId: "warning", rdf: "<rdf/>" }]),
    listDeletedDatasetIds: vi.fn(async () => []),
  };
  const states: any = {
    forSource: vi.fn(() => ({
      get: vi.fn(async () => null),
      listDatasetIds: vi.fn(async () => []),
    })),
  };
  try {
    await new SyncOrchestrator(
      catalogue,
      states,
      runs,
      {} as any,
      validator,
      "validate_and_sync",
    ).trigger();
    await vi.waitFor(() => expect(runs.finish).toHaveBeenCalled());
    expect(synchronize).toHaveBeenCalledWith("warning", "<rdf/>");
    expect(runs.finish).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
      expect.objectContaining({ datasetsCreated: 1, datasetsFailed: 0 }),
      null,
      [expect.objectContaining({ conforms: true, validatorConforms: false })],
    );
  } finally {
    synchronize.mockRestore();
  }
});
