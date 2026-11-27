<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# National Dispatcher Integration Service

Server-side service that synchronizes dataset metadata from a single catalogue RDF (`DATASET_CATALOGUE_RDF_URL`) to the existing National Dispatcher. The catalogue is the only input. It does not transfer dataset files or replace dispatcher/Central Platform behavior.

- [How the service works](docs/ARCHITECTURE.md): components, sync flow, delivery lifecycle, API and stored data.
- [Configuration reference](docs/CONFIGURATION.md): every environment variable, defaults and startup checks.

## License

Original application source is licensed under Apache-2.0; project documentation
is licensed under CC-BY-4.0. Bundled third-party validator resources retain their
own licenses and attribution. See [`LICENSES/README.md`](LICENSES/README.md) and
the notices under `validator/release-8/` for details.

## Read-only dashboard and operator access

Open `http://localhost:8080/` to view delivery counts, paginated synchronization
history, per-dataset state, timestamps, and error/validation reports. It refreshes
every five seconds. Source/status filters and pagination only read data. Counts
cover all persisted delivery records, and removed records are excluded. Run
counters are finalized at completion; a completed run can contain failed datasets.

Dashboard and status GET endpoints require no control token. Deploy them behind
your normal access boundary if metadata/status information should be private.
The UI contains no controls for triggering, retrying, updating, or deleting data.
All modifying HTTP requests require `Authorization: Bearer <CONTROL_API_TOKEN>`.
Without a configured token, API controls return 503; missing/incorrect credentials
return 401 when a token is configured. Scheduled synchronization still follows
server configuration and is independent of dashboard viewers.

Configure a random token of at least 32 characters in server-side `.env` (generate
one with `openssl rand -hex 32`). Keep it out of browser code, URLs, and shared
collections. Existing API callers must be updated to send this token. The token
is distinct from the dispatcher API key and is redacted from request logs.

For manual operations, load your local `.env` into your operator terminal first:

```bash
set -a
source .env
set +a
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST http://localhost:8080/api/v1/sync
```

The dashboard reads `GET /api/v1/monitoring`; optional `status`, `stateOffset`,
and `runOffset` query parameters filter and page through
25 deliveries and 10 runs per response. It reads persisted state only and makes
no calls to the catalogue or the dispatcher. No credentials are included in its
responses. Expand a run or dataset's details to inspect errors and identifiers.

## API

Metadata enters the service only through catalogue synchronization. Start a run
asynchronously (the dispatcher API key is read only from server configuration):

```bash
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST http://localhost:8080/api/v1/sync
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST http://localhost:8080/api/v1/sync/dataset/dataset-123
curl http://localhost:8080/api/v1/sync/00000000-0000-0000-0000-000000000000
```

To look up the delivery state of one catalogue dataset, URL-encode its dataset
URI. The request needs no token, reads stored state only and returns 404 when
nothing is recorded for that dataset:

```bash
# Dataset https://catalogue.example/dataset/1
curl http://localhost:8080/api/v1/datasets/https%3A%2F%2Fcatalogue.example%2Fdataset%2F1/status
```

Each POST returns `202`, a run ID, its actual operation `mode`
(`validate_only`, `validate_and_sync`, or `sync_only`), and its processing `status`.
Run statuses are `queued`, `running`, `completed`, or `failed`; dataset delivery
statuses such as `delivered` remain separate. A completed run can include failed
datasets, as shown by `datasetsFailed` and its reports. Datasets whose Domibus
message is still in flight when tracking stops are counted in `datasetsInFlight`
instead, with a report carrying `deliveryStatus` and a `note`. An explicit
`?mode=validate_only` requests validation only; the legacy `?mode=validate` alias
still works. Omitting the query follows `OPERATION_MODE`; the legacy
`?mode=deliver` alias also follows that configuration.
A second run is rejected while one is active.
The metadata source is configured with `DATASET_CATALOGUE_RDF_URL`.

## Local setup

Requires Node.js 24 and PostgreSQL. Local metadata validation also requires Python 3.11+ and the dependencies below. Copy `.env.example` to `.env`, set dispatcher credentials, then run:

```bash
npm ci
npm run dev
```

