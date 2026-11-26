<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Configuration reference

The service is configured only through environment variables. Locally they are
read from `.env` (copy [`.env.example`](../.env.example) to start). In Docker
Compose the same file is passed with `env_file`.

All values are checked at startup by
[src/config/config.ts](../src/config/config.ts). An invalid or missing required
value stops the service with an error, rather than starting with a broken
configuration. An empty value (`NAME=`) is treated the same as unset.

For how these settings affect behaviour, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Quick start: minimum configuration

```dotenv
DISPATCHER_URL=https://dispatcher.example.org
DISPATCHER_API_KEY=<dispatcher key>
POSTGRES_URL=postgresql://dataset_delivery:change-me@localhost:5432/dataset_delivery
DATASET_CATALOGUE_RDF_URL=https://catalogue.portal.gdi.lu/catalog.rdf
CONTROL_API_TOKEN=<output of: openssl rand -hex 32>
```

This runs a delivery sync (`sync_only`, no validation) every 15 minutes.

## HTTP server

| Variable            | Default   | Description                                                                                                                                                                                                                                      |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`              | `8080`    | Port to listen on (1 to 65535).                                                                                                                                                                                                                  |
| `HOST`              | `0.0.0.0` | Interface to bind to.                                                                                                                                                                                                                            |
| `CONTROL_API_TOKEN` | unset     | Bearer token required for every non-GET request (starting syncs, direct deliveries). Minimum 32 characters. When unset, those requests return 503 and the dashboard is read-only. It is separate from the dispatcher key and redacted from logs. |

## National Dispatcher

| Variable                             | Default      | Description                                                                                                                                                                                                                           |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISPATCHER_URL`                     | **required** | Base URL of the National Dispatcher. A trailing `/` is removed. The service calls paths under `/national-dispatcher/`.                                                                                                                |
| `DISPATCHER_API_KEY`                 | **required** | Sent as `X-API-Key` on every dispatcher request. Never sent to any other service.                                                                                                                                                     |
| `DISPATCHER_CONNECTION_TIMEOUT_MS`   | `5000`       | Maximum time to receive response headers from a single dispatcher request.                                                                                                                                                            |
| `DISPATCHER_REQUEST_TIMEOUT_MS`      | `30000`      | Maximum total time for a single dispatcher request.                                                                                                                                                                                   |
| `DISPATCHER_VERIFICATION_TIMEOUT_MS` | `120000`     | How long to keep polling Domibus tracking, and then Central Platform verification, for one dataset. If it runs out while the message is still in flight, the dataset is counted as in flight (not failed) and the next run continues. |
| `DISPATCHER_POLL_INTERVAL_MS`        | `1000`       | Wait between tracking and verification polls.                                                                                                                                                                                         |

**Choosing the verification timeout:** it only needs to cover a normal delivery
(a few seconds for the dispatcher to hand off, then Domibus delivery and
receipt). Domibus retries are picked up by later runs. Because datasets are
processed one at a time, a run can take up to _stuck datasets ×
timeout_. 15 to 30 seconds suits the default 15-minute schedule.

## Database

| Variable               | Default            | Description                                                                                                                          |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_URL`         | **required**       | PostgreSQL connection string.                                                                                                        |
| `POSTGRES_SCHEMA`      | `dataset_delivery` | Schema for all tables. Created at startup if missing. Must be a lowercase identifier (`a-z`, `0-9`, `_`).                            |
| `COMPOSE_POSTGRES_URL` | unset              | Docker Compose only. Overrides the connection string Compose gives the service; by default it uses the bundled `postgres` container. |

HDAB and GDI deployments should use separate databases or schemas, each with a
database user that can access only its own schema.

## Catalogue and scheduling

| Variable                    | Default                             | Description                                                                                                                                                |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATASET_CATALOGUE_RDF_URL` | unset, but **required in practice** | URL of the complete catalogue RDF export. The service fails to start without it. It must be a single, non-paginated export that contains a `dcat:Catalog`. |
| `SYNC_ENABLED`              | `true`                              | Run syncs on a schedule. Accepts `true`, `false`, `1`, `0`. Manual syncs through the API work either way.                                                  |
| `SYNC_SCHEDULE`             | `*/15 * * * *`                      | Five-field cron expression (minute, hour, day of month, month, day of week), evaluated in the server's local time.                                         |

The scheduler supports a limited cron syntax per field: `*`, `*/n`, a single
number, or a comma-separated list of those (for example `0,30 * * * *`).
Ranges such as `1-5` are **not** supported.

`METADATA_SOURCES_JSON` was removed. If it is still set, startup fails with a
message asking you to use `DATASET_CATALOGUE_RDF_URL` instead.

## Operation mode

| Variable         | Default     | Description                                                         |
| ---------------- | ----------- | ------------------------------------------------------------------- |
| `OPERATION_MODE` | `sync_only` | What scheduled runs and API runs without an override do. See below. |

- `sync_only`: deliver changes without validating metadata. The dispatcher's
  own RDF validation is also turned off (`disableValidation=true`).
- `validate_and_sync`: validate each dataset first; only passing datasets are
  delivered. Deletes still go through. Direct `POST`/`PUT` deliveries are
  validated too and return 422 on failure.
- `validate_only`: validate and store reports; nothing is sent to the
  dispatcher. Direct delivery writes are rejected with 409.

