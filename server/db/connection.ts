import mongoose, { type ClientSession } from "mongoose";

/**
 * `MONGODB_URI` selects the target. There's no local zero-setup fallback the way the old
 * SQLite file DB had — Atlas's free tier is also zero-cost, so both local dev and
 * production point at a real Atlas cluster (different databases: see README/.env.example).
 */
function resolveMongoUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  return uri;
}

let connectPromise: Promise<typeof mongoose> | null = null;

/** Lazy singleton, memoized on the connection promise itself so concurrent early callers
 * (e.g. the health check racing route middleware at boot) share one connection attempt. */
export function connectDb(): Promise<typeof mongoose> {
  if (!connectPromise) {
    connectPromise = mongoose.connect(resolveMongoUri());
  }
  return connectPromise;
}

export async function disconnectDb(): Promise<void> {
  if (connectPromise) {
    await mongoose.disconnect();
    connectPromise = null;
  }
}

/** Wraps a Mongo multi-document transaction. Needed wherever a write touches more than
 * one collection and must be all-or-nothing (e.g. resolving/creating an item before
 * referencing it on a bill, or creating a household + its seeded categories + its first
 * user together). Requires a replica set, which Atlas's free tier already is. */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
