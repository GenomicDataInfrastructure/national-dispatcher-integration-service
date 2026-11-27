// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import {
  DispatcherError,
  NationalDispatcherClient,
} from "../dispatcher/national-dispatcher-client.js";
import {
  isInFlightDomibusStatus,
  isTerminalDomibusStatus,
  type DomibusStatus,
} from "../domain/delivery-status.js";
import type { SyncState } from "../domain/sync-state.js";
import { SyncStateRepository } from "../persistence/postgres/sync-state-repository.js";

export class DeliveryConflictError extends Error {}
export type DeliveryResult = {
  state: SyncState;
  operation: "created" | "updated" | "skipped";
};
/**
 * True when the message was handed to the dispatcher and Domibus may still
 * deliver it: an in-flight Domibus status, or "pending" before Domibus has
 * reported any status. The next run resumes tracking instead of resending.
 */
export const isAwaitingDomibus = (state: SyncState): boolean =>
  Boolean(state.dispatcherDatabaseId) &&
  (isInFlightDomibusStatus(state.status) || state.status === "pending");

/**
 * Keep the awaiting status when tracking stops for a transient reason, so a
 * tracking timeout while Domibus retries is not recorded as a failure.
 * Pending is kept only for timeout/network errors: other errors (e.g. RDF
 * validation rejection) are real failures. Errors after ACKNOWLEDGED are
 * failures because ACKNOWLEDGED is not an awaiting status.
 */
const keepsAwaitingStatus = (state: SyncState, error: unknown): boolean =>
  isAwaitingDomibus(state) &&
  (state.status !== "pending" ||
    (error instanceof DispatcherError &&
      (error.kind === "timeout" || error.kind === "network")));

const checksum = (rdf: string) =>
  createHash("sha256").update(rdf).digest("hex");

export class DatasetDeliveryService {
  constructor(
    private readonly repository: SyncStateRepository,
    private readonly dispatcher: NationalDispatcherClient,
  ) {}

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
      if (isTerminalDomibusStatus(existing.status)) {
        const retryable = await repo.save(datasetId, {
          dispatcherDatabaseId: null,
          correlationId: null,
          domibusMessageId: null,
          operation: "create",
          status: "failed",
          lastError: null,
        });
        return this.createLocked(repo, datasetId, rdf, digest, retryable);
      }
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
      domibusMessageId: null,
      operation: "create",
      status: "creating",
    });
    let databaseId: string;
    try {
      databaseId = await this.dispatcher.create(rdf);
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
    const pending = await repo.save(datasetId, {
      checksum: digest,
      dispatcherDatabaseId: databaseId,
      operation: "create",
      status: "pending",
    });
    try {
      return await this.resolve(repo, pending, "create");
    } catch (error) {
      const state = await this.recordFailure(repo, datasetId, error, "create");
      this.throwWithDeliveryContext(error, state);
    }
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
      let existing = await repo.get(datasetId);
      if (!existing) return { deleted: true };
      if (
        existing.operation === "delete" &&
        existing.dispatcherDatabaseId &&
        isTerminalDomibusStatus(existing.status)
      )
        existing = await repo.save(datasetId, {
          dispatcherDatabaseId: null,
          correlationId: null,
          domibusMessageId: null,
          operation: "delete",
          status: "failed",
          lastError: null,
        });
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
      await repo.save(datasetId, {
        domibusMessageId: null,
        operation: "delete",
        status: "deleting",
      });
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
      if (isTerminalDomibusStatus(existing.status)) {
        // Never mark the row delivered here: a crash before the resend must
        // not let the unchanged checksum skip this dataset on later syncs.
        const retryable = await repo.save(existing.datasetId, {
          dispatcherDatabaseId: null,
          correlationId: null,
          domibusMessageId: null,
          operation: "update",
          status: "failed",
          lastError: null,
        });
        return this.updateLocked(repo, retryable, rdf, digest);
      }
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
      domibusMessageId: null,
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
    let correlationId = state.correlationId;
    let acknowledgedStatus: DomibusStatus | undefined;
    if (!correlationId) {
      correlationId = await this.dispatcher.track(
        state.dispatcherDatabaseId,
        async (status: DomibusStatus) => {
          acknowledgedStatus = status;
          await repo.save(state.datasetId, { operation, status });
        },
      );
    }
    await repo.save(state.datasetId, {
      correlationId,
      domibusMessageId: correlationId,
      operation,
      status: acknowledgedStatus ?? state.status,
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
    const current = uncertain ? null : await repo.get(datasetId);
    return repo.save(datasetId, {
      operation,
      status: uncertain
        ? "uncertain"
        : current && keepsAwaitingStatus(current, error)
          ? current.status
          : error instanceof DispatcherError && error.domibusStatus
            ? error.domibusStatus
            : "failed",
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
        inFlight: isAwaitingDomibus(state),
      };
    }
    throw error;
  }
}
