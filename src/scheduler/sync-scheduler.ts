// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { SyncOrchestrator } from "../application/sync-orchestrator.js";

function fieldMatches(field: string, value: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isInteger(step) && step > 0 && value % step === 0;
    }
    return Number(part) === value;
  });
}

export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error("SYNC_SCHEDULE must be a five-field cron expression");
  const values = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];
  return fields.every((field, index) => fieldMatches(field, values[index]!));
}

const SEARCH_LIMIT_MINUTES = 8 * 24 * 60;

/**
 * Next minutes after `from` that match the schedule, searching up to eight
 * days ahead. Returns fewer entries when the schedule fires less often.
 */
export function nextCronMatches(
  expression: string,
  from: Date,
  count = 1,
): Date[] {
  const matches: Date[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  for (let i = 0; i < SEARCH_LIMIT_MINUTES && matches.length < count; i++) {
    cursor.setMinutes(cursor.getMinutes() + 1);
    if (cronMatches(expression, cursor)) matches.push(new Date(cursor));
  }
  return matches;
}

export class SyncScheduler {
  private timer?: NodeJS.Timeout;
  private lastMinute = "";

  constructor(
    private readonly orchestrator: SyncOrchestrator,
    private readonly schedule: string,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    cronMatches(schedule, new Date());
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  tick(now = new Date()): void {
    const minute = now.toISOString().slice(0, 16);
    if (minute === this.lastMinute || !cronMatches(this.schedule, now)) return;
    this.lastMinute = minute;
    void this.orchestrator.trigger().catch(this.onError);
  }
}
