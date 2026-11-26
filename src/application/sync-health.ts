// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import {
  deliveryStatusGroup,
  isInFlightDomibusStatus,
  type DeliveryStatus,
} from "../domain/delivery-status.js";
import type { SyncRun } from "../domain/sync-run.js";
import { nextCronMatches } from "../scheduler/sync-scheduler.js";

export type DeliverySummary = {
  total: number;
  delivered: number;
  inProgress: number;
  /** Part of inProgress: the message is with Domibus or awaiting its first status. */
  awaitingDomibus: number;
  attention: number;
};

/** Group raw status counts so the groups always add up to the total. */
export function summarizeDeliveries(
  counts: Record<string, number>,
): DeliverySummary {
  const summary: DeliverySummary = {
    total: 0,
    delivered: 0,
    inProgress: 0,
    awaitingDomibus: 0,
    attention: 0,
  };
  for (const [status, count] of Object.entries(counts)) {
    summary.total += count;
    const group = deliveryStatusGroup(status as DeliveryStatus);
    if (group === "attention") summary.attention += count;
    else if (group === "in_progress") {
      summary.inProgress += count;
      if (
        status === "pending" ||
        isInFlightDomibusStatus(status as DeliveryStatus)
      )
        summary.awaitingDomibus += count;
    } else summary.delivered += count;
  }
  return summary;
}

export type RunBrief = Pick<
  SyncRun,
  | "runId"
  | "status"
  | "mode"
  | "startedAt"
  | "completedAt"
  | "datasetsFailed"
  | "datasetsInFlight"
  | "error"
>;

export type SyncHealth = {
  scheduling: {
    enabled: boolean;
    schedule: string | null;
    nextRunAt: Date | null;
    /** Gap between the next two scheduled runs, used to judge staleness. */
    intervalMinutes: number | null;
  };
  activeRun: RunBrief | null;
  lastCompletedRun: RunBrief | null;
  latestRun: RunBrief | null;
  /** Scheduling is on and no run has completed for over two intervals. */
  overdue: boolean;
};

const brief = (run: SyncRun | null): RunBrief | null =>
  run
    ? {
        runId: run.runId,
        status: run.status,
        mode: run.mode,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        datasetsFailed: run.datasetsFailed,
        datasetsInFlight: run.datasetsInFlight,
        error: run.error,
      }
    : null;

export function syncHealth(
  sync: { enabled: boolean; schedule: string } | undefined,
  runs: {
    active: SyncRun | null;
    lastCompleted: SyncRun | null;
    latest: SyncRun | null;
  },
  now: Date,
): SyncHealth {
  const enabled = Boolean(sync?.enabled);
  const [next, following] =
    enabled && sync ? nextCronMatches(sync.schedule, now, 2) : [];
  const intervalMinutes =
    next && following
      ? Math.round((following.getTime() - next.getTime()) / 60000)
      : null;
  const completedAt = runs.lastCompleted?.completedAt;
  const overdue = Boolean(
    enabled &&
    intervalMinutes &&
    completedAt &&
    now.getTime() - new Date(completedAt).getTime() >
      2 * intervalMinutes * 60000,
  );
  return {
    scheduling: {
      enabled,
      schedule: enabled && sync ? sync.schedule : null,
      nextRunAt: next ?? null,
      intervalMinutes,
    },
    activeRun: brief(runs.active),
    lastCompletedRun: brief(runs.lastCompleted),
    latestRun: brief(runs.latest),
    overdue,
  };
}
