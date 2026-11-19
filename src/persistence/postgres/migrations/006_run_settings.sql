-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

-- Resolved per-run choices; credentials and server resource paths are not stored.
ALTER TABLE sync_runs ADD COLUMN settings JSONB;
