<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# National Dispatcher Integration Service

Keeps the National Dispatcher in step with a dataset catalogue. The service
downloads one catalogue RDF (`DATASET_CATALOGUE_RDF_URL`), works out which
datasets are new, changed or removed, and sends the matching create, update or
delete to the National Dispatcher. It then follows each message through Domibus
to the Central Platform and records every step in PostgreSQL, so a dataset is
never sent twice and a crash or timeout loses nothing.

The service handles **metadata only**. It never transfers dataset files and does
not replace dispatcher or Central Platform behaviour. Metadata can optionally be
validated against SHACL rules before it is sent.

| Document                                       | Contents                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | Components, sync flow, delivery lifecycle, API and stored data.  |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable, per-run options and startup checks.  |
| [docs/VALIDATION.md](docs/VALIDATION.md)       | Metadata validation: local SHACL, the ITB API and Release 8.     |
| [bruno/README.md](bruno/README.md)             | Bruno requests for trying the service against a real dispatcher. |

## Quick start

Requirements: Node.js 24 and PostgreSQL. Local SHACL validation also needs
Python 3.11+.

```bash
cp .env.example .env    # then set the values below
npm ci
npm run dev
```

Set at least:

```dotenv
DISPATCHER_URL=https://dispatcher.example.org
DISPATCHER_API_KEY=<dispatcher key>
POSTGRES_URL=postgresql://dataset_delivery:change-me@localhost:5432/dataset_delivery
DATASET_CATALOGUE_RDF_URL=https://catalogue.portal.gdi.lu/catalog.rdf
CONTROL_API_TOKEN=<output of: openssl rand -hex 32>
```

With these settings the service delivers catalogue changes every 15 minutes,
without validation. Open <http://localhost:8080/> for the dashboard.

To run the service and PostgreSQL in containers instead:

```bash
docker compose up --build
```

On startup the service creates its PostgreSQL schema (`POSTGRES_SCHEMA`) and
applies any pending migrations. Compose points the service at its bundled
`postgres` container; set `COMPOSE_POSTGRES_URL` to use a different database.

`npm run dev` restarts the service when `.env`, `src/` or `validator/` change,
and reloads `.env` on each restart. `npm run build && npm start` runs the
compiled service without watching.

Each deployment should have its own PostgreSQL database or schema, with a
database user that can access only that schema.

## Running a sync

Syncs run on the `SYNC_SCHEDULE` cron schedule while `SYNC_ENABLED=true`. An
operator can also start one through the API. Requests that change anything need
the control token:

```bash
set -a; source .env; set +a

# Full sync: every catalogue dataset, including deletions
curl -X POST -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  http://localhost:8080/api/v1/sync

# One dataset: its ID is the full dataset URI, URL-encoded (no deletions)
curl -X POST -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  http://localhost:8080/api/v1/sync/dataset/https%3A%2F%2Fcatalogue.example%2Fdataset%2F1

# Run status, counters and per-dataset reports
curl http://localhost:8080/api/v1/sync/<runId>
```

A sync request returns `202` with the run ID, its `mode` and `status`, and the
run continues in the background. Only one run can be active; a second request
gets `409`.

A run's `status` is `queued`, `running`, `completed` or `failed`. `completed`
means processing finished, but individual datasets can still have failed: check
`datasetsFailed` and `reports`. Datasets whose Domibus message is still on its
way when tracking stops are counted in `datasetsInFlight`, and the next run
picks them up.

### Operation modes

`OPERATION_MODE` decides what a run does:

| Mode                  | Validates | Sends to the dispatcher                  |
| --------------------- | --------- | ---------------------------------------- |
| `sync_only` (default) | No        | Every new, changed or removed dataset.   |
| `validate_and_sync`   | Yes       | Only datasets that pass; deletes always. |
| `validate_only`       | Yes       | Nothing; reports are stored.             |

A single run can use other settings through a JSON body, without changing the
configured defaults:

```bash
curl -X POST http://localhost:8080/api/v1/sync \
  -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"operationMode":"validate_only","validator":"release8-local"}'
```

`?mode=validate_only` is a shortcut for `{"operationMode":"validate_only"}`. All
per-run fields are listed in
[CONFIGURATION.md](docs/CONFIGURATION.md#per-run-options).

## Monitoring

The dashboard at <http://localhost:8080/> refreshes every five seconds and shows:

- **Sync health:** time since the last completed sync (flagged when it is more
  than two schedule intervals overdue), whether a sync is running, when the next
  one is due, and how many messages are waiting on Domibus.
- **Delivery counts**, grouped as delivered, in progress and needs attention.
  The groups always add up to the total.
- **Needs attention:** failed, uncertain and Domibus-stopped deliveries with
  their last error and what to do next, uncertain ones first.
- **Dataset deliveries and sync history**, with a status filter and paging.
  **View dataset** opens its identifiers, retries, Release 8 assessment and
  validation findings; **View run** groups a run's reports by dataset.

The dashboard only reads stored state: it has no controls, and it never calls
the catalogue, the dispatcher or a validator. The same data is available as
JSON:

```bash
# Everything behind the dashboard (optional: status, stateOffset, runOffset)
curl http://localhost:8080/api/v1/monitoring

# One dataset's delivery state; 404 if nothing is recorded for it
curl http://localhost:8080/api/v1/datasets/https%3A%2F%2Fcatalogue.example%2Fdataset%2F1/status
```

`GET /health` reports that the process is up, and `GET /ready` that PostgreSQL
is reachable.

## Access control

- Every request other than a GET needs `Authorization: Bearer <CONTROL_API_TOKEN>`.
  A missing or wrong token gets `401`. If no token is configured, these requests
  get `503`, and syncs run only on the schedule.
- Use a random token of at least 32 characters and keep it in the server's
  `.env`, out of browser code, URLs and shared collections. It is separate from
  the dispatcher API key and is redacted from request logs.
- GET endpoints, including the dashboard, need no token. Put the service behind
  your normal access boundary if delivery status should not be public.
- The dispatcher API key is read only from server configuration and is sent
  only to the dispatcher.

## Validation

Validation is optional and off in the default `sync_only` mode.
`VALIDATION_MODE` chooses where it runs:

- `shacl` (default) runs the bundled pySHACL engine in a local Python process
  against SHACL rules you provide.
- `itb` calls an external ITB validator, such as the HealthData@EU API.

A dataset passes when its findings are only `Warning` or `Info`. Passing
validation does not mean a dataset was delivered, and a delivery does not mean
the metadata is compliant. The dashboard shows a Release 8 assessment only for
a configured, verified ruleset.

Setup, the offline Release 8 rules and the dashboard assessment are described in
[docs/VALIDATION.md](docs/VALIDATION.md).

## Development

```bash
npm run validate        # format check, lint, type-check and tests
npm test                # tests only
npm run test:release8   # build the offline Release 8 rules and test them
```

Most tests use fixtures and need no database or dispatcher. `test:release8` needs
the Python environment from
[docs/VALIDATION.md](docs/VALIDATION.md#local-shacl-validation).

The [`bruno`](bruno/) collection contains requests for the health checks, syncs,
run status and dataset status; see its [README](bruno/README.md). Contribution
guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Application source code is licensed under Apache-2.0 and documentation under
CC-BY-4.0. Bundled third-party validator resources keep their own licenses and
attribution. See [`LICENSES/README.md`](LICENSES/README.md) and the notices under
`validator/release-8/`.
