// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { access } from "node:fs/promises";
import type { AppConfig } from "../config/config.js";
import { CatalogueClient } from "../catalogue/catalogue-client.js";
import {
  MetadataValidator,
  type ValidatorOptions,
} from "../validation/metadata-validator.js";
import { NationalDispatcherClient } from "../dispatcher/national-dispatcher-client.js";
import {
  InvalidRunOptionsError,
  type ResolveRun,
  type RunSettings,
} from "./run-options.js";
import {
  CATALOGUE_SOURCE,
  CATALOGUE_PERSISTENCE_NAMESPACE,
} from "../domain/source-system.js";

export function createRunResolver(
  config: AppConfig,
  fetchImpl: typeof fetch,
): ResolveRun {
  return async (request) => {
    const source = CATALOGUE_SOURCE;
    const persistenceNamespace = CATALOGUE_PERSISTENCE_NAMESPACE;
    const catalogueConfig = config.catalogue;
    if (!catalogueConfig)
      throw new InvalidRunOptionsError(
        "DATASET_CATALOGUE_RDF_URL is not configured",
      );
    const mode = request.operationMode ?? config.operationMode ?? "sync_only";
    const language = request.language ?? catalogueConfig.acceptLanguage;
    const settings: RunSettings = { source, operationMode: mode, language };
    let validator: MetadataValidator | undefined;
    if (mode === "sync_only") {
      if (
        request.validator ||
        request.validationVersion ||
        request.validationType
      )
        throw new InvalidRunOptionsError(
          "Validation options require a validation operation mode",
        );
    } else {
      const selection = request.validator ?? "configured";
      const options: ValidatorOptions = { ...config.metadataValidatorOptions };
      const url = config.metadataValidatorUrl ?? "";
      if (selection !== "configured") {
        // Alternate backends must not inherit the configured backend's identity/version.
        delete options.profile;
        delete options.version;
        if (selection === "ehds-api") {
          options.mode = "itb";
        } else {
          options.mode = "shacl";
          if (selection === "release8-local") {
            options.version = "release-8";
            options.shapesFile = "validator/{version}/{accessLevel}.trig";
            if (
              request.validationVersion &&
              request.validationVersion !== "release-8"
            )
              throw new InvalidRunOptionsError(
                "release8-local supports only release-8",
              );
          }
        }
      }
      if (request.validationVersion) {
        if (request.validationVersion !== options.version)
          delete options.profile;
        options.version = request.validationVersion;
      }
      if (request.validationType)
        options.validationType = request.validationType;
      const validationMode = options.mode === "shacl" ? "shacl" : "api";
      const resource = validationMode === "shacl" ? options.shapesFile : url;
      if (!resource)
        throw new InvalidRunOptionsError(
          `Validator '${selection}' is not configured`,
        );
      if (options.version && !resource.includes("{version}"))
        throw new InvalidRunOptionsError(
          "The configured validator resource must contain {version} to select a version",
        );
      if (!options.version && resource.includes("{version}"))
        throw new InvalidRunOptionsError(
          "validationVersion is required for this validator",
        );
      if (validationMode === "shacl") {
        const levels = resource.includes("{accessLevel}")
          ? options.validationType && options.validationType !== "auto"
            ? [options.validationType]
            : ["public", "non-public", "restricted"]
          : [""];
        for (const level of levels) {
          try {
            await access(
              resource
                .replaceAll("{version}", options.version ?? "")
                .replaceAll("{accessLevel}", level),
            );
          } catch {
            throw new InvalidRunOptionsError(
              `Local rules for '${selection}' are unavailable; install/build the selected bundle first`,
            );
          }
        }
      }
      validator = new MetadataValidator(url, fetchImpl, options);
      Object.assign(settings, {
        validator: selection,
        validationMode,
        ...(options.version ? { validationVersion: options.version } : {}),
        validationType: options.validationType ?? "auto",
      });
    }
    return {
      source,
      persistenceNamespace,
      mode,
      settings,
      validator,
      catalogue: new CatalogueClient(
        { ...catalogueConfig, acceptLanguage: language },
        fetchImpl,
      ),
      dispatcher: new NationalDispatcherClient(
        { ...config.dispatcher, validationEnabled: mode !== "sync_only" },
        fetchImpl,
      ),
    };
  };
}