`npm run dev` watches `.env`, `src/`, and `validator/` and restarts automatically
when they change. Each restart reloads `.env`; its values take precedence over
variables previously exported in your terminal. The watcher uses polling to avoid
native file-watcher limits. Stop it with Ctrl-C. Changing configuration restarts
the process, so let active syncs finish before editing it.

`npm start` runs the built application without watching. Stop an existing instance
before starting `npm run dev` on the same port.

The service creates the configured PostgreSQL schema and applies any pending migrations at startup, recording each in `schema_migrations`. For a containerized local PostgreSQL and service, use `docker compose up --build`.
Compose overrides `POSTGRES_URL` with the internal `postgres` service hostname. Set `COMPOSE_POSTGRES_URL` only when Compose should connect to a different database.

HDAB and GDI deployments should use separate PostgreSQL users/databases or schemas. Grant each runtime user access only to its configured schema.

## Dataset discovery

Configure the complete catalogue RDF with one setting:

```dotenv
DATASET_CATALOGUE_RDF_URL=https://catalogue.portal.gdi.lu/catalog.rdf
```

The client downloads the catalogue once per run and extracts each `dcat:Dataset`
with its linked metadata, including distributions, publishers and contact points.
It preserves RDF properties, language tags, datatypes and blank-node relationships;
XML formatting and node ordering can change. No per-dataset RDF requests or URL
templates are needed. Single-dataset requests also extract from the catalogue.
Catalogue wrappers and other datasets are excluded from each dataset's RDF.

Dataset identity is the full dataset URI, so repeated `dct:identifier` values do
not collide. Delivery state is stored under the source `catalogue`. Discovery tolerates
invalid metadata IRIs without repairing their values; validation may still reject
that metadata. Incomplete reference-only or paginated catalogues are rejected
before deletion reconciliation.
Scheduled synchronization uses `SYNC_ENABLED` and `SYNC_SCHEDULE`.

## Per-run API options

Both `POST /api/v1/sync` and `POST /api/v1/sync/dataset/:datasetId` accept an
optional JSON body. Omitted fields use the configured defaults. Scheduled runs
continue to use those defaults; request overrides do not modify `.env` or affect
subsequent runs.

```sh
curl -X POST http://localhost:8080/api/v1/sync \
  -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"operationMode":"validate_only","validator":"release8-local","validationType":"auto","language":"en-GB"}'
```

