import { sql } from "drizzle-orm";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { getDb, resolveDbConfig } from "./connection.ts";
import * as schema from "./schema.ts";

const db = getDb();

/**
 * `pushSQLiteSchema`'s diff engine is unreliable against a database that's already been
 * pushed to once: re-running it doesn't detect "no changes needed" — it decides every
 * table needs a full rebuild and emits duplicate CREATE INDEX statements for indexes that
 * still exist from the first push, which crashes (confirmed by reproducing it locally:
 * running this script twice in a row against the same file fails identically to the
 * Render build log). Since this app's schema changes rarely, the reliable fix is to push
 * only once: skip entirely if the schema is already there. Run `npm run db:push` by hand
 * (locally, pointed at the production TURSO_DATABASE_URL/TURSO_AUTH_TOKEN) on the rare
 * occasion the schema actually changes.
 */
const existing = await db.all<{ name: string }>(
  sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'households'`,
);

if (existing.length > 0) {
  console.log(`Schema already present at ${resolveDbConfig().url}, skipping push.`);
} else {
  const { apply } = await pushSQLiteSchema(schema, db);
  await apply();
  console.log(`Schema pushed to ${resolveDbConfig().url}`);
}
