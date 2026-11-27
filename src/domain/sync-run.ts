// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { OperationMode } from "../config/config.js";
import type { ValidationFinding } from "./validation-finding.js";

export type SyncRunStatus = "queued" | "running" | "completed" | "failed";

export const OPERATION_MODES = [
  "validate_only",
  "validate_and_sync",
  "sync_only",
] as const;
export type SyncRun = {
  sourceSystem?: string;
  settings?: import("../application/run-options.js").RunSettings;
  mode: OperationMode;
  reports: Array<{
    datasetId: string;
    sourceSystem?: string;
    checksum?: string;
    conforms?: boolean;
    validatorConforms?: boolean;
    profile?: string;
    validationType?: string;
    validatorUrl?: string;
    validationMode?: "shacl" | "api";
    version?: string;
    report?: string;
    findings?: ValidationFinding[];
    error?: string;
    /** Domibus status the delivery was left in when it is still in flight. */
    deliveryStatus?: string;
    note?: string;
  }>;
  runId: string;
  status: SyncRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  datasetsSeen: number;
  datasetsCreated: number;
  datasetsUpdated: number;
  datasetsSkipped: number;
  datasetsDeleted: number;
  datasetsFailed: number;
  /** Datasets still awaiting Domibus delivery; tracking resumes next run. */
  datasetsInFlight: number;
  error: string | null;
};
