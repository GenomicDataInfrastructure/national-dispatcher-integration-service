// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import type { CatalogueClient } from "../catalogue/catalogue-client.js";
import type { MetadataValidator } from "../validation/metadata-validator.js";
import type { NationalDispatcherClient } from "../dispatcher/national-dispatcher-client.js";
import type { OperationMode } from "../config/config.js";
import { OPERATION_MODES } from "../domain/sync-run.js";
import { CATALOGUE_PERSISTENCE_NAMESPACE } from "../domain/source-system.js";
import { VALIDATION_TYPES, type ValidationType } from "../domain/validation.js";

export const runOptionsSchema = z
  .object({
    operationMode: z.enum(OPERATION_MODES).optional(),
    validator: z
      .enum(["configured", "local-shacl", "release8-local", "ehds-api"])
      .optional(),
    validationVersion: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .max(100)
      .optional(),
    validationType: z.enum(VALIDATION_TYPES).optional(),
    language: z
      .string()
      .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/)
      .max(64)
      .optional(),
  })
  .strict();
export type RunOptions = z.infer<typeof runOptionsSchema>;
export type RunSettings = {
  source: string;
  operationMode: OperationMode;
  language: string;
  validator?: NonNullable<RunOptions["validator"]>;
  validationMode?: "shacl" | "api";
  validationVersion?: string;
  validationType?: ValidationType;
};
export type RunContext = {
  catalogue: CatalogueClient;
  dispatcher: NationalDispatcherClient;
  validator?: MetadataValidator | undefined;
  mode: OperationMode;
  persistenceNamespace: typeof CATALOGUE_PERSISTENCE_NAMESPACE;
  settings?: RunSettings;
};
export class InvalidRunOptionsError extends Error {}
export type ResolveRun = (options: RunOptions) => Promise<RunContext>;
