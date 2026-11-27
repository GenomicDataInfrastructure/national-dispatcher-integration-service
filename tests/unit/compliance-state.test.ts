// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  complianceState,
  type ValidationEvidence,
} from "../../src/domain/compliance-state.js";

const profile = "release-8:trusted-rule-checksum";
const evidence: ValidationEvidence = {
  datasetId: "dataset-1",
  checksum: "rdf-checksum",
  conforms: true,
  profile,
  report: "SHACL report",
  runId: "run-1",
  checkedAt: new Date(),
};

describe("Release 8 assessment", () => {
  it("does not infer compliance from delivery or a demonstration validator", () => {
    expect(complianceState("rdf-checksum", undefined, profile).status).toBe(
      "not_assessed",
    );
    expect(complianceState("rdf-checksum", evidence, undefined).status).toBe(
      "not_assessed",
    );
    expect(
      complianceState(
        "rdf-checksum",
        { ...evidence, profile: "demonstration-title-only-NOT-release-8" },
        profile,
      ).status,
    ).toBe("not_assessed");
  });
  it("accepts positive and negative results only for the configured rules and exact RDF snapshot", () => {
    expect(complianceState("rdf-checksum", evidence, profile).status).toBe(
      "passed",
    );
    expect(
      complianceState("rdf-checksum", { ...evidence, conforms: false }, profile)
        .status,
    ).toBe("failed");
  });
  it("does not reuse a pass after metadata changes or from results without a checksum", () => {
    expect(complianceState("new-checksum", evidence, profile).status).toBe(
      "outdated",
    );
    const unchecked = { ...evidence };
    delete unchecked.checksum;
    expect(complianceState("rdf-checksum", unchecked, profile).status).toBe(
      "outdated",
    );
    expect(complianceState(null, evidence, profile).status).toBe("outdated");
  });
  it("distinguishes validator errors from nonconformance", () => {
    expect(
      complianceState(
        "rdf-checksum",
        { ...evidence, error: "Validator unavailable" },
        profile,
      ).status,
    ).toBe("validation_error");
  });
});
