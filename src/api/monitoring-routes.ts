// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { AppConfig } from "../config/config.js";
import { withValidationFindings } from "./validation-report-view.js";
import { complianceState } from "../domain/compliance-state.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SyncStateRepository } from "../persistence/postgres/sync-state-repository.js";
import type { SyncRunRepository } from "../persistence/postgres/sync-run-repository.js";
import { dashboardHtml, dashboardCss, dashboardJs } from "./dashboard-page.js";
import {
  ATTENTION_STATUSES,
  DELIVERY_STATUSES,
  attentionAction,
} from "../domain/delivery-status.js";
import { summarizeDeliveries, syncHealth } from "../application/sync-health.js";
import { CATALOGUE_SOURCE } from "../domain/source-system.js";

const ATTENTION_LIMIT = 10;

const datasetParams = z.object({ datasetId: z.string().min(1).max(512) });

const query = z.object({
  stateOffset: z.coerce.number().int().min(0).max(1000000).default(0),
  runOffset: z.coerce.number().int().min(0).max(1000000).default(0),
  status: z.enum(DELIVERY_STATUSES).optional(),
});

export async function registerMonitoringRoutes(
  app: FastifyInstance,
  states: SyncStateRepository,
  runs?: SyncRunRepository,
  config?: AppConfig,
) {
  app.get("/", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      )
      .header("X-Frame-Options", "DENY")
      .header("X-Content-Type-Options", "nosniff")
      .type("text/html")
      .send(dashboardHtml),
  );
  app.get("/dashboard.css", async (_request, reply) =>
    reply.type("text/css").send(dashboardCss),
  );
  app.get("/dashboard.js", async (_request, reply) =>
    reply.type("application/javascript").send(dashboardJs),
  );
  app.get("/api/v1/datasets/:datasetId/status", async (request, reply) => {
    const parsed = datasetParams.safeParse(request.params);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    const state = await states
      .forSource(CATALOGUE_SOURCE)
      .get(parsed.data.datasetId);
    reply.header("Cache-Control", "no-store");
    if (!state)
      return reply.code(404).send({
        error: "not_found",
        message: "No delivery state is recorded for this catalogue dataset",
      });
    return state;
  });
  app.get("/api/v1/monitoring", async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    const { stateOffset, runOffset, status } = parsed.data;
    reply.header("Cache-Control", "no-store");
    const [deliveries, recentRuns, counts, attentionStates, runHealth] =
      await Promise.all([
        states.listRecent(26, stateOffset, status ?? null),
        runs ? runs.listRecent(11, runOffset) : Promise.resolve([]),
        states.statusCounts(),
        states.listByStatuses(ATTENTION_STATUSES, ATTENTION_LIMIT),
        runs
          ? runs.healthSnapshot()
          : Promise.resolve({
              active: null,
              lastCompleted: null,
              latest: null,
            }),
      ]);
    const summary = summarizeDeliveries(counts);
    const page = deliveries.slice(0, 25);
    const evidence = runs
      ? await runs.latestValidationReports(
          page.map((state) => state.datasetId),
          CATALOGUE_SOURCE,
        )
      : [];
    const hydratedEvidence = await Promise.all(
      evidence.map((item) => withValidationFindings(item)),
    );
    const byId = new Map(
      hydratedEvidence.map((item) => [item.datasetId, item]),
    );
    const visibleRuns = await Promise.all(
      recentRuns.slice(0, 10).map(async (run) => ({
        ...run,
        reports: await Promise.all(
          (run.reports ?? []).map((item) => withValidationFindings(item)),
        ),
      })),
    );
    return {
      metadataSource: config?.catalogue ? CATALOGUE_SOURCE : null,
      operationMode: config?.operationMode ?? "sync_only",
      validationMode: config?.metadataValidatorOptions?.mode ?? null,
      validationVersion: config?.metadataValidatorOptions?.version ?? null,
      release8Profile: config?.release8ValidationProfile ?? null,
      observedAt: new Date().toISOString(),
      counts,
      summary,
      health: syncHealth(config?.sync, runHealth, new Date()),
      attention: {
        total: summary.attention,
        items: attentionStates.map((state) => ({
          datasetId: state.datasetId,
          sourceSystem: state.sourceSystem,
          status: state.status,
          operation: state.operation,
          retryCount: state.retryCount,
          lastError: state.lastError,
          lastAttemptedAt: state.lastAttemptedAt,
          action: attentionAction(state.status),
        })),
      },
      deliveries: page.map((state) => ({
        ...state,
        compliance: complianceState(
          state.checksum,
          byId.get(state.datasetId),
          config?.release8ValidationProfile,
        ),
      })),
      hasMoreDeliveries: deliveries.length > 25,
      runs: visibleRuns,
      hasMoreRuns: recentRuns.length > 10,
    };
  });
}
