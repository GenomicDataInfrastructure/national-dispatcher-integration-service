// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { FastifyInstance } from "fastify";
import { SyncStateRepository } from "../persistence/postgres/sync-state-repository.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  repository: SyncStateRepository,
) {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await repository.ping();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
}
