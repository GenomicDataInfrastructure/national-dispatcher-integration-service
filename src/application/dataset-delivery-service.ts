// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  DispatcherError,
  NationalDispatcherClient,
} from "../dispatcher/national-dispatcher-client.js";
import type { SyncState } from "../domain/sync-state.js";
import { SyncStateRepository } from "../persistence/postgres/sync-state-repository.js";

export class DeliveryConflictError extends Error {}
export class DeliveryNotFoundError extends Error {}
export type DeliveryResult = {
  state: SyncState;
  operation: "created" | "updated" | "skipped";
};
const checksum = (rdf: string) =>
  createHash("sha256").update(rdf).digest("hex");

export class DatasetDeliveryService {
  constructor(
    private readonly repository: SyncStateRepository,
    private readonly dispatcher: NationalDispatcherClient,
  ) {}

  create(datasetId: string, rdf: string): Promise<SyncState> {
    return this.repository.withDatasetLock(datasetId, async (repo) => {
      const existing = await repo.get(datasetId);
      return this.createLocked(repo, datasetId, rdf, checksum(rdf), existing);
    });
  }

  private async createLocked(
    repo: SyncStateRepository,
    datasetId: string,
    rdf: string,
    digest: string,
    existing: SyncState | null,
  ): Promise<SyncState> {
    if (existing?.checksum === digest && existing.status === "delivered")
      return existing;
    if (existing?.dispatcherDatabaseId && !existing.centralPlatformObjectId) {
      try {
        return await this.resolve(repo, existing, "create");
      } catch (error) {
        const state = await this.recordFailure(
          repo,
          datasetId,
          error,
          "create",
        );
        this.throwWithDeliveryContext(error, state);
      }
    }
    if (existing?.status === "creating" || existing?.status === "uncertain")
      throw new DeliveryConflictError(
        "A create may already have been accepted; inspect status before retrying",
      );
    if (existing?.centralPlatformObjectId)
      return this.updateLocked(repo, existing, rdf, digest);

    await repo.save(datasetId, {
      checksum: digest,
      operation: "create",
      status: "creating",
    });
    try {
      const databaseId = await this.dispatcher.create(rdf);
      const pending = await repo.save(datasetId, {
        checksum: digest,
        dispatcherDatabaseId: databaseId,
        operation: "create",
        status: "pending",
      });
      return await this.resolve(repo, pending, "create");
    } catch (error) {
      const state = await this.recordFailure(
        repo,
        datasetId,
        error,
        "create",
        true,
      );
      this.throwWithDeliveryContext(error, state);
    }
  }

  update(datasetId: string, rdf: string): Promise<SyncState> {
    return this.repository.withDatasetLock(datasetId, async (repo) => {
      const existing = await repo.get(datasetId);
      if (!existing)
        throw new DeliveryNotFoundError("Dataset delivery state was not found");
      const digest = checksum(rdf);
      if (existing.checksum === digest && existing.status === "delivered")
        return existing;
      return this.updateLocked(repo, existing, rdf, digest);
    });
  }

  async synchronize(datasetId: string, rdf: string): Promise<DeliveryResult> {
    const digest = checksum(rdf);
    return this.repository.withDatasetLock(datasetId, async (repo) => {
      const existing = await repo.get(datasetId);
      if (existing?.checksum === digest && existing.status === "delivered")
        return { state: existing, operation: "skipped" };
      if (existing?.centralPlatformObjectId)
        return {
          state: await this.updateLocked(repo, existing, rdf, digest),
          operation: "updated",
        };
      return {
        state: await this.createLocked(repo, datasetId, rdf, digest, existing),
        operation: "created",
      };
    });
  }

