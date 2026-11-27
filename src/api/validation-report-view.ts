// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { ValidationFinding } from "../domain/validation-finding.js";

/**
 * Give every report a findings list for the dashboard. Reports without
 * findings (for example validator errors) get an empty list; the report text
 * is kept as is.
 */
export function withValidationFindings<
  T extends { report?: string; findings?: ValidationFinding[] },
>(evidence: T): T & { findings: ValidationFinding[] } {
  return { ...evidence, findings: evidence.findings ?? [] };
}
