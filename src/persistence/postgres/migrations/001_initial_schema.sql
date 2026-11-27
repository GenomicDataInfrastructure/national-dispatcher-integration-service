-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS dataset_delivery_sync (
  source_system TEXT NOT NULL,
  source_dataset_id TEXT NOT NULL,
  checksum TEXT,
  dispatcher_database_id TEXT,
  central_platform_object_id TEXT,
  correlation_id TEXT,
  domibus_message_id TEXT,
  operation TEXT CHECK (operation IN ('create', 'update', 'delete')),
  status TEXT NOT NULL CHECK (status IN ('creating', 'pending', 'delivered', 'updating', 'deleting', 'failed', 'uncertain', 'READY_TO_SEND', 'SEND_ENQUEUED', 'SEND_IN_PROGRESS', 'WAITING_FOR_RECEIPT', 'ACKNOWLEDGED', 'ACKNOWLEDGED_WITH_WARNING', 'SEND_ATTEMPT_FAILED', 'WAITING_FOR_RETRY', 'SEND_FAILURE', 'NOT_FOUND', 'DELETED')),
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
  -- Datasets whose Domibus message is still in flight (e.g. WAITING_FOR_RETRY)
  -- when tracking stops are counted here instead of datasets_failed.
  datasets_in_flight INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  mode TEXT NOT NULL DEFAULT 'sync_only',
  reports JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_system TEXT NOT NULL,
  settings JSONB
);

CREATE INDEX IF NOT EXISTS sync_runs_started_idx
  ON sync_runs (started_at DESC);