| Field               | Supported values / behavior                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operationMode`     | `validate_only`, `validate_and_sync`, or `sync_only`. Explicit delivery modes can write to the dispatcher; `OPERATION_MODE` is the default for sync requests. |
| `validator`         | `configured` (default), `local-shacl`, `release8-local`, or `ehds-api`.                                                                                       |
| `validationVersion` | Selects a resource through the server's `{version}` template. `release8-local` supports only `release-8`.                                                     |
| `validationType`    | `auto` (default unless configured otherwise), `public`, `non-public`, or `restricted`.                                                                        |
| `language`          | Language tag sent with the catalogue request, for example `en-GB` or `fr-LU`.                                                                                 |

`configured` uses the existing validator configuration. `local-shacl` uses the
configured shapes and Python runtime. `release8-local` selects the built offline
`validator/release-8/{accessLevel}.trig` bundles; run `npm run test:release8` to
build and verify them first. `ehds-api` uses the server's
`METADATA_VALIDATOR_URL` with the ITB protocol. Alternate validators derive their
own profiles instead of inheriting the default validator's profile label.
Ruleset versions must select actual installed local resources or a configured API
URL template. A missing local bundle is rejected before a run is created.

Validation options are rejected with `sync_only`. URLs, credentials, shapes paths,
Python executable paths, profile labels and resource limits cannot be supplied by
a caller. Invalid options return HTTP 400. The existing control token is required.
Do not combine a JSON options body with the legacy `?mode=` query.

Responses include the run's resolved `settings`; `GET /api/v1/sync/:runId` and the
dashboard retain these settings even after service defaults change. Per-dataset
reports retain the actual selected access level and ruleset profile/hash.

`DATASET_CATALOGUE_RDF_URL` is the sole metadata source for synchronization.
Scheduling uses `SYNC_ENABLED` and `SYNC_SCHEDULE`.

## Synchronization guarantees

- SHA-256 checksum equality skips an unchanged delivery.
- A PostgreSQL advisory lock serializes synchronization runs.
- Dataset identity is the full URI of each embedded `dcat:Dataset` in the catalogue.
- Create intent is persisted before the dispatcher call. A timeout/network failure leaves `uncertain`, preventing an automatic duplicate create.
- Once a dispatcher `databaseId` is received it is persisted; subsequent delivery attempts resume tracking and verification instead of posting again.
- While tracking, the delivery status follows Domibus: `READY_TO_SEND`, `SEND_ENQUEUED`, `SEND_IN_PROGRESS`, `WAITING_FOR_RECEIPT`, `SEND_ATTEMPT_FAILED`, and `WAITING_FOR_RETRY` are shown as observed and polling continues. Domibus manages retries for the two retry statuses; this service does not submit another send while tracking that message.
- If tracking times out (`DISPATCHER_VERIFICATION_TIMEOUT_MS`) while the message is still in flight, the delivery keeps its Domibus status (or `pending` if Domibus has not reported one yet, after a timeout or network error) instead of becoming `failed`. The run counts the dataset in `datasetsInFlight`, not `datasetsFailed`, and the next run resumes tracking the same message.
- Choosing `DISPATCHER_VERIFICATION_TIMEOUT_MS`: it only needs to cover a normal delivery (the dispatcher hands a message to Domibus in about 5 seconds, then Domibus sends and receives a receipt), not Domibus retries, which later runs pick up. Datasets are processed one at a time, so a run with many stuck messages can take roughly their number × the timeout; keep that below the `SYNC_SCHEDULE` interval, or the overlapping scheduled run is skipped. Values around 15–30 seconds suit a 15-minute schedule.
- `ACKNOWLEDGED` and `ACKNOWLEDGED_WITH_WARNING` proceed to Central Platform verification. After verification succeeds, the local status becomes `delivered`. `SEND_FAILURE`, `NOT_FOUND`, and `DELETED` are terminal Domibus statuses: the run counts the dataset as failed, and the next delivery attempt submits a fresh message instead of tracking the old one. Missing Domibus status is treated as not yet available, so tracking continues until a status appears or the verification timeout is reached.
- Successful verification stores the Central Platform object ID used for later update/delete calls.
- A delete is removed from local state only after successful verification or dispatcher HTTP 404.

An `uncertain` create intentionally requires operator reconciliation: without a dispatcher ID there is no safe automated way to distinguish a rejected request from an accepted response that was lost.

## Validation

```bash
npm run validate
```

## Bruno

Open the [`bruno`](./bruno) directory as a Bruno collection and select the
`Local` environment for health, readiness, and source synchronization requests.
Create it by copying `bruno/environments/Local.example.bru` to
`bruno/environments/Local.bru` and filling in the placeholders.
Direct National Dispatcher collections are kept in the
sibling `../national-dispatcher-integration-service-operator-collections/`
directory. The repository includes only a placeholder Bruno environment sample.

## Validation severity policy

Datasets pass when their structured SHACL findings contain only `Warning` or
`Info` results. Warnings remain visible and do not block `validate_and_sync` or
increment failed-dataset counts. `Violation`, missing/unknown severity, parser
errors, and validator failures still fail. A negative verdict without structured
findings remains a failure.

`conforms` records the application's outcome under this policy;
`validatorConforms` preserves the engine's original strict SHACL verdict.
The original report is preserved. Existing saved run outcomes and counts are
unchanged; rerun validation to apply the policy to old results.

## Validation-only synchronization

For optional remote validation with `VALIDATION_MODE=itb`, set `METADATA_VALIDATOR_URL`
to the ITB validation endpoint. The endpoint must apply your agreed SHACL rules;
this service does not bundle Health DCAT-AP Release 8 rules or certify compliance itself.

```bash
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST 'http://localhost:8080/api/v1/sync?mode=validate_only'
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST 'http://localhost:8080/api/v1/sync/dataset/dataset-123?mode=validate_only'
curl http://localhost:8080/api/v1/sync/RUN_ID
```

Validation-only runs fetch metadata from the configured RDF catalogue and persist per-dataset reports
without accessing delivery state or calling the dispatcher. Inspect `reports`
and `datasetsFailed`: `completed` means processing finished, including runs with
nonconforming datasets. A missing validator prevents the run from starting.
`OPERATION_MODE` controls the default for manual and scheduled runs. Delivery failures
also include per-dataset error messages in the run's `reports` array.

## Bundled metadata validator

Validation runs inside this application through a bundled pySHACL worker. It needs
no validator HTTP server, separate container, or sibling sandbox repository.
Run commands from the project directory:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r validator/requirements.txt
```

