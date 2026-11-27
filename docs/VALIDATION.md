<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Metadata validation

The service can check each dataset's metadata against SHACL rules before (or
instead of) sending it to the National Dispatcher. Two independent settings
control this:

- `OPERATION_MODE` decides **whether** a run validates.
- `VALIDATION_MODE` decides **where** validation runs: `shacl` runs the bundled
  pySHACL engine locally, and `itb` calls an external ITB validator API.

The service runs the rules it is given. It does not certify compliance by
itself, and a successful delivery never implies compliance. Every setting named
here is listed in [CONFIGURATION.md](CONFIGURATION.md#metadata-validation).

## When validation runs

| `OPERATION_MODE`      | What happens                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync_only` (default) | No validation. The dispatcher's own RDF validation is also turned off (`disableValidation=true`).                                                                         |
| `validate_and_sync`   | Each dataset is validated before it is created or updated. A dataset that fails, or whose validation errors, is skipped and counted as failed. Deletes always go through. |
| `validate_only`       | Each dataset is validated and the report is stored. Nothing is sent to the dispatcher and delivery state is not touched.                                                  |

Any mode other than `sync_only` needs a working validator; without one the
service does not start. One run can use a different mode or validator through
the request body (see [per-run selection](#per-run-validator-selection)).

A validation-only run of the whole catalogue, or of one dataset:

```bash
curl -X POST -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  'http://localhost:8080/api/v1/sync?mode=validate_only'
curl -X POST -H "Authorization: Bearer $CONTROL_API_TOKEN" \
  'http://localhost:8080/api/v1/sync/dataset/https%3A%2F%2Fcatalogue.example%2Fdataset%2F1?mode=validate_only'
```

## Pass and fail

A dataset **passes** when its structured findings contain only `Warning` or
`Info` results. Warnings stay visible in the report but do not block delivery
or count as failures.

A dataset **fails** on any `Violation`, a finding with a missing or unknown
severity, a negative verdict without structured findings, a parser error, or a
validator failure. A validator failure is reported as an error, never as a
verdict on the metadata.

Each report keeps two verdicts: `conforms` is the outcome under these rules, and
`validatorConforms` is the engine's own strict SHACL verdict. The original
report text is kept alongside the structured findings.

## Local SHACL validation

`VALIDATION_MODE=shacl` runs a pySHACL worker inside the service. It needs no
separate server or container. Install the Python dependencies from the project
directory:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r validator/requirements.txt
```

Then point the service at a trusted, self-contained SHACL rules file:

```dotenv
OPERATION_MODE=validate_and_sync
VALIDATION_MODE=shacl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
METADATA_VALIDATOR_SHAPES_FILE=/absolute/path/to/approved-shapes.ttl
```

The worker reads the dataset's RDF/XML from stdin and returns the verdict,
report text and structured findings. Each validation has a timeout
(`METADATA_VALIDATOR_TIMEOUT_MS`) and a report size limit. Rule imports and
JavaScript extensions are disabled, so the file must contain every rule it
needs.

`validator/example-shapes.ttl` only checks for a title. It is for smoke tests
and is not Release 8 validation; no production rules are enabled by default.

**Docker:** the image includes the engine and `validator/`. Mount your rules
into the container, set their container path in
`METADATA_VALIDATOR_SHAPES_FILE`, and leave `METADATA_VALIDATOR_PYTHON` unset so
the image's `/opt/validator/bin/python` is used.

## Offline Release 8 rules

[`validator/release-8`](../validator/release-8/README.md) contains the official
HealthDCAT-AP Release 8 resources and a builder that turns them into one bundle
per access level (`public`, `non-public`, `restricted`). Build and test the
bundles with:

```bash
npm run test:release8
```

Use them with an `{accessLevel}` placeholder, which picks the bundle for each
dataset from its `dct:accessRights`:

```dotenv
VALIDATION_MODE=shacl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
METADATA_VALIDATOR_SHAPES_FILE=validator/release-8/{accessLevel}.trig
```

The bundles apply one documented local correction to the upstream rules and are
for development and testing. Read the limitations in the
[Release 8 README](../validator/release-8/README.md) before relying on them.

## ITB validator API

`VALIDATION_MODE=itb` sends each dataset to an external ITB validator, such as
the HealthData@EU API:

```dotenv
VALIDATION_MODE=itb
METADATA_VALIDATOR_URL=https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/ehds/api/validate
METADATA_VALIDATOR_VALIDATION_TYPE=auto
METADATA_VALIDATOR_TIMEOUT_MS=120000
```

The service posts JSON containing the unchanged RDF/XML
(`embeddingMethod=STRING`, `contentSyntax=application/rdf+xml`), the access-level
`validationType`, and `reportSyntax=application/ld+json`. Success is read from
the SHACL `ValidationReport` verdict, not from the HTTP status. Base64-encoded
JSON-LD reports are supported. A timeout, HTTP error, invalid response or
missing verdict is a validation error, never a pass, and there is no fallback to
local validation.

Only metadata is sent to the validator: no dataset files, dispatcher key or
control token. API reference:
<https://health-data-itb-rdf-validator.data.health.europa.eu/shacl/swagger-ui/index.html>.

## Access level

`METADATA_VALIDATOR_VALIDATION_TYPE` (and the `{accessLevel}` placeholder) decide
which access-level rules apply:

- `auto` (default) reads the dataset's `dct:accessRights` IRI. Missing, unknown
  or ambiguous access rights are a validation error rather than a guess.
- `public`, `non-public` or `restricted` apply that level's rules to every
  dataset, for example to check metadata that lacks access rights against the
  intended rules.

## Rule versions and profiles

`VALIDATION_VERSION` selects a ruleset by replacing `{version}` in the shapes
path (`shacl`) or the API URL (`itb`). When it is set, the path or URL must
contain `{version}`, so that changing the version selects different rules
rather than only relabelling reports. Leave it unset for a fixed file or
endpoint. For `itb`, use it only with a deployment whose URLs actually contain a
version.

```dotenv
VALIDATION_VERSION=release-8
METADATA_VALIDATOR_SHAPES_FILE=validator/shapes/{version}/shapes.ttl
```

Every report records a **profile** that identifies the rules used:

| Validator               | Profile when `METADATA_VALIDATOR_PROFILE` is unset |
| ----------------------- | -------------------------------------------------- |
| `shacl`                 | `local-shacl:sha256:<hash of the rules file>`      |
| `itb` with a version    | `health-dcat-ap:<version>`                         |
| `itb` without a version | `itb-endpoint:sha256:<hash of the endpoint URL>`   |

An endpoint hash identifies the endpoint, not the ruleset it runs. Set
`METADATA_VALIDATOR_PROFILE` only to name a ruleset you have verified, for
example after confirming an API's deployed rules with its owner.

## Per-run validator selection

`POST /api/v1/sync` and `POST /api/v1/sync/dataset/:datasetId` accept a JSON
body that changes the validation of that run only:

| `validator`            | Uses                                                          |
| ---------------------- | ------------------------------------------------------------- |
| `configured` (default) | The configured `VALIDATION_MODE` and its settings.            |
| `local-shacl`          | The configured shapes file and Python runtime.                |
| `release8-local`       | The offline bundles `validator/release-8/{accessLevel}.trig`. |
| `ehds-api`             | `METADATA_VALIDATOR_URL` with the ITB protocol.               |

`validationVersion` and `validationType` can also be set per run;
`release8-local` accepts only `release-8`. A validator other than `configured`
generates its own profile. A missing local bundle or unconfigured endpoint is
rejected with `400` before a run is created, as are validation options combined
with `sync_only`. URLs, file paths, profiles and limits can never be set per
request.

The run stores the resolved settings, and each report keeps the access level and
profile actually used.

## Release 8 assessment on the dashboard

The dashboard shows a Release 8 assessment separately from the delivery status.
It is **Not assessed** until `RELEASE8_VALIDATION_PROFILE` is set to the exact
profile of a validator that applies the complete, agreed Release 8 rules
(baseline, access-level rules and dependencies). Include a ruleset version or
hash in that profile, and never use the title-only example rules.

Each report stores the SHA-256 of the RDF it checked. A dataset shows **passed**
or **failed** only when:

- the report's profile exactly matches `RELEASE8_VALIDATION_PROFILE`, and
- the report's checksum matches the RDF that was delivered.

If the metadata has changed since it was checked, the assessment shows as
**outdated**. A validator error shows as an error, not as a verdict. To record
assessments, run a validation sync, for example with `?mode=validate_only`.

## Reading results

- **Run reports:** `GET /api/v1/sync/:runId` returns each dataset's verdict,
  findings, profile, access level and checksum. Validation-only results appear
  in the run history even for datasets that were never delivered.
- **Dashboard:** **View dataset** shows the Release 8 assessment and the latest
  validation findings as a table (severity, field, message, node and value),
  with the original report in a collapsed section. **View run** groups a run's
  reports by dataset. Opening details never revalidates or sends metadata
  anywhere.
