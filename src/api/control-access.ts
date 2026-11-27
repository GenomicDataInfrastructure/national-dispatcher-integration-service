// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

export function protectControlRoutes(app: FastifyInstance, token?: string) {
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (!token)
      return reply.code(503).send({
        error: "controls_disabled",
        message: "CONTROL_API_TOKEN is not configured",
      });
    const authorization = request.headers.authorization ?? "";
    const expected = Buffer.from(`Bearer ${token}`);
    const received = Buffer.from(authorization);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return reply
        .header("WWW-Authenticate", "Bearer")
        .code(401)
        .send({ error: "unauthorized" });
    }
  });
}
