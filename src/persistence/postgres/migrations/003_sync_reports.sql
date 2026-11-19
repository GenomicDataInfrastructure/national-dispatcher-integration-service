-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE sync_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'deliver';
ALTER TABLE sync_runs ADD COLUMN reports JSONB NOT NULL DEFAULT '[]'::jsonb;
