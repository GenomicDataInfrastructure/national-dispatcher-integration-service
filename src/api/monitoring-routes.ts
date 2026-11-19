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
import { DELIVERY_STATUSES } from "../domain/delivery-status.js";
import {
  CATALOGUE_SOURCE,
  CATALOGUE_PERSISTENCE_NAMESPACE,
  LEGACY_HEALTHDATA_SOURCE,
  SOURCE_SYSTEMS,
  displaySourceSystem,
  persistenceSourceSystem,
} from "../domain/source-system.js";

const query = z.object({
  stateOffset: z.coerce.number().int().min(0).max(1000000).default(0),
  runOffset: z.coerce.number().int().min(0).max(1000000).default(0),
  source: z.enum(SOURCE_SYSTEMS).optional(),
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
  app.get("/api/v1/monitoring", async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({ error: "invalid_request" });
    const { stateOffset, runOffset, source, status } = parsed.data;
    const persistedSource = persistenceSourceSystem(source);
    reply.header("Cache-Control", "no-store");
    const [deliveries, recentRuns, counts] = await Promise.all([
      states.listRecent(
        26,
        stateOffset,
        persistedSource ?? null,
        status ?? null,
      ),
      runs ? runs.listRecent(11, runOffset) : Promise.resolve([]),
      states.statusCounts(),
    ]);
    const page = deliveries.slice(0, 25);
    const evidence = runs
      ? (
          await Promise.all(
            (
              [
                {
                  source: CATALOGUE_SOURCE,
                  persistedSource: CATALOGUE_PERSISTENCE_NAMESPACE,
                },
                {
                  source: LEGACY_HEALTHDATA_SOURCE,
                  persistedSource: LEGACY_HEALTHDATA_SOURCE,
                },
              ] as const
            ).map(async ({ source, persistedSource }) =>
              (
                await runs.latestValidationReports(
                  page
                    .filter((state) => state.sourceSystem === persistedSource)
                    .map((state) => state.datasetId),
                  persistedSource,
                )
              ).map((item) => ({ ...item, sourceSystem: source })),
            ),
          )
        ).flat()
      : [];
    const hydratedEvidence = await Promise.all(
      evidence.map((item) => withValidationFindings(item)),
    );
    const byId = new Map(
      hydratedEvidence.map((item) => [
        `${item.sourceSystem}:${item.datasetId}`,
        item,
      ]),
    );
    const visibleRuns = await Promise.all(
      recentRuns.slice(0, 10).map(async (run) => ({
        ...run,
        sourceSystem: displaySourceSystem(run.sourceSystem),
        settings:
          run.settings?.source === CATALOGUE_PERSISTENCE_NAMESPACE
            ? { ...run.settings, source: CATALOGUE_SOURCE }
            : run.settings,
        reports: await Promise.all(
          (run.reports ?? []).map(async (item) =>
            withValidationFindings({
              ...item,
              sourceSystem: displaySourceSystem(item.sourceSystem),
            }),
          ),
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
      deliveries: page.map((state) => {
        const sourceSystem = displaySourceSystem(state.sourceSystem);
        return {
          ...state,
          sourceSystem,
          compliance: complianceState(
            state.checksum,
            [CATALOGUE_SOURCE, LEGACY_HEALTHDATA_SOURCE].includes(
              sourceSystem as
                typeof CATALOGUE_SOURCE | typeof LEGACY_HEALTHDATA_SOURCE,
            )
              ? byId.get(`${sourceSystem}:${state.datasetId}`)
              : undefined,
            config?.release8ValidationProfile,
          ),
        };
      }),
      hasMoreDeliveries: deliveries.length > 25,
      runs: visibleRuns,
      hasMoreRuns: recentRuns.length > 10,
    };
  });
}