  delete(datasetId: string): Promise<{ deleted: boolean }> {
    return this.repository.withDatasetLock(datasetId, async (repo) => {
      const existing = await repo.get(datasetId);
      if (!existing) return { deleted: true };
      if (existing.operation === "delete" && existing.dispatcherDatabaseId) {
        try {
          await this.resolve(repo, existing, "delete");
          await repo.remove(datasetId);
          return { deleted: true };
        } catch (error) {
          const state = await this.recordFailure(
            repo,
            datasetId,
            error,
            "delete",
          );
          this.throwWithDeliveryContext(error, state);
        }
      }
      if (
        existing.operation === "delete" &&
        (existing.status === "deleting" || existing.status === "uncertain")
      )
        throw new DeliveryConflictError(
          "A delete may already have been accepted; inspect status before retrying",
        );
      if (!existing.centralPlatformObjectId)
        throw new DeliveryConflictError(
          "Dataset has no verified Central Platform object ID",
        );
      await repo.save(datasetId, { operation: "delete", status: "deleting" });
      try {
        const result = await this.dispatcher.delete(
          existing.centralPlatformObjectId,
        );
        if (result.alreadyGone) {
          await repo.remove(datasetId);
          return { deleted: true };
        }
        if (!result.databaseId)
          throw new DispatcherError(
            "Dispatcher delete response did not include databaseId",
            "protocol",
          );
        const pending = await repo.save(datasetId, {
          dispatcherDatabaseId: result.databaseId,
          operation: "delete",
          status: "pending",
        });
        await this.resolve(repo, pending, "delete");
        await repo.remove(datasetId);
        return { deleted: true };
      } catch (error) {
        const state = await this.recordFailure(
          repo,
          datasetId,
          error,
          "delete",
        );
        this.throwWithDeliveryContext(error, state);
      }
    });
  }

  async status(datasetId: string): Promise<SyncState> {
    const state = await this.repository.get(datasetId);
    if (!state)
      throw new DeliveryNotFoundError("Dataset delivery state was not found");
    return state;
  }

  private async updateLocked(
    repo: SyncStateRepository,
    existing: SyncState,
    rdf: string,
    digest: string,
  ): Promise<SyncState> {
    if (!existing.centralPlatformObjectId)
      throw new DeliveryConflictError(
        "Dataset create has not produced a Central Platform object ID",
      );
    if (existing.operation === "update" && existing.dispatcherDatabaseId) {
      let resolved: SyncState;
      try {
        resolved = await this.resolve(repo, existing, "update");
      } catch (error) {
        const state = await this.recordFailure(
          repo,
          existing.datasetId,
          error,
          "update",
        );
        this.throwWithDeliveryContext(error, state);
      }
      if (resolved.checksum === digest) return resolved;
      return this.updateLocked(repo, resolved, rdf, digest);
    }
    await repo.save(existing.datasetId, {
      operation: "update",
      status: "updating",
    });
    try {
      const databaseId = await this.dispatcher.update(
        existing.centralPlatformObjectId,
        rdf,
      );
      if (!databaseId)
        return repo.save(existing.datasetId, {
          checksum: digest,
          operation: "update",
          status: "delivered",
          successful: true,
          lastError: null,
        });
      const pending = await repo.save(existing.datasetId, {
        checksum: digest,
        dispatcherDatabaseId: databaseId,
        operation: "update",
        status: "pending",
      });
      return await this.resolve(repo, pending, "update");
    } catch (error) {
      const state = await this.recordFailure(
        repo,
        existing.datasetId,
        error,
        "update",
      );
      this.throwWithDeliveryContext(error, state);
    }
  }

  private async resolve(
    repo: SyncStateRepository,
    state: SyncState,
    operation: "create" | "update" | "delete",
  ): Promise<SyncState> {
    if (!state.dispatcherDatabaseId)
      throw new DeliveryConflictError(
        "No dispatcher database ID is available for verification",
      );
    const correlationId =
      state.correlationId ??
      (await this.dispatcher.track(state.dispatcherDatabaseId));
    await repo.save(state.datasetId, {
      correlationId,
      operation,
      status: "pending",
    });
    const objectId = await this.dispatcher.verify(correlationId, operation);
    return repo.save(state.datasetId, {
      centralPlatformObjectId: objectId,
      dispatcherDatabaseId: null,
      correlationId: null,
      operation,
      status: "delivered",
      successful: true,
      lastError: null,
    });
  }

  private async recordFailure(
    repo: SyncStateRepository,
    datasetId: string,
    error: unknown,
    operation: "create" | "update" | "delete",
    uncertain = false,
  ): Promise<SyncState> {
    const message =
      error instanceof Error ? error.message : "Unknown delivery error";
    return repo.save(datasetId, {
      operation,
      status: uncertain ? "uncertain" : "failed",
      lastError: message,
      incrementRetry: true,
    });
  }

  private throwWithDeliveryContext(error: unknown, state: SyncState): never {
    if (error instanceof DispatcherError) {
      error.deliveryContext = {
        datasetId: state.datasetId,
        status: state.status,
        dispatcherDatabaseId: state.dispatcherDatabaseId,
        correlationId: state.correlationId,
      };
    }
    throw error;
  }
}
