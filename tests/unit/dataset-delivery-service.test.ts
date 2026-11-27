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
    track: vi.fn(
      async (id: string, onStatus?: (status: string) => Promise<void>) => {
        await onStatus?.("ACKNOWLEDGED");
        return `corr-${id}`;
      },
    ),
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
    const result = await service.synchronize("dataset-1", "<rdf />");
    expect(result.state.status).toBe("delivered");
    expect(result.state.centralPlatformObjectId).toBe("central-1");
    expect(dispatcher.track).toHaveBeenCalledWith("db-1", expect.any(Function));
  });
  it("skips unchanged delivered metadata", async () => {
    const digest =
      "9d961ed463c166211da644f3735ed4731bcf7639c48c07e6c0d479209f16b922";
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: digest,
      status: "delivered",
    });
    await service.synchronize("dataset-1", "<rdf />");
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
    await service.synchronize("dataset-1", "new");
    expect(dispatcher.create).not.toHaveBeenCalled();
    expect(dispatcher.track).toHaveBeenCalledWith(
      "db-existing",
      expect.any(Function),
    );
  });
  it("keeps the last Domibus status when tracking a create times out", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      checksum: "x",
      dispatcherDatabaseId: "db-existing",
      centralPlatformObjectId: null,
      correlationId: null,
      status: "pending",
    });
    dispatcher.track.mockImplementationOnce(
      async (_id: string, onStatus: (status: string) => Promise<void>) => {
        await onStatus("WAITING_FOR_RETRY");
        throw new DispatcherError("Tracking timed out", "timeout", 504);
      },
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: expect.objectContaining({
          status: "WAITING_FOR_RETRY",
        }),
      },
    );
    expect(await repo.get("dataset-1")).toMatchObject({
      status: "WAITING_FOR_RETRY",
      lastError: "Tracking timed out",
    });
  });
  it("marks the delivery context in flight when tracking times out during a Domibus retry", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "x",
      dispatcherDatabaseId: "db-existing",
      centralPlatformObjectId: null,
      correlationId: null,
      status: "pending",
    });
    dispatcher.track.mockImplementationOnce(
      async (_id: string, onStatus: (status: string) => Promise<void>) => {
        await onStatus("WAITING_FOR_RETRY");
        throw new DispatcherError("Tracking timed out", "timeout", 504);
      },
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: { status: "WAITING_FOR_RETRY", inFlight: true },
      },
    );
  });
  it.each(["timeout", "network"] as const)(
    "keeps a new create pending when tracking fails with %s before Domibus reports a status",
    async (kind) => {
      const { service, dispatcher, repo } = setup();
      dispatcher.track.mockRejectedValueOnce(
        new DispatcherError("Tracking stopped", kind, 504),
      );

      await expect(
        service.synchronize("dataset-1", "new"),
      ).rejects.toMatchObject({
        deliveryContext: {
          status: "pending",
          dispatcherDatabaseId: "db-1",
          inFlight: true,
        },
      });
      expect(await repo.get("dataset-1")).toMatchObject({
        status: "pending",
        dispatcherDatabaseId: "db-1",
        lastError: "Tracking stopped",
      });
    },
  );
  it("keeps a resumed update pending when tracking times out again", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      checksum: "old",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-update",
      operation: "update",
      status: "pending",
    });
    dispatcher.track.mockRejectedValueOnce(
      new DispatcherError("Tracking timed out", "timeout", 504),
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: { status: "pending", inFlight: true },
      },
    );
    expect(dispatcher.update).not.toHaveBeenCalled();
    expect(await repo.get("dataset-1")).toMatchObject({ status: "pending" });
  });
  it("records a pending create as failed when the dispatcher rejects RDF validation", async () => {
    const { service, dispatcher, repo } = setup();
    dispatcher.track.mockRejectedValueOnce(
      new DispatcherError(
        "National Dispatcher rejected RDF validation",
        "validation",
        422,
      ),
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: { status: "failed", inFlight: false },
      },
    );
    expect(await repo.get("dataset-1")).toMatchObject({ status: "failed" });
  });
  it("does not mark failures after ACKNOWLEDGED as in flight", async () => {
    const { service, dispatcher } = setup();
    dispatcher.verify.mockRejectedValueOnce(
      new DispatcherError("Verification timed out", "timeout", 504),
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: { status: "failed", inFlight: false },
      },
    );
  });
  it("submits a fresh create after the previous Domibus message failed", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "x",
      dispatcherDatabaseId: "db-failed",
      domibusMessageId: "corr-failed",
      centralPlatformObjectId: null,
      correlationId: "corr-failed",
      status: "SEND_FAILURE",
      operation: "create",
    });

    const result = await service.synchronize("dataset-1", "new");

    expect(dispatcher.create).toHaveBeenCalledOnce();
    expect(dispatcher.track).toHaveBeenCalledWith("db-1", expect.any(Function));
    expect(result.state.status).toBe("delivered");
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

    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: {
          datasetId: "dataset-1",
          status: "failed",
          dispatcherDatabaseId: "db-existing",
          correlationId: "corr-existing",
          inFlight: false,
        },
      },
    );
  });
  it("updates changed metadata", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "old",
      centralPlatformObjectId: "central-1",
      status: "delivered",
    });
    await service.synchronize("dataset-1", "new");
    expect(dispatcher.update).toHaveBeenCalledWith("central-1", "new");
  });
  it("submits a fresh update after the previous Domibus message failed", async () => {
    const { service, dispatcher } = setup({
      datasetId: "dataset-1",
      checksum: "old",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-failed",
      domibusMessageId: "corr-failed",
      correlationId: "corr-failed",
      operation: "update",
      status: "SEND_FAILURE",
    });

    const result = await service.synchronize("dataset-1", "new");

    expect(dispatcher.update).toHaveBeenCalledWith("central-1", "new");
    expect(dispatcher.track).toHaveBeenCalledWith("db-2", expect.any(Function));
    expect(result.state.status).toBe("delivered");
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
    await service.synchronize("dataset-1", "new");
    expect(dispatcher.update).not.toHaveBeenCalled();
    expect(dispatcher.track).toHaveBeenCalledWith(
      "db-update",
      expect.any(Function),
    );
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
    expect(dispatcher.track).toHaveBeenCalledWith(
      "db-delete",
      expect.any(Function),
    );
    expect(repo.remove).toHaveBeenCalledWith("dataset-1");
  });
  it("records a failure, not ACKNOWLEDGED, when verification fails after acknowledgement", async () => {
    const { service, dispatcher, repo } = setup();
    dispatcher.verify.mockRejectedValueOnce(
      new DispatcherError("Central Platform rejected create", "http"),
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toThrow();
    expect(await repo.get("dataset-1")).toMatchObject({
      status: "failed",
      lastError: "Central Platform rejected create",
    });
  });
  it("never marks a failed update delivered before it is resent", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      checksum: "new-checksum",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-failed",
      correlationId: "corr-failed",
      operation: "update",
      status: "SEND_FAILURE",
    });
    dispatcher.update.mockRejectedValueOnce(
      new DispatcherError("Dispatcher unavailable", "network"),
    );

    await expect(service.synchronize("dataset-1", "new")).rejects.toThrow();
    const statuses = repo.save.mock.calls.map(
      ([, update]: any) => update.status,
    );
    expect(statuses).not.toContain("delivered");
    expect(await repo.get("dataset-1")).toMatchObject({ status: "failed" });
  });
  it.each(["NOT_FOUND", "DELETED"] as const)(
    "submits a fresh create after Domibus reported %s",
    async (status) => {
      const { service, dispatcher } = setup({
        datasetId: "dataset-1",
        checksum: "x",
        dispatcherDatabaseId: "db-lost",
        centralPlatformObjectId: null,
        correlationId: null,
        operation: "create",
        status,
      });

      const result = await service.synchronize("dataset-1", "new");

      expect(dispatcher.create).toHaveBeenCalledOnce();
      expect(dispatcher.track).not.toHaveBeenCalledWith(
        "db-lost",
        expect.any(Function),
      );
      expect(result.state.status).toBe("delivered");
    },
  );
  it("submits a fresh delete after the previous Domibus message failed", async () => {
    const { service, dispatcher, repo } = setup({
      datasetId: "dataset-1",
      centralPlatformObjectId: "central-1",
      dispatcherDatabaseId: "db-failed",
      correlationId: null,
      operation: "delete",
      status: "SEND_FAILURE",
    });

    await expect(service.delete("dataset-1")).resolves.toEqual({
      deleted: true,
    });
    expect(dispatcher.delete).toHaveBeenCalledWith("central-1");
    expect(dispatcher.track).toHaveBeenCalledWith("db-3", expect.any(Function));
    expect(repo.remove).toHaveBeenCalledWith("dataset-1");
  });
  it("clears the previous Domibus message ID when a new delivery starts", async () => {
    const { service, repo } = setup({
      datasetId: "dataset-1",
      checksum: "old",
      centralPlatformObjectId: "central-1",
      domibusMessageId: "corr-previous",
      status: "delivered",
    });

    await service.synchronize("dataset-1", "new");

    expect(repo.save.mock.calls[0][1]).toMatchObject({
      status: "updating",
      domibusMessageId: null,
    });
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
    await expect(service.synchronize("dataset-1", "new")).rejects.toMatchObject(
      {
        deliveryContext: expect.objectContaining({ datasetId: "dataset-1" }),
      },
    );
    expect(await repo.get("dataset-1")).toMatchObject({
      lastError: "Verification rejected",
      incrementRetry: true,
    });
  },
);
