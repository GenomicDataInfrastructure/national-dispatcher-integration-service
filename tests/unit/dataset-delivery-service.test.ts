// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { DatasetDeliveryService } from "../../src/application/dataset-delivery-service.js";
import { DispatcherError } from "../../src/dispatcher/national-dispatcher-client.js";

function setup(state: Record<string, unknown> | null = null) {
  let current = state;
  const repo: any = {
    withDatasetLock: async (_id: string, work: any) => work(repo),
    get: vi.fn(async () => current),
    save: vi.fn(
      async (id: string, update: any) =>
        (current = {
          datasetId: id,
          retryCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...current,
          ...update,
        }),
    ),
    remove: vi.fn(async () => {
      current = null;
    }),
  };
  const dispatcher: any = {
    create: vi.fn(async () => "db-1"),
    update: vi.fn(async () => "db-2"),
    delete: vi.fn(async () => ({ databaseId: "db-3", alreadyGone: false })),
    track: vi.fn(async (id: string) => `corr-${id}`),
    verify: vi.fn(async () => "central-1"),
  };
  return {
    service: new DatasetDeliveryService(repo, dispatcher),
    repo,
    dispatcher,
  };
}

describe("DatasetDeliveryService", () => {
  it("creates, tracks, verifies, and stores the object ID", async () => {
    const { service, dispatcher } = setup();
    const result = await service.create("dataset-1", "<rdf />");
    expect(result.status).toBe("delivered");
    expect(result.centralPlatformObjectId).toBe("central-1");
    expect(dispatcher.track).toHaveBeenCalledWith("db-1");
  });
  it("skips unchanged delivered metadata", async () => {
    const digest =
      "9d961ed463c166211da644f3735ed4731bcf7639c48c07e6c0d479209f16b922";
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: digest,
      status: "delivered",
    });
    await service.create("dataset-1", "<rdf />");
    expect(dispatcher.create).not.toHaveBeenCalled();
  });
  it("resolves a pending create without creating a duplicate", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "x",
      dispatcherDatabaseId: "db-existing",
      centralPlatformObjectId: null,
      correlationId: null,
      status: "pending",
    });
    await service.create("dataset-1", "new");
    expect(dispatcher.create).not.toHaveBeenCalled();
    expect(dispatcher.track).toHaveBeenCalledWith("db-existing");
  });
  it("adds persisted tracking identifiers to dispatcher failures", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "x",
      dispatcherDatabaseId: "db-existing",
      centralPlatformObjectId: null,
      correlationId: "corr-existing",
      status: "pending",
    });
    dispatcher.verify.mockRejectedValueOnce(
      new DispatcherError("Central Platform rejected create", "http"),
    );

    await expect(service.create("dataset-1", "new")).rejects.toMatchObject({
      deliveryContext: {
        datasetId: "dataset-1",
        status: "failed",
        dispatcherDatabaseId: "db-existing",
        correlationId: "corr-existing",
      },
    });
  });
  it("updates changed metadata", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "old",
      centralPlatformObjectId: "central-1",
      status: "delivered",
    });
    await service.update("dataset-1", "new");
    expect(dispatcher.update).toHaveBeenCalledWith("central-1", "new");
  });
  it("deletes and verifies metadata", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      centralPlatformObjectId: "central-1",
      status: "delivered",
    });
    await service.delete("dataset-1");
    expect(dispatcher.verify).toHaveBeenCalledWith("corr-db-3", "delete");
    expect(repo.remove).toHaveBeenCalledWith("dataset-1");
  });
  it("resumes a pending update without submitting a duplicate", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum:
        "11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-update",
      operation: "update",
      status: "pending",
    });
    await service.update("dataset-1", "new");
    expect(dispatcher.update).not.toHaveBeenCalled();
    expect(dispatcher.track).toHaveBeenCalledWith("db-update");
  });
  it("resumes a pending delete without submitting a duplicate", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-delete",
      operation: "delete",
      status: "pending",
    });
    await service.delete("dataset-1");
    expect(dispatcher.delete).not.toHaveBeenCalled();
    expect(dispatcher.track).toHaveBeenCalledWith("db-delete");
    expect(repo.remove).toHaveBeenCalledWith("dataset-1");
  });
});

it.each(["create", "update"] as const)(
  "persists verification failure for a newly submitted %s",
  async (operation) => {
    const { service, dispatcher, repo } = setup(
      operation === "update"
        ? {
            datasetId: "dataset-1",
            centralPlatformObjectId: "central-1",
            checksum: "old",
            status: "delivered",
          }
        : null,
    );
    dispatcher.verify.mockRejectedValueOnce(
      new DispatcherError("Verification rejected", "http"),
    );
    await expect(service[operation]("dataset-1", "new")).rejects.toMatchObject({
      deliveryContext: expect.objectContaining({ datasetId: "dataset-1" }),
    });
    expect(await repo.get("dataset-1")).toMatchObject({
      lastError: "Verification rejected",
      incrementRetry: true,
    });
  },
);