Any mode other than `sync_only` needs a working validator configuration
(below); otherwise the service refuses to start.

A single run can use a different mode through the API request body
(`{"operationMode": "validate_only"}`). That does not change the configured
default.

## Metadata validation

| Variable                             | Default                                          | Description                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_MODE`                    | `shacl`                                          | `shacl`: run the bundled pySHACL engine locally. `itb`: call an external ITB validator API.                                                                                                                      |
| `METADATA_VALIDATOR_SHAPES_FILE`     | unset                                            | `shacl` mode: path to a trusted, self-contained Turtle file of SHACL rules. Required when `VALIDATION_MODE=shacl` and the mode validates.                                                                        |
| `METADATA_VALIDATOR_PYTHON`          | `python3`; `/opt/validator/bin/python` in Docker | `shacl` mode: Python interpreter that has `validator/requirements.txt` installed. Locally use `.venv/bin/python`. Leave unset in Docker.                                                                         |
| `METADATA_VALIDATOR_URL`             | unset                                            | `itb` mode: validator endpoint, e.g. `https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/ehds/api/validate`.                                                                                      |
| `VALIDATION_VERSION`                 | unset                                            | Replaces `{version}` in the shapes path or validator URL, e.g. `release-8` with `validator/shapes/{version}/shapes.ttl`. When set, the path or URL **must** contain `{version}`. Letters, digits, `.`, `_`, `-`. |
| `METADATA_VALIDATOR_VALIDATION_TYPE` | `auto`                                           | Access level whose rules apply: `auto` (read from the dataset's `dct:accessRights`), `public`, `non-public`, or `restricted`. With `auto`, missing or unknown access rights is a validation error.               |
| `METADATA_VALIDATOR_PROFILE`         | generated                                        | Label stored with each report to identify the ruleset. When unset, it is generated from a SHA-256 hash of the shapes file (`shacl`) or endpoint (`itb`). Set it only to name a verified ruleset.                 |
| `METADATA_VALIDATOR_TIMEOUT_MS`      | `120000`                                         | Maximum time for one validation. The local worker is killed when it runs out.                                                                                                                                    |
| `RELEASE8_VALIDATION_PROFILE`        | unset                                            | Exact profile label that counts as a Health DCAT-AP Release 8 assessment on the dashboard. Leave unset until you run the complete, verified Release 8 rules; while unset, the dashboard shows "Not assessed".    |

### Local SHACL setup

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r validator/requirements.txt
```

```dotenv
OPERATION_MODE=validate_and_sync
VALIDATION_MODE=shacl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
METADATA_VALIDATOR_SHAPES_FILE=/absolute/path/to/approved-shapes.ttl
```

`validator/example-shapes.ttl` only checks for a title. It is for smoke tests
and is not Release 8 validation. The offline Release 8 bundles in
[validator/release-8](../validator/release-8/README.md) are built with
`npm run test:release8`.

In Docker, mount the shapes file into the container and set its container path
in `METADATA_VALIDATOR_SHAPES_FILE`.

### External ITB validator setup

```dotenv
VALIDATION_MODE=itb
METADATA_VALIDATOR_URL=https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/ehds/api/validate
METADATA_VALIDATOR_VALIDATION_TYPE=auto
```

Metadata (not dataset files) is sent to this service. No dispatcher key or
control token is sent.

## Per-run overrides

`POST /api/v1/sync` and `POST /api/v1/sync/dataset/:datasetId` accept an
optional JSON body that applies to that run only:

| Field               | Values                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `operationMode`     | `validate_only`, `validate_and_sync`, `sync_only`                               |
| `validator`         | `configured` (default), `local-shacl`, `release8-local`, `ehds-api`             |
| `validationVersion` | Version for the `{version}` template; `release8-local` accepts only `release-8` |
| `validationType`    | `auto`, `public`, `non-public`, `restricted`                                    |
| `language`          | Language tag sent to the catalogue, e.g. `en-GB` (default), `fr-LU`             |

Validation fields are rejected together with `sync_only`. URLs, file paths,
credentials and limits can never be set per request.

## Fixed limits (not configurable)

| Limit                           | Value                             |
| ------------------------------- | --------------------------------- |
| Request body size (RDF uploads) | 10 MB                             |
| Local validator report size     | 10 MB                             |
| Catalogue download timeout      | 30 seconds                        |
| Catalogue `Accept-Language`     | `en-GB` unless overridden per run |
| PostgreSQL connection pool      | 10 connections                    |

## Startup checks

The service refuses to start when:

- `DISPATCHER_URL`, `DISPATCHER_API_KEY` or `POSTGRES_URL` is missing, or any
  value has the wrong format.
- `CONTROL_API_TOKEN` is set but shorter than 32 characters.
- `DATASET_CATALOGUE_RDF_URL` is missing.
- `OPERATION_MODE` validates, but there is no validator: `VALIDATION_MODE=shacl`
  without `METADATA_VALIDATOR_SHAPES_FILE`, or `itb` without
  `METADATA_VALIDATOR_URL`.
- `SYNC_ENABLED` is on and `SYNC_SCHEDULE` is not a five-field cron expression.
- `METADATA_SOURCES_JSON` is set.
- PostgreSQL is unreachable or a migration fails.