Configure `.env` with a trusted, self-contained SHACL Turtle rules file:

```dotenv
VALIDATION_MODE=shacl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
METADATA_VALIDATOR_SHAPES_FILE=/absolute/path/to/approved-shapes.ttl
METADATA_VALIDATOR_URL=
OPERATION_MODE=validate_and_sync
```

The worker reads RDF/XML from stdin and returns conformance, report text, and
structured findings. Each invocation has a timeout and report size limit. Parser,
engine, and dependency failures block delivery in validation modes. Rules imports
and JavaScript extensions are disabled; supply all required rules in the file.
Unless explicitly configured, the report profile contains the shapes SHA-256 hash.
Set `METADATA_VALIDATOR_PROFILE` only to identify the actual rules being run.

`validator/example-shapes.ttl` is a title-only demonstration for local smoke tests;
it is **not** Health DCAT-AP Release 8 validation. No production shapes are enabled
by default. An offline Release 8 development profile is now available under
[`validator/release-8`](validator/release-8/README.md). It preserves the official
resources and builds separate public, non-public and restricted bundles with an
explicit, separately identified pySHACL compatibility correction. Run
`npm run test:release8` to build and test all three variants. Review the documented
limitations before enabling dashboard compliance assessments.

The application Docker image installs the engine and includes `validator/`.
Mount your approved shapes into the container and set their container path in
`METADATA_VALIDATOR_SHAPES_FILE`. For Docker, leave `METADATA_VALIDATOR_PYTHON`
unset so the image uses `/opt/validator/bin/python`.

### SHACL/API mode and ruleset version

`VALIDATION_MODE` controls where validation happens independently of
`OPERATION_MODE`:

- `shacl` runs the bundled pySHACL engine against local shapes and makes no validator API calls.
- `itb` calls a HealthData@EU API using JSON requests and SHACL JSON-LD responses.

Remote API failures fail validation; there is no SHACL fallback.

`VALIDATION_VERSION` selects a version by replacing `{version}` in the shapes
path (`shacl`) or API URL (`itb`). When set, the selected path or URL **must**
contain `{version}` so changing the version selects a different resource instead
of merely relabelling reports. Versions may contain letters, digits, dots,
underscores and hyphens. Leave it unset for a fixed shapes file or endpoint.

SHACL example (place the actual approved rules in the matching directory):

```dotenv
VALIDATION_MODE=shacl
VALIDATION_VERSION=release-8
METADATA_VALIDATOR_SHAPES_FILE=validator/shapes/{version}/shapes.ttl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
```

API example, **only for an API deployment that supports this URL structure**:

```dotenv
VALIDATION_MODE=itb
VALIDATION_VERSION=release-8
METADATA_VALIDATOR_URL=https://your-validator.example/{version}/api/validate
METADATA_VALIDATOR_VALIDATION_TYPE=auto
```

Use the versioned URL structure documented by your API deployment; the application
does not assume the public HealthData@EU endpoint supports version selection.
For an unversioned API, leave `VALIDATION_VERSION` unset.
`METADATA_VALIDATOR_PROFILE` is optional: when blank, the application generates
`itb-endpoint:sha256:<endpoint-hash>`. This identifies the endpoint, not a verified
ruleset or Release 8 release. Set an explicit profile only for a verified ruleset.

Results retain the validation mode and configured version alongside the profile,
checksum and findings. SHACL profiles retain the actual shapes hash. API ITB
profiles default to `health-dcat-ap:<version>` when no explicit profile is supplied.
A version setting does not install rules or verify that the remote deployment
serves the claimed release. Keep `RELEASE8_VALIDATION_PROFILE` unset until verified.

`VALIDATION_MODE` defaults to `shacl`. Select `itb` explicitly for remote validation.

## Delivery versus Release 8 assessment

The dashboard displays delivery status separately from Release 8 assessment.
`OPERATION_MODE` controls processing against the actual dispatcher:

- `validate_only`: validate catalogue metadata and store reports without delivery writes.
- `validate_and_sync`: validate each dataset before create/update; invalid metadata or validator errors block that dataset. Deletes still synchronize.
- `sync_only` (default): synchronize without metadata validation.

