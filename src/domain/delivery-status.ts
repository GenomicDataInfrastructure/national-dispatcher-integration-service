// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

export type DeliveryStatus =
  | "creating"
  | "pending"
  | "delivered"
  | "updating"
  | "deleting"
  | "failed"
  | "uncertain";

export type DeliveryOperation = "create" | "update" | "delete";

export const DELIVERY_STATUSES = [
  "creating",
  "pending",
  "delivered",
  "updating",
  "deleting",
  "failed",
  "uncertain",
] as const satisfies readonly DeliveryStatus[];

export const DELIVERY_OPERATIONS = ["create", "update", "delete"] as const;
