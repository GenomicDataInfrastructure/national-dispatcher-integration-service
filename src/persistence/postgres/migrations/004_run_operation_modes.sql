-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

-- Historical delivery runs do not reliably identify whether validation was enabled.
UPDATE sync_runs SET mode = 'legacy_delivery' WHERE mode = 'deliver';
UPDATE sync_runs SET mode = 'validate_only' WHERE mode = 'validate';
ALTER TABLE sync_runs ALTER COLUMN mode SET DEFAULT 'sync_only';
