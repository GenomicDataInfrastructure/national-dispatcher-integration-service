import type { OperationMode } from "../../config/config.js";
import type { ValidationEvidence } from "../../domain/compliance-state.js";
import {
  CATALOGUE_PERSISTENCE_NAMESPACE,
  displaySourceSystem,
} from "../../domain/source-system.js";
// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type pg from "pg";
import type { SyncRun, SyncRunStatus } from "../../domain/sync-run.js";

type RunRow = {
  settings?: SyncRun["settings"];
  source_system?: string;
  mode: SyncRun["mode"] | "deliver" | "validate";
  reports: SyncRun["reports"];
  run_id: string;
  status: SyncRunStatus;
  started_at: Date;
  completed_at: Date | null;
  datasets_seen: number;
  datasets_created: number;
  datasets_updated: number;
  datasets_skipped: number;
  datasets_deleted: number;
  datasets_failed: number;
  datasets_in_flight: number;
  error: string | null;
};

const map = (row: RunRow): SyncRun => ({
  sourceSystem: displaySourceSystem(row.source_system),
  mode:
    row.mode === "validate"
      ? "validate_only"
      : row.mode === "deliver"
        ? "legacy_delivery"
        : row.mode,
  reports: row.reports.map((report) => ({
    ...report,
    ...(report.sourceSystem
      ? { sourceSystem: displaySourceSystem(report.sourceSystem) }
      : {}),
  })),
  ...(row.settings
    ? {
        settings: {
          ...row.settings,
          source: displaySourceSystem(row.settings.source),
        },
      }
    : {}),
  runId: row.run_id,
  status: row.status,
  startedAt: row.started_at,
  completedAt: row.completed_at,
  datasetsSeen: row.datasets_seen,
  datasetsCreated: row.datasets_created,
  datasetsUpdated: row.datasets_updated,
  datasetsSkipped: row.datasets_skipped,
  datasetsDeleted: row.datasets_deleted,
  datasetsFailed: row.datasets_failed,
  datasetsInFlight: row.datasets_in_flight ?? 0,
  error: row.error,
});

const MAX_REPORTS_JSON_BYTES = 4 * 1024 * 1024;
const MAX_STORED_REPORT_TEXT = 16 * 1024;

function boundedReports(reports: SyncRun["reports"]): SyncRun["reports"] {
  const stored: SyncRun["reports"] = [];
  let bytes = 2; // JSON array delimiters
  for (const report of reports) {
    const compact = {
      ...report,
      ...(report.report && report.report.length > MAX_STORED_REPORT_TEXT
        ? {
            report: `${report.report.slice(0, MAX_STORED_REPORT_TEXT)}\n[report truncated]`,
          }
        : {}),
      ...(report.findings && report.findings.length > 100
        ? { findings: report.findings.slice(0, 100) }
        : {}),
    };
    const itemBytes =
      Buffer.byteLength(JSON.stringify(compact)) + (stored.length ? 1 : 0);
    if (bytes + itemBytes > MAX_REPORTS_JSON_BYTES) {
      stored.push({
        datasetId: "(additional reports omitted)",
        error: "Detailed reports exceeded the 4 MiB storage limit.",
      });
      break;
    }
    stored.push(compact);
    bytes += itemBytes;
  }
  return stored;
}

export type RunCounts = Pick<
  SyncRun,
  | "datasetsSeen"
  | "datasetsCreated"
  | "datasetsUpdated"
  | "datasetsSkipped"
  | "datasetsDeleted"
  | "datasetsFailed"
  | "datasetsInFlight"
>;

export class SyncRunRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly schema: string,
  ) {}

  async create(
    runId: string,
    mode: OperationMode = "sync_only",
    // The catalogue replaced the old default source in this namespace to preserve delivery state.
    sourceSystem: string = CATALOGUE_PERSISTENCE_NAMESPACE,
    settings?: SyncRun["settings"],
  ): Promise<SyncRun> {
    const result = await this.pool.query<RunRow>(
      `INSERT INTO "${this.schema}".sync_runs (run_id, status, mode, source_system, settings) VALUES ($1, 'queued', $2, $3, $4::jsonb) RETURNING *`,
      [runId, mode, sourceSystem, settings ? JSON.stringify(settings) : null],
    );
    return map(result.rows[0]!);
  }

  async setRunning(runId: string): Promise<void> {
    await this.pool.query(
      `UPDATE "${this.schema}".sync_runs SET status = 'running' WHERE run_id = $1`,
      [runId],
    );
  }

  async finish(
    runId: string,
    status: "completed" | "failed",
    counts: RunCounts,
    error: string | null = null,
    reports: SyncRun["reports"] = [],
  ): Promise<void> {
    await this.pool.query(
      `UPDATE "${this.schema}".sync_runs SET status=$2, completed_at=NOW(), datasets_seen=$3, datasets_created=$4, datasets_updated=$5, datasets_skipped=$6, datasets_deleted=$7, datasets_failed=$8, datasets_in_flight=$9, error=$10, reports=$11::jsonb WHERE run_id=$1`,
      [
        runId,
        status,
        counts.datasetsSeen,
        counts.datasetsCreated,
        counts.datasetsUpdated,
        counts.datasetsSkipped,
        counts.datasetsDeleted,
        counts.datasetsFailed,
        counts.datasetsInFlight,
        error,
        JSON.stringify(boundedReports(reports)),
      ],
    );
  }

  async get(runId: string): Promise<SyncRun | null> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM "${this.schema}".sync_runs WHERE run_id=$1`,
      [runId],
    );
    return result.rows[0] ? map(result.rows[0]) : null;
  }

  async latestValidationReports(
    datasetIds: string[],
    sourceSystem: string = CATALOGUE_PERSISTENCE_NAMESPACE,
  ): Promise<ValidationEvidence[]> {
    if (!datasetIds.length) return [];
    const result = await this.pool.query<{
      evidence: Omit<ValidationEvidence, "checkedAt" | "runId">;
      checked_at: Date;
      run_id: string;
    }>(
      `SELECT DISTINCT ON (item->>'datasetId') item AS evidence, completed_at AS checked_at, run_id
       FROM "${this.schema}".sync_runs CROSS JOIN LATERAL jsonb_array_elements(reports) AS item
       WHERE COALESCE(item->>'sourceSystem', 'userportal') = $2 AND (mode IN ('validate', 'validate_only') OR item ? 'conforms') AND completed_at IS NOT NULL AND item->>'datasetId' = ANY($1::text[])
       ORDER BY item->>'datasetId', started_at DESC, run_id DESC`,
      [datasetIds, sourceSystem],
    );
    return result.rows.map((row) => ({
      ...row.evidence,
      checkedAt: row.checked_at,
      runId: row.run_id,
    }));
  }

  async listRecent(limit: number, offset: number): Promise<SyncRun[]> {
    const result = await this.pool.query<RunRow>(
      `SELECT * FROM "${this.schema}".sync_runs ORDER BY started_at DESC, run_id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows.map(map);
  }

  async withSyncLock<T>(work: () => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    // Keep this key stable so rolling upgrades still share the same advisory lock.
    const key = "userportal-dataset-sync";
    try {
      const locked = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [key],
      );
      if (!locked.rows[0]?.locked) return null;
      try {
        return await work();
      } finally {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [key],
        );
      }
    } finally {
      client.release();
    }
  }
}
