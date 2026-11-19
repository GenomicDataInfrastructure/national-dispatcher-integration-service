// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { cp, mkdir } from "node:fs/promises";
import { URL } from "node:url";

const target = new URL(
  "../dist/src/persistence/postgres/migrations/",
  import.meta.url,
);
await mkdir(target, { recursive: true });
await cp(
  new URL("../src/persistence/postgres/migrations/", import.meta.url),
  target,
  {
    recursive: true,
  },
);
await cp(
  new URL("../src/api/dashboard.html", import.meta.url),
  new URL("../dist/src/api/dashboard.html", import.meta.url),
);
await cp(
  new URL("../src/api/dashboard.css", import.meta.url),
  new URL("../dist/src/api/dashboard.css", import.meta.url),
);
await cp(
  new URL("../src/api/dashboard.js", import.meta.url),
  new URL("../dist/src/api/dashboard.js", import.meta.url),
);
