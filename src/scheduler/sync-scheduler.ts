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
