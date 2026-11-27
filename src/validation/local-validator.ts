// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { applySeverityPolicy } from "./severity-policy.js";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  ValidationResult,
  ValidatorOptions,
} from "./metadata-validator.js";
import {
  VALIDATOR_DEFAULT_TIMEOUT_MS,
  VALIDATOR_REPORT_LIMIT_BYTES,
} from "../config/config.js";

export async function validateLocally(
  datasetId: string,
  rdf: string,
  options: ValidatorOptions,
): Promise<ValidationResult> {
  if (!options.shapesFile)
    throw new Error(
      "METADATA_VALIDATOR_SHAPES_FILE is required for local validation",
    );
  const shapes = resolve(options.shapesFile);
  const digest = createHash("sha256")
    .update(await readFile(shapes))
    .digest("hex");
  const profile = options.profile ?? `local-shacl:sha256:${digest}`;
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      options.pythonPath ?? "python3",
      [resolve("validator/validate.py"), shapes],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let size = 0;
    let failure: Error | undefined;
    const abort = (message: string) => {
      failure ??= new Error(message);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => abort("Local metadata validation timed out"),
      options.timeoutMs ?? VALIDATOR_DEFAULT_TIMEOUT_MS,
    );
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > VALIDATOR_REPORT_LIMIT_BYTES)
        abort("Local validation report exceeds 10 MiB");
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    child.stdin.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(
          new Error(
            `Local metadata validation failed: ${stderr.trim() || `exit ${code}`}`,
          ),
        );
      try {
        const result = JSON.parse(stdout);
        if (
          typeof result.conforms !== "boolean" ||
          typeof result.report !== "string" ||
          !Array.isArray(result.findings)
        )
          throw new Error("Local validator returned an invalid report");
        resolveResult({
          datasetId,
          profile,
          ...result,
          ...applySeverityPolicy(result.conforms, result.findings),
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(rdf);
  });
}
