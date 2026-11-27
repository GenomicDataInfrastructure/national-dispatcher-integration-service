<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Changelog

Notable changes to this project are recorded here. Entries are grouped by
release; unreleased work is listed under `Unreleased`.

## Unreleased

- Removed the direct delivery API (`/api/v1/dataset-deliveries`) and its
  `adapter` source. The catalogue configured with `DATASET_CATALOGUE_RDF_URL` is
  now the only way metadata enters the service.
- Removed handling for data from earlier deployments, since the service starts
  with an empty database: the migrations are squashed into
  `001_initial_schema.sql`, catalogue rows are stored under `catalogue` instead
  of `userportal`, and legacy HealthData records, the monitoring `source`
  filter, old run modes and the non-URI dataset ID check are gone. Recreate any
  local or test database that ran the earlier migrations.
- Added `GET /api/v1/datasets/:datasetId/status` to look up the delivery state
  of one catalogue dataset. It replaces the removed direct API's status
  endpoint, which only found datasets pushed through that API.
- Initial repository setup for the National Dispatcher Integration Service.
- Added the HTTP API, read-only monitoring dashboard, PostgreSQL-backed delivery
  state, and scheduled catalogue synchronization.
- Added configurable metadata validation, including local SHACL validation and
  offline HealthDCAT-AP Release 8 resources for development and testing.
- Added Docker Compose setup, example configuration, Bruno requests, CI,
  contribution guidance, and automated security and dependency checks.
- Sync runs count datasets whose Domibus message is still in flight (for
  example `WAITING_FOR_RETRY`) when tracking stops in a new `datasetsInFlight`
  counter instead of `datasetsFailed`; the dashboard shows them separately.
- A tracking timeout or network error before Domibus reports a status keeps the
  delivery `pending` instead of recording it as `failed`.
- The dashboard shows sync health at the top: time since the last completed
  sync (flagged when overdue by more than two schedule intervals), whether a
  sync is running, the next scheduled sync, and how many messages are waiting
  on Domibus.
- A "Needs attention" list shows failed, uncertain and Domibus-stopped
  deliveries with their last error and what to do, uncertain ones first.
- Dashboard counts now include Domibus statuses, so "Delivered", "In progress"
  and "Needs attention" add up to the total. Previously datasets in statuses
  such as `WAITING_FOR_RETRY` or `SEND_FAILURE` were missing from these counts.
