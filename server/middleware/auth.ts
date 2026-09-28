import type { NextFunction, Request, Response } from "express";
import { Session } from "../db/models/index.ts";
import { unauthorized } from "../lib/http.ts";

export const SESSION_COOKIE = "gt_session";
export const SESSION_DAYS = 30;

/**
 * The authenticated caller. `householdId` comes from here and only from here — no route
 * may take it from a body or query param, or one household could read another's data.
 */
export type AuthContext = {
  userId: string;
  householdId: string;
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

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
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

  const session = await Session.findById(sessionId).populate({
    path: "userId",
    populate: { path: "householdId" },
  });

  if (!session) {
    next();
    return;
  }

  // A TTL index prunes expired sessions server-side, but that sweep runs on Mongo's
  // background thread on a ~60s cadence, not instantaneously — this in-request check is a
  // belt-and-suspenders guard for the gap.
  if (session.expiresAt.getTime() <= Date.now()) {
    await Session.deleteOne({ _id: sessionId });
    next();
    return;
  }

  const user = session.userId as unknown as {
    _id: { toString(): string };
    email: string;
    name: string;
    householdId: { _id: { toString(): string }; name: string };
  };
  if (!user || !user.householdId) {
    next();
    return;
  }

  req.auth = {
    userId: user._id.toString(),
    householdId: user.householdId._id.toString(),
    email: user.email,
    name: user.name,
    householdName: user.householdId.name,
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
