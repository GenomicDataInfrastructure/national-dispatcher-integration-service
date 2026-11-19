// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DatasetDeliveryService,
  DeliveryConflictError,
  DeliveryNotFoundError,
} from "../application/dataset-delivery-service.js";
import { DispatcherError } from "../dispatcher/national-dispatcher-client.js";

const paramsSchema = z.object({ datasetId: z.string().min(1).max(512) });
const headerSchema = z.object({ "x-dataset-id": z.string().min(1).max(512) });

function rdfBody(request: FastifyRequest): string {
  if (typeof request.body !== "string" || request.body.trim().length === 0)
    throw new z.ZodError([]);
  return request.body;
}

function sendError(error: unknown, reply: FastifyReply) {
  if (error instanceof z.ZodError)
    return reply.code(400).send({
      error: "invalid_request",
      message: "A non-empty RDF body and valid dataset ID are required",
    });
  if (error instanceof DeliveryNotFoundError)
    return reply.code(404).send({ error: "not_found", message: error.message });
  if (error instanceof DeliveryConflictError)
    return reply
      .code(409)
      .send({ error: "delivery_conflict", message: error.message });
  if (error instanceof DispatcherError)
    return reply.code(error.statusCode).send({
      error: `dispatcher_${error.kind}`,
      message: error.message,
      ...(error.deliveryContext ?? {}),
    });
  requestSafeLog(reply, error);
  return reply
    .code(500)
    .send({ error: "internal_error", message: "Dataset delivery failed" });
}

function requestSafeLog(reply: FastifyReply, error: unknown) {
  reply.log.error({ err: error }, "Dataset delivery failed");
}

export async function registerDeliveryRoutes(
  app: FastifyInstance,
  service: DatasetDeliveryService,
) {
  app.post("/api/v1/dataset-deliveries", async (request, reply) => {
    try {
      const datasetId = headerSchema.parse(request.headers)["x-dataset-id"];
      const state = await service.create(datasetId, rdfBody(request));
      return reply.code(state.status === "delivered" ? 201 : 202).send(state);
    } catch (error) {
      return sendError(error, reply);
    }
  });
  app.put("/api/v1/dataset-deliveries/:datasetId", async (request, reply) => {
    try {
      const { datasetId } = paramsSchema.parse(request.params);
      return reply.send(await service.update(datasetId, rdfBody(request)));
    } catch (error) {
      return sendError(error, reply);
    }
  });
  app.delete(
    "/api/v1/dataset-deliveries/:datasetId",
    async (request, reply) => {
      try {
        const { datasetId } = paramsSchema.parse(request.params);
        await service.delete(datasetId);
        return reply.code(204).send();
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
  app.get(
    "/api/v1/dataset-deliveries/:datasetId/status",
    async (request, reply) => {
      try {
        const { datasetId } = paramsSchema.parse(request.params);
        return reply.send(await service.status(datasetId));
      } catch (error) {
        return sendError(error, reply);
      }
    },
  );
}
