// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { withValidationFindings } from "../../src/api/validation-report-view.js";

describe("HTML validation report data", () => {
  it("uses structured findings without rewriting them", () => {
    const findings = [
      {
        severity: "Warning",
        message: "Missing recommended value",
        path: "path",
        focusNode: "node",
        value: "",
        constraint: "constraint",
      },
    ];
    expect(withValidationFindings({ findings }).findings).toBe(findings);
  });
  it("gives reports without findings an empty list and keeps their text", () => {
    expect(withValidationFindings({ report: "Validator offline" })).toEqual({
      report: "Validator offline",
      findings: [],
    });
  });
});
