// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { SyncStateRepository } from "../../src/persistence/postgres/sync-state-repository.js";

describe("SyncStateRepository", () => {
  it("maps database state", async () => {
    const now = new Date();
    const pool: any = {
      query: vi.fn(async () => ({
        rows: [
          {
            dataset_id: "d1",
            checksum: "sum",
            dispatcher_database_id: null,
            central_platform_object_id: "c1",
            correlation_id: null,
            operation: "create",
            status: "delivered",
            retry_count: 0,
            last_error: null,
            last_attempted_at: now,
            last_successful_at: now,
            created_at: now,
            updated_at: now,
          },
        ],
      })),
    };
    const state = await new SyncStateRepository(pool, "dataset_delivery").get(
      "d1",
    );
    expect(state).toMatchObject({
      datasetId: "d1",
      centralPlatformObjectId: "c1",
      status: "delivered",
    });
  });

  it("uses a session lock without rolling back persisted failure state", async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [] })),
      release: vi.fn(),
    };
    const pool: any = { connect: vi.fn(async () => client) };
    const repository = new SyncStateRepository(pool, "dataset_delivery");

    await expect(
      repository.withDatasetLock("d1", async () => {
        throw new Error("dispatcher timeout");
      }),
    ).rejects.toThrow("dispatcher timeout");

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_advisory_lock(hashtextextended($1, 0))",
      ["d1"],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
      ["d1"],
    );
    expect(client.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
  });
});

it("lists deliveries in the requested statuses with uncertain ones first", async () => {
  const pool: any = { query: vi.fn(async () => ({ rows: [] })) };
  await new SyncStateRepository(pool, "dataset_delivery").listByStatuses(
    ["uncertain", "failed"],
    10,
  );
  const [sql, params] = pool.query.mock.calls[0];
  expect(sql).toContain("status = ANY($1::text[])");
  expect(sql).toContain("ORDER BY (status = 'uncertain') DESC");
  expect(params).toEqual([["uncertain", "failed"], 10]);
});
