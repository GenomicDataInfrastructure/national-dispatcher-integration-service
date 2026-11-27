// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  summarizeDeliveries,
  syncHealth,
} from "../../src/application/sync-health.js";
import {
  DELIVERY_STATUSES,
  attentionAction,
  deliveryStatusGroup,
} from "../../src/domain/delivery-status.js";
import { nextCronMatches } from "../../src/scheduler/sync-scheduler.js";

const run = (overrides: Record<string, unknown>): any => ({
  runId: "run",
  status: "completed",
  mode: "sync_only",
  startedAt: new Date("2026-01-01T10:00:00"),
  completedAt: new Date("2026-01-01T10:01:00"),
  datasetsFailed: 0,
  datasetsInFlight: 0,
  error: null,
  reports: [],
  ...overrides,
});

describe("delivery status groups", () => {
  it("places every status in a group so the summary adds up to the total", () => {
    const counts = Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, 1]));
    const summary = summarizeDeliveries(counts);
    expect(summary.total).toBe(DELIVERY_STATUSES.length);
    expect(summary.delivered + summary.inProgress + summary.attention).toBe(
      summary.total,
    );
    expect(summary.delivered).toBe(1);
    expect(summary.attention).toBe(5);
    // pending plus the six in-flight Domibus statuses.
    expect(summary.awaitingDomibus).toBe(7);
  });

  it("treats acknowledged messages as in progress and final Domibus failures as attention", () => {
    expect(deliveryStatusGroup("ACKNOWLEDGED")).toBe("in_progress");
    expect(deliveryStatusGroup("WAITING_FOR_RETRY")).toBe("in_progress");
    expect(deliveryStatusGroup("SEND_FAILURE")).toBe("attention");
    expect(deliveryStatusGroup("delivered")).toBe("delivered");
  });

  it("gives uncertain deliveries a manual reconciliation hint", () => {
    expect(attentionAction("uncertain")).toContain("not retried automatically");
    expect(attentionAction("failed")).toContain("Retried automatically");
    expect(attentionAction("NOT_FOUND")).toContain("sends a new message");
  });
});

describe("sync health", () => {
  const now = new Date("2026-01-01T10:07:30");
  const none = { active: null, lastCompleted: null, latest: null };

  it("finds the next scheduled runs", () => {
    expect(nextCronMatches("*/15 * * * *", now, 2)).toEqual([
      new Date("2026-01-01T10:15:00"),
      new Date("2026-01-01T10:30:00"),
    ]);
    expect(nextCronMatches("0 0 1 1 *", now)).toEqual([]);
  });

  it("reports the schedule and interval when scheduling is enabled", () => {
    const health = syncHealth(
      { enabled: true, schedule: "*/15 * * * *" },
      none,
      now,
    );
    expect(health.scheduling).toEqual({
      enabled: true,
      schedule: "*/15 * * * *",
      nextRunAt: new Date("2026-01-01T10:15:00"),
      intervalMinutes: 15,
    });
    expect(health.overdue).toBe(false);
  });

  it("is overdue only when no run completed for over two intervals", () => {
    const sync = { enabled: true, schedule: "*/15 * * * *" };
    const recent = run({ completedAt: new Date("2026-01-01T09:40:00") });
    const old = run({ completedAt: new Date("2026-01-01T09:35:00") });
    expect(
      syncHealth(sync, { ...none, lastCompleted: recent }, now).overdue,
    ).toBe(false);
    expect(syncHealth(sync, { ...none, lastCompleted: old }, now).overdue).toBe(
      true,
    );
    expect(
      syncHealth(
        { ...sync, enabled: false },
        { ...none, lastCompleted: old },
        now,
      ).overdue,
    ).toBe(false);
  });

  it("drops reports from run summaries", () => {
    const health = syncHealth(undefined, { ...none, active: run({}) }, now);
    expect(health.activeRun).not.toHaveProperty("reports");
    expect(health.scheduling.enabled).toBe(false);
  });
});
