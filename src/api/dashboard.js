// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

"use strict";
const el = (id) => document.getElementById(id);
let stateOffset = 0,
  runOffset = 0,
  timer,
  requestNumber = 0;
const date = (value) => (value ? new Date(value).toLocaleString() : "—");
function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = String(text);
  if (className) n.className = className;
  return n;
}
function badge(status) {
  const kind = ["failed", "uncertain"].includes(status)
    ? "bad"
    : ["delivered", "completed"].includes(status)
      ? "good"
      : "busy";
  return node("span", status, "badge " + kind);
}
function cell(row, content) {
  const td = node("td");
  td.append(
    content instanceof Node
      ? content
      : document.createTextNode(String(content ?? "—")),
  );
  row.append(td);
  return td;
}
function fields(entries) {
  const dl = node("dl", undefined, "detail-fields");
  for (const [label, value] of entries) {
    dl.append(node("dt", label), node("dd", value ?? "—"));
  }
  return dl;
}
function disclosure(label, content, key) {
  const d = node("details", undefined, "raw-report");
  d.dataset.key = key;
  d.append(node("summary", label), node("pre", content));
  return d;
}
function sourceLabel(source) {
  return (
    {
      catalogue: "Catalogue",
      userportal: "Catalogue",
      healthdata: "Legacy HealthData@EU",
      adapter: "Direct API",
    }[source] || source
  );
}
function shortTerm(value) {
  if (!value) return "—";
  const name = value.split("#").pop().split("/").filter(Boolean).pop();
  return name || value;
}
function validationPanel(evidence, key) {
  const section = node("section", undefined, "detail-section");
  section.append(node("h3", "Validation report"));
  if (!evidence) {
    section.append(
      node(
        "p",
        "No validation result has been recorded for this dataset.",
        "muted",
      ),
    );
    return section;
  }
  const outcome = evidence.error
    ? "Validation error"
    : evidence.conforms === true
      ? "Passed configured rules"
      : evidence.conforms === false
        ? "Failed configured rules"
        : "No conformance verdict";
  section.append(
    node(
      "span",
      outcome,
      "badge " +
        (evidence.error || evidence.conforms === false
          ? "bad"
          : evidence.conforms === true
            ? "good"
            : "neutral"),
    ),
  );
  section.append(
    fields([
      [
        "Original validator conformance",
        evidence.validatorConforms === undefined
          ? "—"
          : String(evidence.validatorConforms),
      ],
      ["Checked at", date(evidence.checkedAt)],
      ["Validation mode", evidence.validationMode],
      ["Ruleset version", evidence.version],
      ["Validation type", evidence.validationType],
      ["Profile", evidence.profile],
      ["Validator", evidence.validatorUrl],
      ["Run ID", evidence.runId],
      ["Validated RDF checksum", evidence.checksum],
    ]),
  );
  if (evidence.error) section.append(node("p", evidence.error, "detail-error"));
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  if (findings.length) {
    const count = (severity) =>
      findings.filter((f) => f.severity === severity).length;
    section.append(
      node(
        "p",
        findings.length +
          " findings · " +
          count("Violation") +
          " violations · " +
          count("Warning") +
          " warnings · " +
          count("Info") +
          " informational",
        "findings-count",
      ),
    );
    const wrap = node("div", undefined, "table-wrap findings");
    const table = node("table");
    const head = node("thead");
    const headings = node("tr");
    for (const label of [
      "Severity",
      "Field",
      "Finding",
      "Affected value / node",
    ]) {
      const th = node("th", label);
      th.scope = "col";
      headings.append(th);
    }
    head.append(headings);
    table.append(head);
    const body = node("tbody");
    for (const finding of findings) {
      const row = node("tr");
      cell(
        row,
        node(
          "span",
          finding.severity || "Unspecified",
          "badge " +
            (finding.severity === "Violation"
              ? "bad"
              : finding.severity === "Warning"
                ? "warning"
                : "neutral"),
        ),
      );
      const field = cell(row, shortTerm(finding.path));
      field.title = finding.path || "";
      const message = cell(
        row,
        finding.message || finding.constraint || "No message supplied",
      );
      if (finding.constraint) message.append(node("small", finding.constraint));
      const affected = cell(row, finding.value || "—");
      if (finding.focusNode)
        affected.append(node("small", "Node: " + finding.focusNode));
      body.append(row);
    }
    table.append(body);
    wrap.append(table);
    section.append(wrap);
  } else {
    section.append(
      node(
        "p",
        evidence.conforms === true
          ? "No structured findings were reported."
          : "No structured findings are available. Any saved report text is shown below.",
        "muted",
      ),
    );
  }
  if (evidence.report)
    section.append(
      disclosure(
        "Original validation report",
        evidence.report,
        key + ":original",
      ),
    );
  return section;
}
function showDialog(title, content) {
  el("detail-title").textContent = title;
  el("detail-content").replaceChildren(content);
  el("detail-dialog").showModal();
}
function viewButton(label, action) {
  const button = node("button", label, "view-details");
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}
function showDataset(state, operationMode, release8Profile) {
  const content = node("div");
  const delivery = node("section", undefined, "detail-section");
  delivery.append(node("h3", "Delivery information"));
  delivery.append(
    fields([
      ["Dataset ID", state.datasetId],
      ["Source", sourceLabel(state.sourceSystem)],
      ["Delivery status", state.status],
      ["Operation", state.operation],
      ["Last attempted", date(state.lastAttemptedAt)],
      ["Last successful", date(state.lastSuccessfulAt)],
      ["Retries", state.retryCount],
      ["Central Platform ID", state.centralPlatformObjectId],
      ["Dispatcher database ID", state.dispatcherDatabaseId],
      ["Correlation ID", state.correlationId],
      ["Delivered RDF checksum", state.checksum],
    ]),
  );
  if (state.lastError)
    delivery.append(node("p", state.lastError, "detail-error"));
  content.append(delivery);
  const assessment = state.compliance || {
    status: "not_assessed",
    reason: "No assessment available.",
  };
  const compliance = node("section", undefined, "detail-section");
  compliance.append(
    node("h3", "Release 8 assessment of the delivery snapshot"),
  );
  const labels = {
    not_assessed: "Not assessed",
    outdated: "Not assessed · different RDF snapshot",
    validation_error: "Validation error",
    passed: "Passed SHACL rules",
    failed: "Failed SHACL rules",
  };
  compliance.append(
    node("p", labels[assessment.status] || "Not assessed", "assessment-title"),
    node("p", assessment.reason, "muted"),
  );
  if (
    assessment.evidence?.profile &&
    assessment.evidence.profile !== release8Profile
  )
    compliance.append(
      node(
        "p",
        "The saved report uses a different profile from the configured Release 8 profile.",
        "note",
      ),
    );
  if (assessment.status === "outdated")
    compliance.append(
      node(
        "p",
        "The report below describes a different RDF snapshot. Its outcome does not establish compliance of the delivered metadata.",
        "snapshot-note",
      ),
    );
  content.append(
    compliance,
    validationPanel(
      assessment.evidence,
      "dataset:" + state.sourceSystem + ":" + state.datasetId,
    ),
  );
  showDialog("Dataset details", content);
}
function showRun(run) {
  const content = node("div");
  content.append(
    fields([
      ["Run ID", run.runId],
      ["Source", sourceLabel(run.sourceSystem)],
      [
        "Operation mode",
        run.mode === "legacy_delivery"
          ? "Historical delivery (validation mode unknown)"
          : run.mode,
      ],
      ["Validator selection", run.settings?.validator],
      ["Validation mode", run.settings?.validationMode],
      ["Ruleset version", run.settings?.validationVersion],
      ["Validation type", run.settings?.validationType],
      ["Language", run.settings?.language],
      ["Processing status", run.status],
      ["Started", date(run.startedAt)],
      ["Completed", date(run.completedAt)],
    ]),
  );
  if (run.error) content.append(node("p", run.error, "detail-error"));
  if (!run.reports?.length)
    content.append(
      node("p", "No per-dataset findings were recorded for this run.", "muted"),
    );
  for (const report of run.reports ?? []) {
    const card = node("details", undefined, "report-card");
    card.dataset.key = "run-report:" + run.runId + ":" + report.datasetId;
    card.append(node("summary", report.datasetId));
    if (report.conforms !== undefined)
      card.append(
        validationPanel(
          { ...report, checkedAt: run.completedAt, runId: run.runId },
          card.dataset.key,
        ),
      );
    else
      card.append(
        fields([
          ["Dataset ID", report.datasetId],
          ["Error", report.error],
        ]),
      );
    content.append(card);
  }
  showDialog("Synchronization details", content);
}
function empty(body, cols, text) {
  const row = node("tr");
  const td = cell(row, text);
  td.colSpan = cols;
  body.append(row);
}
function drawRuns(runs) {
  const body = el("runs");
  body.replaceChildren();
  if (!runs.length) empty(body, 10, "No synchronization runs on this page.");
  for (const run of runs) {
    const row = node("tr");
    const identity = cell(row, date(run.startedAt));
    identity.append(node("small", run.runId));
    const runMode = cell(
      row,
      run.mode === "legacy_delivery"
        ? "Historical delivery (validation mode unknown)"
        : run.mode,
    );
    runMode.append(
      node(
        "small",
        [
          sourceLabel(run.sourceSystem),
          run.settings?.validator,
          run.settings?.validationVersion,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    const runBadge = badge(run.status);
    if (run.status === "completed") {
      runBadge.textContent = "Processing complete";
      runBadge.className = "badge neutral";
    }
    const status = cell(row, runBadge);
    if (run.datasetsFailed > 0)
      status.append(node("small", run.datasetsFailed + " dataset(s) failed"));
    for (const key of [
      "datasetsSeen",
      "datasetsCreated",
      "datasetsUpdated",
      "datasetsSkipped",
      "datasetsDeleted",
      "datasetsFailed",
    ])
      cell(row, run[key]);
    cell(
      row,
      viewButton("View run", () => showRun(run)),
    );
    body.append(row);
  }
}
function drawStates(states, operationMode, release8Profile) {
  const body = el("deliveries");
  body.replaceChildren();
  if (!states.length)
    empty(
      body,
      8,
      "No dataset deliveries match this page or filter. Validation-only runs do not create deliveries.",
    );
  for (const state of states) {
    const row = node("tr");
    const identity = cell(row, state.datasetId);
    identity.append(node("small", sourceLabel(state.sourceSystem)));
    const deliveryBadge = badge(state.status);
    cell(row, deliveryBadge);
    const assessment = state.compliance || {
      status: "not_assessed",
      reason: "No assessment available.",
    };
    const labels = {
      not_assessed: "Not assessed",
      outdated: "Not assessed · metadata changed",
      validation_error: "Validation error",
      passed: "Passed SHACL rules",
      failed: "Failed SHACL rules",
    };
    const complianceCell = cell(
      row,
      node(
        "span",
        labels[assessment.status] || "Not assessed",
        "badge " +
          (assessment.status === "passed"
            ? "good"
            : assessment.status === "failed" ||
                assessment.status === "validation_error"
              ? "bad"
              : "neutral"),
      ),
    );
    complianceCell.title = assessment.reason;
    if (
      assessment.status === "outdated" &&
      assessment.evidence?.profile === release8Profile &&
      typeof assessment.evidence?.conforms === "boolean"
    )
      complianceCell.append(
        node(
          "small",
          "Last validation: " +
            (assessment.evidence.conforms ? "passed" : "failed") +
            " · different RDF snapshot",
        ),
      );
    cell(row, state.operation);
    cell(row, date(state.lastAttemptedAt));
    cell(row, date(state.lastSuccessfulAt));
    cell(row, state.retryCount);
    cell(
      row,
      viewButton("View dataset", () =>
        showDataset(state, operationMode, release8Profile),
      ),
    );
    body.append(row);
  }
}
async function refresh() {
  clearTimeout(timer);
  const current = ++requestNumber;
  const params = new URLSearchParams({
    stateOffset: String(stateOffset),
    runOffset: String(runOffset),
  });
  if (el("source").value) params.set("source", el("source").value);
  if (el("status").value) params.set("status", el("status").value);
  // Preserve expanded reports across background refreshes.
  const opened = new Set(
    [...document.querySelectorAll("details[open]")].map((d) => d.dataset.key),
  );
  try {
    const response = await fetch("/api/v1/monitoring?" + params, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error("Status endpoint returned HTTP " + response.status);
    const data = await response.json();
    if (current !== requestNumber) return;
    const counts = data.counts;
    el("total").textContent = Object.values(counts).reduce((a, b) => a + b, 0);
    el("delivered").textContent = counts.delivered || 0;
    el("pending").textContent = [
      "pending",
      "creating",
      "updating",
      "deleting",
    ].reduce((n, key) => n + (counts[key] || 0), 0);
    el("attention").textContent =
      (counts.failed || 0) + (counts.uncertain || 0);
    el("delivery-context").textContent =
      "Default operation mode: " +
      data.operationMode +
      ". Default validation: " +
      (data.validationMode || "unspecified") +
      (data.validationVersion ? " (" + data.validationVersion + ")" : "") +
      ". Delivery acknowledgements do not establish Release 8 compliance.";
    el("compliance-context").textContent = data.release8Profile
      ? "Release 8 results require this exact rule profile and a matching metadata checksum: " +
        data.release8Profile
      : "Release 8 compliance: Not assessed. No Release 8 rule profile is configured. Demonstration checks are not compliance assessments.";
    drawRuns(data.runs);
    drawStates(data.deliveries, data.operationMode, data.release8Profile);
    document.querySelectorAll("details").forEach((d) => {
      d.open = opened.has(d.dataset.key);
    });
    el("states-prev").disabled = stateOffset === 0;
    el("states-next").disabled = !data.hasMoreDeliveries;
    el("runs-prev").disabled = runOffset === 0;
    el("runs-next").disabled = !data.hasMoreRuns;
    el("states-page").textContent = "Page " + (stateOffset / 25 + 1);
    el("runs-page").textContent = "Page " + (runOffset / 10 + 1);
    el("error").hidden = true;
    el("updated").textContent =
      "Updated " + new Date(data.observedAt).toLocaleTimeString();
  } catch (error) {
    if (current !== requestNumber) return;
    el("error").textContent =
      "Could not refresh statuses. Displayed data may be stale. " +
      error.message;
    el("error").hidden = false;
    el("updated").textContent = "Connection interrupted";
  } finally {
    if (current === requestNumber) timer = setTimeout(refresh, 5000);
  }
}
el("detail-close").addEventListener("click", () => el("detail-dialog").close());
for (const id of ["source", "status"])
  el(id).addEventListener("change", () => {
    stateOffset = 0;
    refresh();
  });
for (const [id, step, kind] of [
  ["states-prev", -25, "state"],
  ["states-next", 25, "state"],
  ["runs-prev", -10, "run"],
  ["runs-next", 10, "run"],
]) {
  el(id).addEventListener("click", () => {
    if (kind === "state") stateOffset = Math.max(0, stateOffset + step);
    else runOffset = Math.max(0, runOffset + step);
    refresh();
  });
}
refresh();
