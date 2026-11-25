// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type pg from "pg";
import type {
  DeliveryOperation,
  DeliveryStatus,
} from "../../domain/delivery-status.js";
import type { SyncState } from "../../domain/sync-state.js";
import { ADAPTER_SOURCE } from "../../domain/source-system.js";

type DbState = {
  source_system?: string;
  dataset_id?: string;
  source_dataset_id?: string;
  checksum: string | null;
  dispatcher_database_id: string | null;
  central_platform_object_id: string | null;
  correlation_id: string | null;
  domibus_message_id: string | null;
  operation: DeliveryOperation | null;
  status: DeliveryStatus;
  retry_count: number;
  last_error: string | null;
  last_attempted_at: Date | null;
  last_successful_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapState(row: DbState): SyncState {
  return {
    sourceSystem: row.source_system ?? ADAPTER_SOURCE,
    datasetId: row.source_dataset_id ?? row.dataset_id!,
    checksum: row.checksum,
    dispatcherDatabaseId: row.dispatcher_database_id,
    centralPlatformObjectId: row.central_platform_object_id,
    correlationId: row.correlation_id,
    domibusMessageId: row.domibus_message_id ?? row.correlation_id,
    operation: row.operation,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    lastAttemptedAt: row.last_attempted_at,
    lastSuccessfulAt: row.last_successful_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type StateUpdate = {
  checksum?: string | null;
  dispatcherDatabaseId?: string | null;
  centralPlatformObjectId?: string | null;
  correlationId?: string | null;
  domibusMessageId?: string | null;
  operation?: DeliveryOperation | null;
  status: DeliveryStatus;
  lastError?: string | null;
  incrementRetry?: boolean;
  successful?: boolean;
};

export class SyncStateRepository {
  public constructor(
    private readonly pool: pg.Pool,
    private readonly schema: string,
    private readonly sourceSystem: string = ADAPTER_SOURCE,
  ) {}

  forSource(sourceSystem: string): SyncStateRepository {
    return new SyncStateRepository(this.pool, this.schema, sourceSystem);
  }

  async withDatasetLock<T>(
    datasetId: string,
    work: (repository: SyncStateRepository) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    const lockKey =
      this.sourceSystem === ADAPTER_SOURCE
        ? datasetId
        : `${this.sourceSystem}:${datasetId}`;
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        lockKey,
      ]);
      return await work(
        new SyncStateRepository(
          client as unknown as pg.Pool,
          this.schema,
          this.sourceSystem,
        ),
      );
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        lockKey,
      ]);
      client.release();
    }
  }

  async get(datasetId: string): Promise<SyncState | null> {
    const result = await this.pool.query<DbState>(
      `SELECT * FROM "${this.schema}".dataset_delivery_sync WHERE source_system = $1 AND source_dataset_id = $2`,
      [this.sourceSystem, datasetId],
    );
    return result.rows[0] ? mapState(result.rows[0]) : null;
  }

  async save(datasetId: string, update: StateUpdate): Promise<SyncState> {
    const result = await this.pool.query<DbState>(
      `INSERT INTO "${this.schema}".dataset_delivery_sync
       (source_system, source_dataset_id, checksum, dispatcher_database_id, central_platform_object_id, correlation_id, domibus_message_id, operation, status,
        retry_count, last_error, last_attempted_at, last_successful_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $11 THEN 1 ELSE 0 END, $10, NOW(), CASE WHEN $12 THEN NOW() ELSE NULL END)
       ON CONFLICT (source_system, source_dataset_id) DO UPDATE SET
         checksum = COALESCE($3, dataset_delivery_sync.checksum),
         dispatcher_database_id = CASE WHEN $13 THEN $4 ELSE dataset_delivery_sync.dispatcher_database_id END,
         central_platform_object_id = CASE WHEN $14 THEN $5 ELSE dataset_delivery_sync.central_platform_object_id END,
         correlation_id = CASE WHEN $15 THEN $6 ELSE dataset_delivery_sync.correlation_id END,
         domibus_message_id = CASE WHEN $16 THEN $7 ELSE dataset_delivery_sync.domibus_message_id END,
         operation = $8, status = $9,
         retry_count = dataset_delivery_sync.retry_count + CASE WHEN $11 THEN 1 ELSE 0 END,
         last_error = $10, last_attempted_at = NOW(),
         last_successful_at = CASE WHEN $12 THEN NOW() ELSE dataset_delivery_sync.last_successful_at END,
         updated_at = NOW()
       RETURNING *`,
      [
        this.sourceSystem,
        datasetId,
        update.checksum ?? null,
        update.dispatcherDatabaseId ?? null,
        update.centralPlatformObjectId ?? null,
        update.correlationId ?? null,
        update.domibusMessageId ?? null,
        update.operation ?? null,
        update.status,
        update.lastError ?? null,
        update.incrementRetry ?? false,
        update.successful ?? false,
        Object.hasOwn(update, "dispatcherDatabaseId"),
        Object.hasOwn(update, "centralPlatformObjectId"),
        Object.hasOwn(update, "correlationId"),
        Object.hasOwn(update, "domibusMessageId"),
      ],
    );
    return mapState(result.rows[0]!);
  }

  async remove(datasetId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM "${this.schema}".dataset_delivery_sync WHERE source_system = $1 AND source_dataset_id = $2`,
      [this.sourceSystem, datasetId],
    );
  }

  async listDatasetIds(): Promise<string[]> {
    const result = await this.pool.query<{ source_dataset_id: string }>(
      `SELECT source_dataset_id FROM "${this.schema}".dataset_delivery_sync WHERE source_system = $1`,
      [this.sourceSystem],
    );
    return result.rows.map((row) => row.source_dataset_id);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async listRecent(
    limit: number,
    offset: number,
    source: string | null,
    status: string | null,
  ): Promise<SyncState[]> {
    const result = await this.pool.query<DbState>(
      `SELECT * FROM "${this.schema}".dataset_delivery_sync
       WHERE ($3::text IS NULL OR source_system = $3) AND ($4::text IS NULL OR status = $4)
       ORDER BY updated_at DESC, source_system, source_dataset_id LIMIT $1 OFFSET $2`,
      [limit, offset, source, status],
    );
    return result.rows.map(mapState);
  }

  async statusCounts(): Promise<Record<string, number>> {
    const result = await this.pool.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*)::text AS count FROM "${this.schema}".dataset_delivery_sync GROUP BY status`,
    );
    return Object.fromEntries(
      result.rows.map((row) => [row.status, Number(row.count)]),
    );
  }
}
