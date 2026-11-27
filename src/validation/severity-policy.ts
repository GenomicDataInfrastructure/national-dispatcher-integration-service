// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { ValidationFinding } from "../domain/validation-finding.js";

export function applySeverityPolicy(
  validatorConforms: boolean,
  findings: ValidationFinding[],
) {
  // An unexplained failure stays a failure. Only explicit Warning/Info results
  // can override a validator's strict SHACL conformance verdict.
  const conforms = findings.length
    ? findings.every((finding) =>
        ["Warning", "Info"].includes(finding.severity),
      )
    : validatorConforms;
  return { conforms, validatorConforms };
}
