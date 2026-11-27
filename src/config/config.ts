// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { OPERATION_MODES } from "../domain/sync-run.js";
import { VALIDATION_TYPES } from "../domain/validation.js";

export const VALIDATOR_DEFAULT_TIMEOUT_MS = 120000;
export const EXTERNAL_VALIDATOR_DEFAULT_TIMEOUT_MS = 30000;
export const VALIDATOR_REPORT_LIMIT_BYTES = 10 * 1024 * 1024;

const booleanValue = z
  .enum(["true", "false", "1", "0"])
  .default("true")
  .transform((value) => value === "true" || value === "1");

const schemaName = z
  .string()
  .regex(/^[a-z_][a-z0-9_]*$/, "must be a PostgreSQL identifier");
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const envSchema = z.object({
  DATASET_CATALOGUE_RDF_URL: optionalUrl,
  CONTROL_API_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
  RELEASE8_VALIDATION_PROFILE: optionalString,
  OPERATION_MODE: z.enum(OPERATION_MODES).default("sync_only"),
  VALIDATION_MODE: z.enum(["shacl", "itb"]).default("shacl"),
  VALIDATION_VERSION: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .optional(),
  ),
  METADATA_VALIDATOR_URL: optionalUrl,
  METADATA_VALIDATOR_SHAPES_FILE: optionalString,
  METADATA_VALIDATOR_PYTHON: optionalString,
  METADATA_VALIDATOR_VALIDATION_TYPE: z.enum(VALIDATION_TYPES).default("auto"),
  METADATA_VALIDATOR_PROFILE: optionalString,
  METADATA_VALIDATOR_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(VALIDATOR_DEFAULT_TIMEOUT_MS),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default("0.0.0.0"),
  DISPATCHER_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, "")),
  DISPATCHER_API_KEY: z.string().min(1),
  DISPATCHER_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  DISPATCHER_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30000),
  DISPATCHER_VERIFICATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(120000),
  DISPATCHER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  POSTGRES_URL: z.string().min(1),
  POSTGRES_SCHEMA: schemaName.default("dataset_delivery"),
  SYNC_ENABLED: booleanValue,
  SYNC_SCHEDULE: z.string().min(1).default("*/15 * * * *"),
});

export type CatalogueConfig = {
  url: string;
  acceptLanguage: string;
  requestTimeoutMs: number;
};

export type OperationMode = (typeof OPERATION_MODES)[number];

export type AppConfig = {
  operationMode?: OperationMode;
  controlApiToken?: string;
  metadataValidatorUrl?: string;
  metadataValidatorOptions?: import("../validation/metadata-validator.js").ValidatorOptions;
  release8ValidationProfile?: string;
  port: number;
  host: string;
  dispatcher: {
    baseUrl: string;
    apiKey: string;
    validationEnabled: boolean;
    connectionTimeoutMs: number;
    requestTimeoutMs: number;
    verificationTimeoutMs: number;
    pollIntervalMs: number;
  };
  postgresUrl: string;
  postgresSchema: string;
  catalogue?: CatalogueConfig;
  sync: { enabled: boolean; schedule: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const catalogue: CatalogueConfig | undefined =
    parsed.DATASET_CATALOGUE_RDF_URL
      ? {
          url: parsed.DATASET_CATALOGUE_RDF_URL,
          acceptLanguage: "en-GB",
          requestTimeoutMs: EXTERNAL_VALIDATOR_DEFAULT_TIMEOUT_MS,
        }
      : undefined;
  return {
    ...(parsed.RELEASE8_VALIDATION_PROFILE
      ? { release8ValidationProfile: parsed.RELEASE8_VALIDATION_PROFILE }
      : {}),
    ...(parsed.CONTROL_API_TOKEN
      ? { controlApiToken: parsed.CONTROL_API_TOKEN }
      : {}),
    metadataValidatorOptions: {
      mode: parsed.VALIDATION_MODE,
      ...(parsed.VALIDATION_VERSION
        ? { version: parsed.VALIDATION_VERSION }
        : {}),
      ...(parsed.METADATA_VALIDATOR_SHAPES_FILE
        ? { shapesFile: parsed.METADATA_VALIDATOR_SHAPES_FILE }
        : {}),
      ...(parsed.METADATA_VALIDATOR_PYTHON
        ? { pythonPath: parsed.METADATA_VALIDATOR_PYTHON }
        : {}),
      validationType: parsed.METADATA_VALIDATOR_VALIDATION_TYPE,
      ...(parsed.METADATA_VALIDATOR_PROFILE
        ? { profile: parsed.METADATA_VALIDATOR_PROFILE }
        : {}),
      timeoutMs: parsed.METADATA_VALIDATOR_TIMEOUT_MS,
    },
    ...(parsed.METADATA_VALIDATOR_URL
      ? { metadataValidatorUrl: parsed.METADATA_VALIDATOR_URL }
      : {}),
    operationMode: parsed.OPERATION_MODE,
    port: parsed.PORT,
    host: parsed.HOST,
    dispatcher: {
      baseUrl: parsed.DISPATCHER_URL,
      apiKey: parsed.DISPATCHER_API_KEY,
      validationEnabled: parsed.OPERATION_MODE !== "sync_only",
      connectionTimeoutMs: parsed.DISPATCHER_CONNECTION_TIMEOUT_MS,
      requestTimeoutMs: parsed.DISPATCHER_REQUEST_TIMEOUT_MS,
      verificationTimeoutMs: parsed.DISPATCHER_VERIFICATION_TIMEOUT_MS,
      pollIntervalMs: parsed.DISPATCHER_POLL_INTERVAL_MS,
    },
    postgresUrl: parsed.POSTGRES_URL,
    postgresSchema: parsed.POSTGRES_SCHEMA,
    ...(catalogue ? { catalogue } : {}),
    sync: { enabled: parsed.SYNC_ENABLED, schedule: parsed.SYNC_SCHEDULE },
  };
}
