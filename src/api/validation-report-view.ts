// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import type { ValidationFinding } from "../domain/validation-finding.js";
import { parseItbReport } from "../validation/metadata-validator.js";

// Older saved reports contain JSON-LD in their text. Read those locally so the
// HTML view works without another external validation request or data migration.
export async function withValidationFindings<
  T extends { report?: string; findings?: ValidationFinding[] },
>(evidence: T): Promise<T & { findings: ValidationFinding[] }> {
  if (Array.isArray(evidence.findings))
    return { ...evidence, findings: evidence.findings };
  const marker = "Full SHACL report (JSON-LD):";
  const position = evidence.report?.indexOf(marker) ?? -1;
  if (position >= 0) {
    try {
      const document: unknown = JSON.parse(
        evidence.report!.slice(position + marker.length).trim(),
      );
      const parsed = await parseItbReport(document);
      return { ...evidence, findings: parsed.findings };
    } catch {
      // Preserve legacy/unrecognised reports as text; do not invent findings.
    }
  }
  return { ...evidence, findings: [] };
}
