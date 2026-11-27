# Offline Release 8 development profile

Source: [European Commission HealthDCAT-AP Release 8](https://data.health.europa.eu/healthdcat-ap/releases/release-8/).
Copyright European Union; CC-BY-4.0. Original resources, source URLs and checksums
are preserved in `upstream/manifest.json`. `upstream/VALIDATION-STATUS.md`
describes why the unmodified upstream bundle fails under pySHACL, which the
correction below addresses.

Build from the project root with the pinned Python environment:

```sh
.venv/bin/python validator/build_release8.py
npm run test:release8
```

The builder verifies all upstream checksums, follows the access-level file lists
and import mappings in the official `config.properties`, and refuses unknown
imports. It adds explicit aliases for nested Dublin Core and PROV imports and the
missing SKOS ontology. `skos.rdf` was downloaded from
https://www.w3.org/2009/08/skos-reference/skos.rdf (W3C); its SHA-256 is pinned in
the builder. The configured EUVOC exclusion remains in effect. No runtime network
access is required. Generated TriG files are ignored by Git; build them before
starting the application or building its Docker image.

Each file contains separate shapes and dependency graphs. The worker adds the
preloaded ontology/vocabulary triples to the submitted data, and validates with
imports, inference, JavaScript and SHACL advanced features disabled. This can
produce findings on resources from the preloaded ontologies as well as submitted
metadata; the focus node identifies the resource concerned.

There is exactly one intentional correction in each access-level shapes file:
the Dataset shape links a pathless `sh:or` constraint through `sh:property`.
The builder changes that link to `sh:node`, applying the existing alternatives to
the dataset focus node. All alternatives and messages remain intact. The upstream
files are untouched. This is a local adapted ruleset, not an approved upstream fix.
The resulting file's SHA-256 identifies both the rules and dependencies; never
reuse the original upstream bundle profile for it. Rebuilding may change blank
node identifiers and therefore the serialized file hash.

Example for a catalogue containing mixed access levels:

```dotenv
OPERATION_MODE=validate_only
VALIDATION_MODE=shacl
METADATA_VALIDATOR_PYTHON=.venv/bin/python
METADATA_VALIDATOR_SHAPES_FILE=validator/release-8/{accessLevel}.trig
METADATA_VALIDATOR_PROFILE=
RELEASE8_VALIDATION_PROFILE=
```

The `{accessLevel}` placeholder selects `public.trig`, `non-public.trig`, or
`restricted.trig` using each dataset's `dct:accessRights`, with the same selection
logic as API mode. Keep `METADATA_VALIDATOR_VALIDATION_TYPE=auto` (the default).
Missing or ambiguous access rights fail selection. An explicit validation type
selects that level instead. A fixed file path still applies one bundle to every
dataset; use it only when that is intentional.

Regression tests exercise all three bundles with a synthetic complete fixture,
then remove titles and introduce invalid access rights, controlled vocabulary
values and structured-data declarations. Warnings remain visible and follow the
service's [severity policy](../../docs/VALIDATION.md#pass-and-fail). Structured findings use report-level
`sh:result` entries. Nested `sh:detail` diagnostics remain in the text report;
a diagnostic Violation underneath a Warning does not independently block a
dataset. These fixtures are engineering regressions,
not independently reviewed conformance examples. Keep the Release 8 dashboard
profile unset until the local correction and fixtures have been reviewed and
results compared with the agreed API deployment. Local/API equivalence and full
specification compliance have not been established by these tests.
