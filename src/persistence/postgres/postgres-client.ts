// SPDX-FileCopyrightText: 2026 PNED G.I.E.
// SPDX-License-Identifier: Apache-2.0

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

export function createPostgresPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString, max: 10 });
}

export async function migrate(pool: pg.Pool, schema: string): Promise<void> {
  const migrationUrl = new URL("./migrations/", import.meta.url);
  const migrationPath = fileURLToPath(migrationUrl);
  const files = (await readdir(migrationPath))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
    );
    for (const file of files) {
      const applied = await client.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1) AS exists",
        [file],
      );
      if (applied.rows[0]?.exists) continue;
      await client.query(await readFile(`${migrationPath}/${file}`, "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
