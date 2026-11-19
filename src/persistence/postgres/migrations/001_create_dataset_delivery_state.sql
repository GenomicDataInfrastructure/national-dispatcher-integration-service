-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

CREATE TABLE IF NOT EXISTS dataset_delivery_state (
  dataset_id TEXT PRIMARY KEY,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dataset_delivery_state_status_idx
  ON dataset_delivery_state (status);
