import { connectDb } from "./connection.ts";
import { Household, User, Session, Category, Item, Bill } from "./models/index.ts";

/**
 * Mongo/Mongoose needs no schema migration (no CREATE TABLE/CREATE INDEX DDL to run), but
 * the Render build still needs a DB-readiness step, so this replaces the old Drizzle
 * `db:push` script. `syncIndexes()` creates whatever's declared on the model and missing,
 * and drops whatever's no longer declared — unlike the old script, it's safe to run on
 * every deploy. (The npm script is still named `db:push` to avoid touching render.yaml's
 * buildCommand — only its implementation changed.)
 */
export async function ensureIndexes(): Promise<void> {
  for (const model of [Household, User, Session, Category, Item, Bill]) {
    const result = await model.syncIndexes();
    console.log(`${model.modelName}: synced indexes`, result);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  await connectDb();
  await ensureIndexes();
  console.log("Indexes ensured.");
  process.exit(0);
}
