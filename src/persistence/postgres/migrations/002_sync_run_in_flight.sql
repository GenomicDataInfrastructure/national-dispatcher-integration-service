-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

-- Datasets whose Domibus message is still in flight (e.g. WAITING_FOR_RETRY)
-- when tracking stops are counted here instead of datasets_failed.
ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS datasets_in_flight INTEGER NOT NULL DEFAULT 0;
