// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { Script } from "node:vm";
import { buildApp } from "../../src/app.js";
import { dashboardJs } from "../../src/api/dashboard-page.js";

const token = "operator-test-token-at-least-32-characters";
const config: any = {
  controlApiToken: token,
  dispatcher: {
    baseUrl: "https://dispatcher.example",
    apiKey: "private-dispatcher-key",
  },
  catalogue: { url: "https://catalogue.example/catalog.rdf" },
  sync: { enabled: false },
};
function setup() {
  const states: any = {
    listRecent: vi.fn(async () => [
      {
        datasetId: "<script>bad</script>",
        sourceSystem: "userportal",
        status: "delivered",
      },
    ]),
    statusCounts: vi.fn(async () => ({ delivered: 1 })),
    get: vi.fn(async () => null),
    withDatasetLock: vi.fn(),
  };
  const runs: any = {
    latestValidationReports: vi.fn(async () => []),
    listRecent: vi.fn(async () => [
      {
        runId: "run-1",
        status: "completed",
        datasetsFailed: 1,
        reports: [{ datasetId: "broken", error: "Rejected" }],
      },
    ]),
    create: vi.fn(),
  };
  const fetchImpl = vi.fn();
  return { states, runs, fetchImpl };
}

describe("Read-only monitoring", () => {
  it("serves a self-contained dashboard with scripts restricted to the same origin", async () => {
    const { states, runs, fetchImpl } = setup();
    const app = await buildApp(config, states, fetchImpl as any, runs);
    try {
      const response = await app.inject("/");
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toContain(
        "script-src 'self'",
      );
      expect(response.body).toContain("Read-only access");
      expect(response.body).not.toContain(token);
      expect(response.body).not.toContain("private-dispatcher-key");
      expect(
        (await app.inject("/dashboard.js")).headers["content-type"],
      ).toContain("application/javascript");
      expect((await app.inject("/dashboard.css")).statusCode).toBe(200);
      expect(() => new Script(dashboardJs)).not.toThrow();
      expect(dashboardJs).not.toMatch(/innerHTML|localStorage|method\s*:/);
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("reads paginated states across namespaces and history without side effects", async () => {
    const { states, runs, fetchImpl } = setup();
    states.listRecent.mockResolvedValue(
      Array.from({ length: 26 }, (_, i) => ({
        datasetId: String(i),
        sourceSystem: "userportal",
      })),
    );
    runs.listRecent.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({ runId: String(i) })),
    );
    const app = await buildApp(config, states, fetchImpl as any, runs);
    try {
      const response = await app.inject(
        "/api/v1/monitoring?stateOffset=25&runOffset=10&source=catalogue&status=failed",
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json();
      expect(body.deliveries).toHaveLength(25);
      expect(body.runs).toHaveLength(10);
      expect(body.hasMoreDeliveries).toBe(true);
      expect(body.hasMoreRuns).toBe(true);
      expect(body.counts).toEqual({ delivered: 1 });
      expect(states.listRecent).toHaveBeenCalledWith(
        26,
        25,
        "userportal",
        "failed",
      );
      expect(runs.listRecent).toHaveBeenCalledWith(11, 10);
      expect(states.withDatasetLock).not.toHaveBeenCalled();
      expect(runs.create).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(
        (await app.inject("/api/v1/monitoring?stateOffset=-1")).statusCode,
      ).toBe(400);
      expect(
        (await app.inject("/api/v1/monitoring?status=invalid")).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });

  it.each([
    ["POST", "/api/v1/sync"],
    ["POST", "/api/v1/sync/dataset/dataset-1?mode=validate"],
    ["POST", "/api/v1/dataset-deliveries"],
    ["PUT", "/api/v1/dataset-deliveries/dataset-1"],
    ["DELETE", "/api/v1/dataset-deliveries/dataset-1"],
  ])(
    "rejects unauthenticated %s %s before any side effects",
    async (method, url) => {
      const { states, runs, fetchImpl } = setup();
      const app = await buildApp(config, states, fetchImpl as any, runs);
      try {
        for (const headers of [{}, { authorization: "Bearer wrong" }]) {
          const response = await app.inject({
            method: method as any,
            url,
            headers,
          });
          expect(response.statusCode).toBe(401);
        }
        expect(states.withDatasetLock).not.toHaveBeenCalled();
        expect(runs.create).not.toHaveBeenCalled();
        expect(fetchImpl).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it("allows authorized operator requests and disables controls when no token is configured", async () => {
    const { states, fetchImpl } = setup();
    const app = await buildApp(config, states, fetchImpl as any);
    const disabled = await buildApp(
      { ...config, controlApiToken: undefined },
      states,
      fetchImpl as any,
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/dataset-deliveries",
        headers: {
          authorization: "Bearer " + token,
          "content-type": "application/rdf+xml",
        },
        payload: "",
      });
      expect(response.statusCode).toBe(400); // Passed auth; rejected by body validation.
      expect(
        (
          await disabled.inject({
            method: "POST",
            url: "/api/v1/dataset-deliveries",
          })
        ).statusCode,
      ).toBe(503);
      expect((await disabled.inject("/api/v1/monitoring")).statusCode).toBe(
        200,
      );
    } finally {
      await app.close();
      await disabled.close();
    }
  });
});

it("separates catalogue compliance evidence from direct API records", async () => {
  const { states, runs, fetchImpl } = setup();
  const profile = "release-8:trusted-rules";
  states.listRecent.mockResolvedValue([
    {
      datasetId: "same-id",
      sourceSystem: "userportal",
      status: "delivered",
      checksum: "snapshot",
    },
    {
      datasetId: "same-id",
      sourceSystem: "adapter",
      status: "delivered",
      checksum: "snapshot",
    },
  ]);
  runs.latestValidationReports.mockResolvedValue([
    {
      datasetId: "same-id",
      checksum: "snapshot",
      profile,
      conforms: false,
      report: "Missing mandatory fields",
      runId: "validation-run",
      checkedAt: new Date(),
    },
  ]);
  const app = await buildApp(
    {
      ...config,
      release8ValidationProfile: profile,
      operationMode: "sync_only",
    },
    states,
    fetchImpl as any,
    runs,
  );
  try {
    const response = await app.inject("/api/v1/monitoring");
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.operationMode).toBe("sync_only");
    expect(body.deliveries[0]).toMatchObject({
      status: "delivered",
      compliance: { status: "failed" },
    });
    expect(body.deliveries[1]).toMatchObject({
      status: "delivered",
      compliance: { status: "not_assessed" },
    });
    expect(runs.latestValidationReports).toHaveBeenCalledWith(
      ["same-id"],
      "userportal",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it("does not mix catalogue evidence with retained legacy source records", async () => {
  const { states, runs, fetchImpl } = setup();
  states.listRecent.mockResolvedValue(
    ["userportal", "healthdata"].map((sourceSystem) => ({
      datasetId: "shared",
      sourceSystem,
      status: "delivered",
      checksum: "sum",
    })),
  );
  runs.latestValidationReports.mockImplementation(
    async (_ids: string[], source: string) => [
      {
        datasetId: "shared",
        checksum: "sum",
        profile: "trusted",
        conforms: source === "healthdata",
        checkedAt: new Date(),
        runId: "test",
      },
    ],
  );
  const app = await buildApp(
    { ...config, release8ValidationProfile: "trusted" },
    states,
    fetchImpl as any,
    runs,
  );
  try {
    const body = (await app.inject("/api/v1/monitoring")).json();
    expect(body.deliveries.map((d: any) => d.compliance.status)).toEqual([
      "failed",
      "passed",
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
