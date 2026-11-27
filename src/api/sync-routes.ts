// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  SyncAlreadyRunningError,
  SyncOrchestrator,
  ValidationUnavailableError,
} from "../application/sync-orchestrator.js";

import {
  InvalidRunOptionsError,
  runOptionsSchema,
  type RunOptions,
} from "../application/run-options.js";

const datasetParams = z.object({
  datasetId: z.string().min(1).max(512),
});
const modeQuery = z
  .object({ mode: z.literal("validate_only").optional() })
  .strict();

/** `?mode=validate_only` is a shortcut for `{"operationMode":"validate_only"}`. */
function optionsFor(query: unknown, body: unknown): RunOptions {
  const { mode } = modeQuery.parse(query);
  const options = runOptionsSchema.parse(body ?? {});
  if (!mode) return options;
  if (Object.keys(options).length)
    throw new InvalidRunOptionsError(
      "Use either the JSON run options or ?mode=validate_only, not both",
    );
  return { operationMode: mode };
}
const runParams = z.object({ runId: z.string().uuid() });

function errorReply(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError)
    return reply.code(400).send({ error: "invalid_request" });
  if (error instanceof InvalidRunOptionsError)
    return reply
      .code(400)
      .send({ error: "invalid_run_options", message: error.message });
  if (error instanceof SyncAlreadyRunningError)
    return reply
      .code(409)
      .send({ error: "sync_already_running", message: error.message });
  if (error instanceof ValidationUnavailableError)
    return reply
      .code(503)
      .send({ error: "validation_unavailable", message: error.message });
  reply.log.error({ err: error }, "Synchronization request failed");
  return reply.code(500).send({ error: "internal_error" });
}

export async function registerSyncRoutes(
  app: FastifyInstance,
  orchestrator: SyncOrchestrator,
) {
  const trigger = async (reply: FastifyReply, options: RunOptions) => {
    try {
      const run = await orchestrator.trigger(undefined, options);
      return reply.code(202).send({
        runId: run.runId,
        mode: run.mode,
        status: run.status,
        ...(run.settings ? { settings: run.settings } : {}),
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  };

  app.post("/api/v1/sync", async (request, reply) => {
    try {
      return await trigger(reply, optionsFor(request.query, request.body));
    } catch (error) {
      return errorReply(error, reply);
    }
  });
  app.post("/api/v1/sync/dataset/:datasetId", async (request, reply) => {
    try {
      const { datasetId } = datasetParams.parse(request.params);
      const run = await orchestrator.trigger(
        datasetId,
        optionsFor(request.query, request.body),
      );
      return reply.code(202).send({
        runId: run.runId,
        mode: run.mode,
        status: run.status,
        ...(run.settings ? { settings: run.settings } : {}),
      });
    } catch (error) {
      return errorReply(error, reply);
    }
  });
  app.get("/api/v1/sync/:runId", async (request, reply) => {
    try {
      const { runId } = runParams.parse(request.params);
      const run = await orchestrator.getRun(runId);
      return run
        ? reply.send(run)
        : reply.code(404).send({ error: "sync_run_not_found" });
    } catch (error) {
      return errorReply(error, reply);
    }
  });
}
