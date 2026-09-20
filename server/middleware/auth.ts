import type { NextFunction, Request, Response } from "express";
import { eq, lte } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import { households, sessions, users } from "../db/schema.ts";
import { unauthorized } from "../lib/http.ts";

export const SESSION_COOKIE = "gt_session";
export const SESSION_DAYS = 30;

/**
 * The authenticated caller. `householdId` comes from here and only from here — no route
 * may take it from a body or query param, or one household could read another's data.
 */
export type AuthContext = {
  userId: number;
  householdId: number;
  email: string;
  name: string;
  householdName: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function sessionExpiry(): string {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Resolves the session cookie to an AuthContext, or leaves req.auth undefined. Registered
 * as global middleware (see server/index.ts) — Express 5 forwards a rejected promise from
 * an async middleware to the error handler automatically, so no explicit try/catch here.
 */
export async function loadAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    next();
    return;
  }

  const db = getDb();
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      householdId: users.householdId,
      householdName: households.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(households, eq(households.id, users.householdId))
    .where(eq(sessions.id, sessionId));

  if (!row) {
    next();
    return;
  }

  if (Date.parse(row.expiresAt) <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    next();
    return;
  }

  req.auth = {
    userId: row.userId,
    householdId: row.householdId,
    email: row.email,
    name: row.name,
    householdName: row.householdName,
  };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized());
    return;
  }
  next();
}

/** For use inside handlers mounted behind requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Opportunistic cleanup so the sessions table doesn't grow without bound. */
export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lte(sessions.expiresAt, new Date().toISOString()));
}
