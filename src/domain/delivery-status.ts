// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

export type DeliveryStatus =
  | "creating"
  | "pending"
  | "delivered"
  | "updating"
  | "deleting"
  | "failed"
  | "uncertain"
  | "READY_TO_SEND"
  | "SEND_ENQUEUED"
  | "SEND_IN_PROGRESS"
  | "WAITING_FOR_RECEIPT"
  | "ACKNOWLEDGED"
  | "ACKNOWLEDGED_WITH_WARNING"
  | "SEND_ATTEMPT_FAILED"
  | "WAITING_FOR_RETRY"
  | "SEND_FAILURE"
  | "NOT_FOUND"
  | "DELETED";

export type DomibusStatus =
  | "READY_TO_SEND"
  | "SEND_ENQUEUED"
  | "SEND_IN_PROGRESS"
  | "WAITING_FOR_RECEIPT"
  | "ACKNOWLEDGED"
  | "ACKNOWLEDGED_WITH_WARNING"
  | "SEND_ATTEMPT_FAILED"
  | "WAITING_FOR_RETRY"
  | "SEND_FAILURE"
  | "NOT_FOUND"
  | "DELETED";

export type DeliveryOperation = "create" | "update" | "delete";

export const DELIVERY_STATUSES = [
  "creating",
  "pending",
  "delivered",
  "updating",
  "deleting",
  "failed",
  "uncertain",
  "READY_TO_SEND",
  "SEND_ENQUEUED",
  "SEND_IN_PROGRESS",
  "WAITING_FOR_RECEIPT",
  "ACKNOWLEDGED",
  "ACKNOWLEDGED_WITH_WARNING",
  "SEND_ATTEMPT_FAILED",
  "WAITING_FOR_RETRY",
  "SEND_FAILURE",
  "NOT_FOUND",
  "DELETED",
] as const satisfies readonly DeliveryStatus[];

export const DELIVERY_OPERATIONS = ["create", "update", "delete"] as const;
