// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { ValidationFinding } from "./validation-finding.js";

export type ValidationEvidence = {
  datasetId: string;
  sourceSystem?: string;
  checksum?: string;
  conforms?: boolean;
  validatorConforms?: boolean;
  profile?: string;
  validationType?: string;
  validatorUrl?: string;
  validationMode?: "shacl" | "api";
  version?: string;
  report?: string;
  findings?: ValidationFinding[];
  error?: string;
  checkedAt: Date;
  runId: string;
};

export function complianceState(
  checksum: string | null,
  evidence: ValidationEvidence | undefined,
  trustedProfile: string | undefined,
) {
  const result = (
    status:
      "not_assessed" | "passed" | "failed" | "outdated" | "validation_error",
    reason: string,
  ) => ({ status, reason, evidence: evidence ?? null });
  if (!trustedProfile)
    return result(
      "not_assessed",
      "No Release 8 validation profile has been configured.",
    );
  if (!evidence)
    return result(
      "not_assessed",
      "No validation result is recorded for this dataset.",
    );
  if (!checksum || !evidence.checksum || checksum !== evidence.checksum)
    return result(
      "outdated",
      "No assessment matches the metadata checksum in this delivery record.",
    );
  if (evidence.error)
    return result(
      "validation_error",
      "Validation could not complete; this is not a conformance result.",
    );
  if (
    evidence.profile !== trustedProfile ||
    typeof evidence.conforms !== "boolean"
  )
    return result(
      "not_assessed",
      "The latest check did not use the configured Release 8 profile.",
    );
  return evidence.conforms
    ? result(
        "passed",
        "Passed the configured Release 8 SHACL rules for this metadata checksum.",
      )
    : result(
        "failed",
        "Failed the configured Release 8 SHACL rules for this metadata checksum.",
      );
}
