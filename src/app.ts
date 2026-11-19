// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { createRunResolver } from "./application/resolve-run.js";
import { MetadataValidator } from "./validation/metadata-validator.js";
import Fastify from "fastify";
import type { AppConfig } from "./config/config.js";
import { registerDeliveryRoutes } from "./api/delivery-routes.js";
import { registerHealthRoutes } from "./api/health-routes.js";
import { registerSyncRoutes } from "./api/sync-routes.js";
import { SyncOrchestrator } from "./application/sync-orchestrator.js";
import { DatasetDeliveryService } from "./application/dataset-delivery-service.js";
import { NationalDispatcherClient } from "./dispatcher/national-dispatcher-client.js";
import { SyncStateRepository } from "./persistence/postgres/sync-state-repository.js";
import type { SyncRunRepository } from "./persistence/postgres/sync-run-repository.js";
import { CatalogueClient } from "./catalogue/catalogue-client.js";
import { SyncScheduler } from "./scheduler/sync-scheduler.js";
import { protectControlRoutes } from "./api/control-access.js";
import { registerMonitoringRoutes } from "./api/monitoring-routes.js";
import { RDF_BODY_LIMIT_BYTES } from "./config/config.js";

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
    bodyLimit: RDF_BODY_LIMIT_BYTES,
  });
  protectControlRoutes(app, config.controlApiToken);
  app.addContentTypeParser(
    ["application/rdf+xml", "text/turtle", "application/ld+json"],
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );
  const dispatcher = new NationalDispatcherClient(
    {
      ...config.dispatcher,
      validationEnabled: config.operationMode
        ? config.operationMode !== "sync_only"
        : config.dispatcher.validationEnabled,
    },
    fetchImpl,
  );
  const service = new DatasetDeliveryService(repository, dispatcher);
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
  app.addHook("preHandler", async (request, reply) => {
    if (
      !request.url.startsWith("/api/v1/dataset-deliveries") ||
      request.method === "GET"
    )
      return;
    if (config.operationMode === "validate_only")
      return reply.code(409).send({
        error: "operation_mode_conflict",
        message:
          "Dispatcher writes are disabled in validate_only mode; use the validation sync API",
      });
    if (
      config.operationMode === "validate_and_sync" &&
      ["POST", "PUT"].includes(request.method)
    ) {
      if (typeof request.body !== "string") return;
      const datasetId =
        request.method === "POST"
          ? request.headers["x-dataset-id"]
          : (request.params as { datasetId?: string }).datasetId;
      if (typeof datasetId !== "string") return;
      try {
        const report = await validator!.validate(datasetId, request.body);
        if (!report.conforms)
          return reply.code(422).send({ error: "validation_failed", report });
      } catch (error) {
        request.log.error({ err: error }, "Metadata validation failed");
        return reply.code(503).send({ error: "validation_unavailable" });
      }
    }
  });
  await registerDeliveryRoutes(app, service);
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
