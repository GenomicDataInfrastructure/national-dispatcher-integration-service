-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS dataset_delivery_sync (
  source_system TEXT NOT NULL,
  source_dataset_id TEXT NOT NULL,
  checksum TEXT,
  dispatcher_database_id TEXT,
  central_platform_object_id TEXT,
  correlation_id TEXT,
  operation TEXT CHECK (operation IN ('create', 'update', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'delivered', 'updating', 'deleting', 'failed', 'uncertain')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  last_successful_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_dataset_id)
);

CREATE INDEX IF NOT EXISTS dataset_delivery_sync_status_idx
  ON dataset_delivery_sync (source_system, status);

INSERT INTO dataset_delivery_sync
  (source_system, source_dataset_id, checksum, dispatcher_database_id, central_platform_object_id, correlation_id, operation, status, retry_count, last_error, last_attempted_at, last_successful_at, created_at, updated_at)
SELECT 'adapter', dataset_id, checksum, dispatcher_database_id, central_platform_object_id, correlation_id, operation, status, retry_count, last_error, last_attempted_at, last_successful_at, created_at, updated_at
FROM dataset_delivery_state
ON CONFLICT (source_system, source_dataset_id) DO NOTHING;

DROP TABLE IF EXISTS dataset_delivery_state;

CREATE TABLE IF NOT EXISTS sync_runs (
  run_id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  datasets_seen INTEGER NOT NULL DEFAULT 0,
  datasets_created INTEGER NOT NULL DEFAULT 0,
  datasets_updated INTEGER NOT NULL DEFAULT 0,
  datasets_skipped INTEGER NOT NULL DEFAULT 0,
  datasets_deleted INTEGER NOT NULL DEFAULT 0,
  datasets_failed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS sync_runs_source_started_idx
  ON sync_runs (started_at DESC);
