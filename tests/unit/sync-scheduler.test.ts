// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import {
  cronMatches,
  SyncScheduler,
} from "../../src/scheduler/sync-scheduler.js";

describe("SyncScheduler", () => {
  it("triggers one catalogue sync per minute", () => {
    expect(cronMatches("*/15 * * * *", new Date("2026-01-01T10:30:00Z"))).toBe(
      true,
    );
    const orchestrator = { trigger: vi.fn(async () => ({})) } as any;
    const scheduler = new SyncScheduler(orchestrator, "* * * * *");
    const now = new Date("2026-01-01T10:30:00Z");
    scheduler.tick(now);
    scheduler.tick(now);
    expect(orchestrator.trigger).toHaveBeenCalledOnce();
  });
});
