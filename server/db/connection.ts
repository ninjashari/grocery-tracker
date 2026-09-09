import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "migrations");

export type Db = DatabaseSync;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) db = openDb(resolveDbPath());
  return db;
}

export function resolveDbPath(): string {
  if (process.env.DB_PATH) return resolve(process.env.DB_PATH);
  const dataDir = resolve(process.env.DATA_DIR ?? "./data");
  mkdirSync(dataDir, { recursive: true });
  return join(dataDir, "grocery.db");
}

export function openDb(path: string): Db {
  const connection = new DatabaseSync(path);
  // WAL keeps reads from blocking the write that bill entry does on save.
  if (path !== ":memory:") connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA busy_timeout = 5000");
  migrate(connection);
  return connection;
}

/**
 * Applies every unapplied .sql file in migrations/, in filename order, each in its own
 * transaction. Filenames are the migration identity, so never rename an applied one.
 */
export function migrate(connection: Db): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    connection.prepare("SELECT name FROM schema_migrations").all().map((row) => row["name"] as string),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    connection.exec("BEGIN");
    try {
      connection.exec(sql);
      connection.prepare("INSERT INTO schema_migrations(name) VALUES (?)").run(file);
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }
}

/**
 * Runs `fn` in a transaction, rolling back if it throws.
 *
 * Bill save writes a header plus N lines plus possibly new items; a partial write there
 * would leave a bill that doesn't match its receipt, so it is all-or-nothing.
 */
export function transaction<T>(connection: Db, fn: () => T): T {
  connection.exec("BEGIN");
  try {
    const result = fn();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      connection.exec("ROLLBACK");
    } catch {
      // The transaction was already rolled back by SQLite; surface the original error.
    }
    throw error;
  }
}
