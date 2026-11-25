// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { DeliveryOperation, DeliveryStatus } from "./delivery-status.js";

export type SyncState = {
  sourceSystem: string;
  datasetId: string;
  checksum: string | null;
  dispatcherDatabaseId: string | null;
  centralPlatformObjectId: string | null;
  correlationId: string | null;
  domibusMessageId: string | null;
  operation: DeliveryOperation | null;
  status: DeliveryStatus;
  retryCount: number;
  lastError: string | null;
  lastAttemptedAt: Date | null;
  lastSuccessfulAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
