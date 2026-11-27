// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { createRunResolver } from "./application/resolve-run.js";
import { MetadataValidator } from "./validation/metadata-validator.js";
import Fastify from "fastify";
import type { AppConfig } from "./config/config.js";
import { registerHealthRoutes } from "./api/health-routes.js";
import { registerSyncRoutes } from "./api/sync-routes.js";
import { SyncOrchestrator } from "./application/sync-orchestrator.js";
import { NationalDispatcherClient } from "./dispatcher/national-dispatcher-client.js";
import { SyncStateRepository } from "./persistence/postgres/sync-state-repository.js";
import type { SyncRunRepository } from "./persistence/postgres/sync-run-repository.js";
import { CatalogueClient } from "./catalogue/catalogue-client.js";
import { SyncScheduler } from "./scheduler/sync-scheduler.js";
import { protectControlRoutes } from "./api/control-access.js";
import { registerMonitoringRoutes } from "./api/monitoring-routes.js";

export async function buildApp(
  config: AppConfig,
  repository: SyncStateRepository,
  fetchImpl: typeof fetch = fetch,
  syncRuns?: SyncRunRepository,
) {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.x-api-key",
        "req.headers.authorization",
        "req.body",
        "res.body",
      ],
    },
  });
  protectControlRoutes(app, config.controlApiToken);
  const dispatcher = new NationalDispatcherClient(
    {
      ...config.dispatcher,
      validationEnabled: config.operationMode
        ? config.operationMode !== "sync_only"
        : config.dispatcher.validationEnabled,
    },
    fetchImpl,
  );
  const localValidation = config.metadataValidatorOptions?.mode === "shacl";
  const validator =
    localValidation || config.metadataValidatorUrl
      ? new MetadataValidator(
          config.metadataValidatorUrl ?? "",
          fetchImpl,
          config.metadataValidatorOptions,
        )
      : undefined;
  if (
    config.operationMode &&
    config.operationMode !== "sync_only" &&
    !validator
  )
    throw new Error(
      "Configure local validation shapes or METADATA_VALIDATOR_URL for validation modes",
    );
  if (
    localValidation &&
    config.operationMode !== "sync_only" &&
    !config.metadataValidatorOptions?.shapesFile
  )
    throw new Error(
      "METADATA_VALIDATOR_SHAPES_FILE is required for local validation",
    );
  await registerHealthRoutes(app, repository);
  await registerMonitoringRoutes(app, repository, syncRuns, config);
  if (syncRuns) {
    if (!config.catalogue)
      throw new Error(
        "DATASET_CATALOGUE_RDF_URL is required when sync is enabled",
      );
    const orchestrator = new SyncOrchestrator(
      new CatalogueClient(config.catalogue, fetchImpl),
      repository,
      syncRuns,
      dispatcher,
      validator,
      config.operationMode,
      createRunResolver(config, fetchImpl),
    );
    await registerSyncRoutes(app, orchestrator);
    if (config.sync.enabled) {
      const scheduler = new SyncScheduler(
        orchestrator,
        config.sync.schedule,
        (error) => app.log.error({ err: error }, "Scheduled sync failed"),
      );
      scheduler.start();
      app.addHook("onClose", async () => scheduler.stop());
    }
  }
  return app;
}
