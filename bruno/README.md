<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Bruno collection

Requests for checking a running service: health, readiness, starting a sync,
following a run and reading one dataset's delivery state.

| Request                | Does                                                            |
| ---------------------- | --------------------------------------------------------------- |
| **Health**             | `GET /health`: the process is up.                               |
| **Readiness**          | `GET /ready`: PostgreSQL is reachable.                          |
| **Run Sync Only**      | Full `sync_only` sync of the catalogue, including deletions.    |
| **Sync One Dataset**   | `sync_only` sync of the dataset in `datasetId`. No deletions.   |
| **Get Sync Run**       | Status, counters and reports of the last started run (`runId`). |
| **Get Dataset Status** | Stored delivery state of the dataset in `datasetId`.            |

The sync requests write to the National Dispatcher and need the control token.
Send requests one at a time; running the whole collection starts a full sync.

## Setup

1. Configure and start the service (`npm run dev`); see the
   [project README](../README.md#quick-start).
2. Open this directory as a collection in Bruno.
3. Copy `environments/Local.example.bru` to `environments/Local.bru` (ignored by
   Git) and select the **Local** environment.
4. Set the `CONTROL_API_TOKEN` secret to the service's token, and `datasetId`
   to a URL-encoded catalogue dataset URI, for example
   `https%3A%2F%2Fcatalogue.example%2Fdataset%2F1`.

## Checking one dataset end to end

1. Send **Health** and **Readiness**.
2. Send **Sync One Dataset**. Expect `202` and `mode: sync_only`; the run ID is
   saved as `runId`.
3. Repeat **Get Sync Run** until `status` is `completed` or `failed`. A clean
   delivery has `datasetsFailed: 0` and a created or updated count; a skipped
   dataset was already delivered unchanged. Otherwise inspect `reports` and
   `error`.
4. Send **Get Dataset Status** to see the stored status, Domibus message ID and
   Central Platform object ID, or open the dashboard. To confirm receipt
   independently, check the dispatcher's own tracking.
