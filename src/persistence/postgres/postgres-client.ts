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
    for (const file of files) {
      await client.query(await readFile(`${migrationPath}/${file}`, "utf8"));
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
