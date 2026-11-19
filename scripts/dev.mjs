// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import process from "node:process";
import console from "node:console";
import {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
} from "node:timers";
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

const args = process.argv.slice(2);
const command = args.length ? args : ["--import", "tsx", "src/server.ts"];
let child;
let childExited = Promise.resolve();
let closing = false;
let checking = false;

async function snapshot(path) {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return `${path}:${info.mtimeMs}:${info.size}`;
    const entries = await readdir(path, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(
          (entry) => !entry.isSymbolicLink() && entry.name !== "__pycache__",
        )
        .map((entry) => snapshot(join(path, entry.name))),
    );
    return files.sort().join("\n");
  } catch (error) {
    if (error.code === "ENOENT") return `${path}:missing`;
    throw error;
  }
}

async function fingerprint() {
  return (await Promise.all([".env", "src", "validator"].map(snapshot))).join(
    "\n",
  );
}

async function start() {
  let localEnv = {};
  try {
    localEnv = parseEnv(await readFile(".env", "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (closing) return;
  // Rebuild the environment for each start, so sourced shell values cannot hide edits.
  child = spawn(process.execPath, command, {
    stdio: "inherit",
    env: { ...process.env, ...localEnv },
  });
  const running = child;
  childExited = new Promise((resolve) => {
    running.once("error", (error) => {
      console.error("Development process failed:", error.message);
      resolve();
    });
    running.once("exit", () => {
      if (child === running) child = undefined;
      resolve();
    });
  });
}

async function stop() {
  if (!child) return;
  const running = child;
  running.kill("SIGTERM");
  const timeout = setTimeout(() => running.kill("SIGKILL"), 5000);
  try {
    await childExited;
  } finally {
    clearTimeout(timeout);
  }
}

let previous = await fingerprint();
await start();
console.log("Watching .env, src/ and validator/ for changes (polling).");
const timer = setInterval(async () => {
  if (checking || closing) return;
  checking = true;
  try {
    const next = await fingerprint();
    if (next !== previous) {
      previous = next;
      console.log("Configuration or source changed; restarting service.");
      await stop();
      await start();
    }
  } catch (error) {
    console.error("Development reload failed:", error.message);
  } finally {
    checking = false;
  }
}, 750);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    await stop();
  });
}
