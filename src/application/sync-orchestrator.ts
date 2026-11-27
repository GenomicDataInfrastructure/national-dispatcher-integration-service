// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { MetadataValidator } from "../validation/metadata-validator.js";
import { createHash, randomUUID } from "node:crypto";
import type { SyncRun } from "../domain/sync-run.js";
import {
  DispatcherError,
  type NationalDispatcherClient,
} from "../dispatcher/national-dispatcher-client.js";
import type {
  SyncRunRepository,
  RunCounts,
} from "../persistence/postgres/sync-run-repository.js";
import type { SyncStateRepository } from "../persistence/postgres/sync-state-repository.js";
import type { CatalogueClient } from "../catalogue/catalogue-client.js";
import { DatasetDeliveryService } from "./dataset-delivery-service.js";

import {
  InvalidRunOptionsError,
  type RunOptions,
  type RunContext,
  type ResolveRun,
} from "./run-options.js";

import type { OperationMode } from "../config/config.js";
import { CATALOGUE_SOURCE } from "../domain/source-system.js";

export class SyncAlreadyRunningError extends Error {}
export class ValidationUnavailableError extends Error {}
const emptyCounts = (): RunCounts => ({
  datasetsSeen: 0,
  datasetsCreated: 0,
  datasetsUpdated: 0,
  datasetsSkipped: 0,
  datasetsDeleted: 0,
  datasetsFailed: 0,
  datasetsInFlight: 0,
});
type RunProgress = { counts: RunCounts; reports: SyncRun["reports"] };
const checksum = (rdf: string) =>
  createHash("sha256").update(rdf).digest("hex");

/**
 * Count a delivery error as in flight when Domibus may still deliver the
 * message (e.g. tracking timed out during WAITING_FOR_RETRY), else as failed.
 */
function recordDeliveryError(
  counts: RunCounts,
  reports: SyncRun["reports"],
  datasetId: string,
  error: unknown,
  fallback = "Delivery failed",
): void {
  const context =
    error instanceof DispatcherError ? error.deliveryContext : undefined;
  if (context?.inFlight) {
    counts.datasetsInFlight++;
    reports.push({
      datasetId,
      deliveryStatus: context.status,
      note: `Still in flight (${context.status}); tracking resumes on the next run. Last tracking result: ${error instanceof Error ? error.message : fallback}`,
    });
    return;
  }
  reports.push({
    datasetId,
    error: error instanceof Error ? error.message : fallback,
  });
  counts.datasetsFailed++;
}

export class SyncOrchestrator {
  private active = false;
  constructor(
    private readonly catalogue: CatalogueClient,
    private readonly states: SyncStateRepository,
    private readonly runs: SyncRunRepository,
    private readonly dispatcher: NationalDispatcherClient,
    private readonly validator?: MetadataValidator,
    private readonly operationMode: OperationMode = "sync_only",
    private readonly resolveRun?: ResolveRun,
  ) {}

  async trigger(
    datasetId?: string,
    requestedMode?: "validate_only" | "validate" | "deliver" | RunOptions,
  ): Promise<SyncRun> {
    const options: RunOptions =
      typeof requestedMode === "object" ? requestedMode : {};
    const mode: OperationMode =
      options.operationMode ??
      (requestedMode === "validate_only" || requestedMode === "validate"
        ? "validate_only"
        : this.operationMode);
    if (this.active)
      throw new SyncAlreadyRunningError("A synchronization is already running");
    this.active = true;
    try {
      if (
        !this.resolveRun &&
        Object.keys(options).some((key) => key !== "operationMode")
      )
        throw new InvalidRunOptionsError(
          "Per-run validator selection is unavailable",
        );
      const context: RunContext = this.resolveRun
        ? await this.resolveRun({ ...options, operationMode: mode })
        : {
            catalogue: this.catalogue,
            dispatcher: this.dispatcher,
            validator: this.validator,
            mode,
            persistenceNamespace: CATALOGUE_SOURCE,
          };
      if (mode !== "sync_only" && !context.validator)
        throw new ValidationUnavailableError(
          "A metadata validator (local or METADATA_VALIDATOR_URL) is required for validation runs",
        );
      const run = context.settings
        ? await this.runs.create(
            randomUUID(),
            mode,
            context.persistenceNamespace,
            context.settings,
          )
        : await this.runs.create(
            randomUUID(),
            mode,
            context.persistenceNamespace,
          );
      const progress: RunProgress = { counts: emptyCounts(), reports: [] };
      void this.execute(run.runId, datasetId, context, progress).catch(
        async (error) => {
          this.active = false;
          const message =
            error instanceof Error
              ? error.message
              : "Unknown background sync error";
          try {
            await this.runs.finish(
              run.runId,
              "failed",
              progress.counts,
              `Background sync finalization failed: ${message}`,
              progress.reports.map((report) => ({
                ...report,
                sourceSystem: context.persistenceNamespace,
              })),
            );
          } catch (persistenceError) {
            console.error("Could not persist background sync failure", {
              runId: run.runId,
              error: persistenceError,
            });
          }
        },
      );
      return run;
    } catch (error) {
      this.active = false;
      throw error;
    }
  }

