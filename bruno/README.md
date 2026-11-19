<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bruno collection

This collection contains health, readiness, and source-to-dispatcher
synchronization requests. The optional dataset-delivery and direct National
Dispatcher collections are archived outside the repository at
`../national-dispatcher-integration-service-operator-collections/`.

## Test source-to-dispatcher synchronization

Configure the server's `DISPATCHER_URL`, `DISPATCHER_API_KEY`, source connection,
PostgreSQL connection and `CONTROL_API_TOKEN`, then start it with `npm run dev`.
Open this collection in Bruno, select `Local`, and set `datasetId` to an existing
dataset ID in the configured source. Set the `CONTROL_API_TOKEN` secret in the
Local environment.

1. Send **Health** and **Readiness**.
2. Send **sync / Sync One Dataset**. Its JSON body selects `sync_only`, without
   validator options. Expect HTTP 202 and `mode: sync_only`. The request saves
   `runId` automatically.
3. Repeat **sync / Get Sync Run** until `status` is `completed` or `failed`.
   Successful delivery requires `datasetsFailed: 0` and a created/updated count.
   Inspect `reports` and `error` if it fails. A skipped dataset was already
   delivered unchanged and does not produce another dispatcher write.
4. Inspect persisted delivery identifiers and status in the read-only dashboard
   or `GET /api/v1/monitoring`. Confirm receipt in the dispatcher's own
   tracking/logs when verifying the remote system independently.

**Sync One Dataset** processes only the selected source dataset. **Run Sync Only**
processes all datasets from the default source and reconciles deletions. Both use
`sync_only`, save `runId` automatically, and require the operator token. Run
requests individually; running the whole collection starts a full sync.
