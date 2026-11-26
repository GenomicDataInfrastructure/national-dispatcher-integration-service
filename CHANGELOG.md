<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Changelog

Notable changes to this project are recorded here. Entries are grouped by
release; unreleased work is listed under `Unreleased`.

## Unreleased

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
