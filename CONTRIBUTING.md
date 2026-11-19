<!-- SPDX-FileCopyrightText: 2026 PNED G.I.E. -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# Contributing

## Before opening a pull request

- Open an issue for substantial changes so the approach can be discussed.
- Keep changes focused and include tests for behavior changes.
- Run `npm ci` and `npm run validate` locally. The project requires Node.js 24
  and PostgreSQL for running the service; most tests use isolated fixtures.
- Do not commit `.env`, credentials, database dumps, generated `dist/` files, or
  generated Release 8 TriG bundles.
- Preserve upstream notices and license terms when changing bundled materials.

## Pull requests

Open pull requests against `main`. Describe the user-visible change, relevant
configuration or migration impact, and how it was checked. Link related issues
and call out any security or licensing implications. The GitHub Actions
validation workflow must pass before merge.

## Licensing

By submitting a contribution, you agree that it is provided under the license
identified for the affected files. Original source code uses Apache-2.0;
documentation uses CC-BY-4.0. Keep SPDX headers and third-party attributions
accurate. Do not submit material whose license or provenance is unclear.
