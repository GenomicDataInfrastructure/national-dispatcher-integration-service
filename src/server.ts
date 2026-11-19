// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { buildApp } from "./app.js";
import { loadConfig } from "./config/config.js";
import {
  createPostgresPool,
  migrate,
} from "./persistence/postgres/postgres-client.js";
import { SyncStateRepository } from "./persistence/postgres/sync-state-repository.js";
import { SyncRunRepository } from "./persistence/postgres/sync-run-repository.js";

const config = loadConfig();
const pool = createPostgresPool(config.postgresUrl);
await migrate(pool, config.postgresSchema);
const app = await buildApp(
  config,
  new SyncStateRepository(pool, config.postgresSchema),
  fetch,
  new SyncRunRepository(pool, config.postgresSchema),
);
app.addHook("onClose", async () => pool.end());
await app.listen({ port: config.port, host: config.host });
