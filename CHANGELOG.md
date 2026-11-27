<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Changelog

Notable changes to this project are recorded here. Entries are grouped by
release; unreleased work is listed under `Unreleased`.

## Unreleased

First version of the National Dispatcher Integration Service.

- Scheduled and on-demand synchronization of one catalogue RDF
  (`DATASET_CATALOGUE_RDF_URL`) to the National Dispatcher: create, update and
  delete per dataset, with unchanged datasets skipped by checksum.
- Crash-safe delivery: each step is stored in PostgreSQL before the next
  dispatcher call, tracking resumes instead of resending, and a create whose
  outcome is unknown is marked `uncertain` for an operator.
- Domibus tracking and Central Platform verification. Datasets whose message is
  still in flight when tracking stops are counted in `datasetsInFlight` and
  resumed by the next run.
- Optional metadata validation (`validate_only`, `validate_and_sync`) with the
  bundled pySHACL engine or an external ITB validator, offline HealthDCAT-AP
  Release 8 rules for development, and per-run validator options.
- Read-only dashboard with sync health, grouped delivery counts, a "Needs
  attention" list, delivery and run history, and Release 8 assessments.
- HTTP API: start a full or single-dataset sync, read run status, monitoring
  data and one dataset's delivery state. Modifying requests need the operator
  token.
- Docker image and Compose setup, example configuration, Bruno requests, CI,
  contribution guidance, and automated security and dependency checks.
