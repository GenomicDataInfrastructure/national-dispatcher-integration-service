// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

/** Domibus message statuses reported by National Dispatcher tracking. */
export const DOMIBUS_STATUSES = [
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
] as const;

export type DomibusStatus = (typeof DOMIBUS_STATUSES)[number];

/** Domibus statuses that end tracking for the message without acknowledgement. */
export const TERMINAL_DOMIBUS_STATUSES = [
  "SEND_FAILURE",
  "NOT_FOUND",
  "DELETED",
] as const satisfies readonly DomibusStatus[];

/** Domibus statuses meaning the message is still on its way. */
export const IN_FLIGHT_DOMIBUS_STATUSES = [
  "READY_TO_SEND",
  "SEND_ENQUEUED",
  "SEND_IN_PROGRESS",
  "WAITING_FOR_RECEIPT",
  "SEND_ATTEMPT_FAILED",
  "WAITING_FOR_RETRY",
] as const satisfies readonly DomibusStatus[];

export const DELIVERY_STATUSES = [
  "creating",
  "pending",
  "delivered",
  "updating",
  "deleting",
  "failed",
  "uncertain",
  ...DOMIBUS_STATUSES,
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryOperation = "create" | "update" | "delete";

export const DELIVERY_OPERATIONS = ["create", "update", "delete"] as const;

export const isTerminalDomibusStatus = (
  status: DeliveryStatus | undefined,
): status is (typeof TERMINAL_DOMIBUS_STATUSES)[number] =>
  (TERMINAL_DOMIBUS_STATUSES as readonly string[]).includes(status ?? "");

export const isInFlightDomibusStatus = (
  status: DeliveryStatus | undefined,
): status is (typeof IN_FLIGHT_DOMIBUS_STATUSES)[number] =>
  (IN_FLIGHT_DOMIBUS_STATUSES as readonly string[]).includes(status ?? "");

/** Statuses an operator should look at; the rest progress or are delivered. */
export const ATTENTION_STATUSES = [
  "uncertain",
  "failed",
  ...TERMINAL_DOMIBUS_STATUSES,
] as const satisfies readonly DeliveryStatus[];

/**
 * Statuses where delivery is still moving: a request is being sent, the
 * message is with Domibus, or Domibus acknowledged it and Central Platform
 * verification is pending.
 */
export const IN_PROGRESS_STATUSES = [
  "creating",
  "updating",
  "deleting",
  "pending",
  ...IN_FLIGHT_DOMIBUS_STATUSES,
  "ACKNOWLEDGED",
  "ACKNOWLEDGED_WITH_WARNING",
] as const satisfies readonly DeliveryStatus[];

export type DeliveryStatusGroup = "delivered" | "in_progress" | "attention";

/** Every delivery status belongs to exactly one dashboard group. */
export function deliveryStatusGroup(
  status: DeliveryStatus,
): DeliveryStatusGroup {
  if ((ATTENTION_STATUSES as readonly string[]).includes(status))
    return "attention";
  if ((IN_PROGRESS_STATUSES as readonly string[]).includes(status))
    return "in_progress";
  return "delivered";
}

/** What an operator should do about a delivery in an attention status. */
export function attentionAction(status: DeliveryStatus): string {
  if (status === "uncertain")
    return "The dispatcher may have accepted this request without returning an ID. Check the dispatcher and Central Platform for this dataset, then reconcile its state. It is not retried automatically.";
  if (isTerminalDomibusStatus(status))
    return "Domibus stopped delivering the message. The next sync sends a new message; investigate the Domibus connection if this repeats.";
  return "Retried automatically on the next sync. Check the last error if it keeps failing.";
}