Validation modes require local shapes (`METADATA_VALIDATOR_SHAPES_FILE`), or `METADATA_VALIDATOR_URL` when using a remote adapter. Scheduled syncs and manual requests without overrides follow this setting; JSON run options can select a different mode for a single run. Delivery acknowledgements never establish metadata compliance.

Release 8 assessments default to **Not assessed**. To enable results, use a
compatible validator with the full agreed Release 8 rules (including baseline,
access-level rules, and dependencies), and set `RELEASE8_VALIDATION_PROFILE` to
its exact `profile` identifier (configured on the ITB adapter). Include a ruleset version/checksum in
that identifier. Never point this setting at the demonstration title-only profile.
Run validation-only sync with operator authorization to record assessments.

Each new validation report records the SHA-256 of the RDF it checked. The dashboard
shows a pass/fail only when that checksum matches the delivery record and the
profile exactly matches configuration. A changed or unidentifiable snapshot is
shown as unassessed/outdated, and a validator failure is an error rather than a
conformance verdict. Historical reports without checksums cannot establish a pass.
Assessments describe the stored RDF snapshot, not later catalogue changes.
Validation-only reports remain visible in sync history even without a delivery
record.

## HealthData@EU validator API

To use the external EHDS validator instead of the bundled SHACL engine:

```dotenv
VALIDATION_MODE=itb
# Fixed endpoint: leave VALIDATION_VERSION unset.
METADATA_VALIDATOR_URL=https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/ehds/api/validate
METADATA_VALIDATOR_VALIDATION_TYPE=auto
METADATA_VALIDATOR_PROFILE=
METADATA_VALIDATOR_TIMEOUT_MS=120000
RELEASE8_VALIDATION_PROFILE=
```

The adapter posts JSON containing the unchanged RDF/XML, `embeddingMethod=STRING`,
`contentSyntax=application/rdf+xml`, the access-level `validationType`, and
`reportSyntax=application/ld+json`. It uses the SHACL `ValidationReport` conformance
value, not HTTP 200, to determine success. It also supports the ITB base64 JSON-LD
report envelope. Reports include readable findings plus the full JSON-LD report,
validator endpoint, selected access level, RDF checksum, and validation timestamp.
No dispatcher API key or operator token is sent to this API.

`auto` parses the RDF and chooses `public`, `non-public`, or `restricted` from the
single dataset's declared `dct:accessRights` IRI. Missing, unknown, or ambiguous
access rights produce a validation error rather than guessing. An operator can
set one of the three explicit types to assess metadata with missing access rights
against the intended rules. Invalid XML, missing/contradictory SHACL verdicts,
HTTP failures, and timeouts remain errors, never passes.

The default generated profile identifies the remote endpoint. The managed API
does not return an immutable ruleset version/hash. Confirm its deployed ruleset
with the validator owner before setting an explicit profile and matching
`RELEASE8_VALIDATION_PROFILE`. The bundled engine is not used in API mode.

A validation-only run sends metadata (not dataset files) to this external service.
`npm run dev` automatically restarts after `.env` changes. Then run with operator auth:

```bash
set -a
source .env
set +a
curl -H "Authorization: Bearer $CONTROL_API_TOKEN" -X POST 'http://localhost:8080/api/v1/sync?mode=validate_only'
```

Use `/api/v1/sync/dataset/DATASET_ID?mode=validate_only` for a single dataset.
Validation-only runs do not deliver anything. Normal delivery sync remains
separate and does not automatically invoke this validator or gate submissions.
The read-only dashboard displays assessments when the report checksum matches
the delivery snapshot; expand details for the validation findings.

API reference: <https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/swagger-ui/index.html>.

## Per-dataset HTML details

Open the dashboard and choose **View dataset** on a delivery row. The read-only
HTML dialog shows delivery identifiers, attempts/retries, a separate Release 8
assessment, and the saved validator's findings as a table (severity, field,
message, affected node/value). Snapshot mismatches and unavailable assessments
remain explicit. The original report is available in a collapsed section.

**View run** groups saved reports by dataset, including validation-only datasets
that have no delivery record. Existing JSON-LD reports are converted to structured
findings locally when read; opening details never sends metadata to the validator
or starts another sync. Press Escape or Close to dismiss the dialog.