  getRun(runId: string): Promise<SyncRun | null> {
    return this.runs.get(runId);
  }

  private async execute(
    runId: string,
    datasetId: string | undefined,
    context: RunContext,
    progress: RunProgress,
  ): Promise<void> {
    const { mode, catalogue, validator, persistenceNamespace } = context;
    const { counts, reports } = progress;
    try {
      const result = await this.runs.withSyncLock(async () => {
        await this.runs.setRunning(runId);
        if (mode === "validate_only") {
          const datasets = datasetId
            ? [await catalogue.getDataset(datasetId)]
            : await catalogue.listDatasets();
          counts.datasetsSeen = datasets.length;
          for (const dataset of datasets) {
            const digest = checksum(dataset.rdf);
            try {
              const report = await validator!.validate(
                dataset.datasetId,
                dataset.rdf,
              );
              reports.push({ ...report, checksum: digest });
              if (!report.conforms) counts.datasetsFailed++;
            } catch (error) {
              counts.datasetsFailed++;
              reports.push({
                datasetId: dataset.datasetId,
                checksum: digest,
                error:
                  error instanceof Error ? error.message : "Validation failed",
              });
            }
          }
        } else await this.synchronize(counts, datasetId, reports, context);
      });
      if (result === null)
        throw new SyncAlreadyRunningError(
          "A synchronization is already running in another instance",
        );
      await this.runs.finish(
        runId,
        "completed",
        counts,
        null,
        reports.map((report) => ({
          ...report,
          sourceSystem: persistenceNamespace,
        })),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown sync error";
      await this.runs.finish(
        runId,
        "failed",
        counts,
        message,
        reports.map((report) => ({
          ...report,
          sourceSystem: persistenceNamespace,
        })),
      );
    } finally {
      this.active = false;
    }
  }

  private async synchronize(
    counts: RunCounts,
    datasetId: string | undefined,
    reports: SyncRun["reports"],
    context: RunContext,
  ): Promise<void> {
    const { mode, catalogue, validator, persistenceNamespace, dispatcher } =
      context;
    const repository = this.states.forSource(persistenceNamespace);
    const delivery = new DatasetDeliveryService(repository, dispatcher);
    const datasets = datasetId
      ? [await catalogue.getDataset(datasetId)]
      : await catalogue.listDatasets();
    counts.datasetsSeen = datasets.length;

    for (const dataset of datasets) {
      try {
        const digest = checksum(dataset.rdf);
        if (mode === "validate_and_sync") {
          const report = await validator!.validate(
            dataset.datasetId,
            dataset.rdf,
          );
          reports.push({ ...report, checksum: digest });
          if (!report.conforms) {
            counts.datasetsFailed++;
            continue;
          }
        }
        const result = await delivery.synchronize(
          dataset.datasetId,
          dataset.rdf,
        );
        if (result.operation === "skipped") counts.datasetsSkipped++;
        else if (result.operation === "updated") counts.datasetsUpdated++;
        else counts.datasetsCreated++;
      } catch (error) {
        recordDeliveryError(counts, reports, dataset.datasetId, error);
      }
    }

    if (!datasetId) {
      const knownIds = await repository.listDatasetIds();
      const deletedIds = await catalogue.listDeletedDatasetIds(knownIds);
      for (const deletedId of deletedIds) {
        try {
          await delivery.delete(deletedId);
          counts.datasetsDeleted++;
        } catch (error) {
          recordDeliveryError(
            counts,
            reports,
            deletedId,
            error,
            "Delete failed",
          );
        }
      }
    }
  }
}
