import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.ts";

export type DB = LibSQLDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Every `lib/*.ts` function takes one of these instead of calling `getDb()` itself, so
 * which connection a query runs on — the top-level DB, or a transaction that must see it
 * — is visible and type-checked at the call site rather than implicit. */
export type Executor = DB | Tx;

let _db: DB | null = null;

export function getDb(): DB {
  if (!_db) {
    const client = createClient(resolveDbConfig());
    _db = drizzle(client, { schema });
  }
  return _db;
}

/**
 * `TURSO_DATABASE_URL` selects the target: unset defaults to a local embedded file (no
 * account, no network — `npm run dev` needs nothing beyond `npm install`); a
 * `libsql://...` URL plus `TURSO_AUTH_TOKEN` points at a real Turso database, which is
 * what makes data survive a Render deploy (Render's free tier has no persistent disk —
 * local files don't survive a redeploy either way, network storage does).
 */
export function resolveDbConfig(): { url: string; authToken?: string } {
  const url = process.env.TURSO_DATABASE_URL ?? "file:./data/grocery.db";

  if (url.startsWith("file:") && url !== "file::memory:") {
    // createClient does not create the parent directory for a local file target.
    mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
  }

  const authToken = process.env.TURSO_AUTH_TOKEN;
  return authToken ? { url, authToken } : { url };
}
