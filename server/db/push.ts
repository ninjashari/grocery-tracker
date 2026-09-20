import { pushSQLiteSchema } from "drizzle-kit/api";
import { getDb, resolveDbConfig } from "./connection.ts";
import * as schema from "./schema.ts";

/**
 * `drizzle-kit push` (the CLI) was found to silently fail to persist any writes against a
 * local file: URL in this environment — it prints "Changes applied" but the file is left
 * empty. The underlying `pushSQLiteSchema` API it's built on does not have this problem
 * (also what tests/api.test.ts uses against an in-memory database), so this script calls
 * it directly instead of shelling out to the CLI.
 */
const { apply } = await pushSQLiteSchema(schema, getDb());
await apply();
console.log(`Schema pushed to ${resolveDbConfig().url}`);
