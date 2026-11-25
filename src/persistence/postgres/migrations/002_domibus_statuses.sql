-- SPDX-FileCopyrightText: 2026 PNED G.I.E.
-- SPDX-License-Identifier: Apache-2.0

ALTER TABLE dataset_delivery_sync
  DROP CONSTRAINT IF EXISTS dataset_delivery_sync_status_check;

ALTER TABLE dataset_delivery_sync
  ADD CONSTRAINT dataset_delivery_sync_status_check
  CHECK (status IN (
    'creating', 'pending', 'delivered', 'updating', 'deleting', 'failed', 'uncertain',
    'READY_TO_SEND', 'SEND_ENQUEUED', 'SEND_IN_PROGRESS', 'WAITING_FOR_RECEIPT',
    'ACKNOWLEDGED', 'ACKNOWLEDGED_WITH_WARNING', 'SEND_ATTEMPT_FAILED',
    'WAITING_FOR_RETRY', 'SEND_FAILURE', 'NOT_FOUND', 'DELETED'
  ));
