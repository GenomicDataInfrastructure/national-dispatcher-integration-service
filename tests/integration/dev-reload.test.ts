// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";

it("restarts on .env changes and replaces inherited configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dispatcher-dev-reload-"));
  await writeFile(join(directory, ".env"), "OPERATION_MODE=sync_only\n");
  const process = spawn(
    globalThis.process.execPath,
    [
      resolve("scripts/dev.mjs"),
      "--input-type=module",
      "--eval",
      'console.log("MODE=" + process.env.OPERATION_MODE); setInterval(() => {}, 1000);',
    ],
    {
      cwd: directory,
      env: {
        ...globalThis.process.env,
        OPERATION_MODE: "inherited-stale-value",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = once(process, "exit");
  let output = "";
  process.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  process.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  try {
    await vi.waitFor(() => expect(output).toContain("MODE=sync_only"), {
      timeout: 5000,
    });
    await writeFile(join(directory, ".env"), "OPERATION_MODE=validate_only\n");
    await vi.waitFor(() => expect(output).toContain("MODE=validate_only"), {
      timeout: 5000,
    });
    expect(output).not.toContain("MODE=inherited-stale-value");
  } finally {
    process.kill("SIGTERM");
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
