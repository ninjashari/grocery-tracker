import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import type { Executor } from "../db/connection.ts";
import { households, sessions, users } from "../db/schema.ts";
import { seedCategories } from "../db/seed.ts";
import { hashPassword, newSessionId, verifyPassword } from "../lib/password.ts";
import { asyncHandler, conflict, parseOrThrow, unauthorized } from "../lib/http.ts";
import {
  auth,
  clearSessionCookie,
  purgeExpiredSessions,
  requireAuth,
  SESSION_COOKIE,
  sessionExpiry,
  setSessionCookie,
} from "../middleware/auth.ts";
import { inviteSchema, loginSchema, signupSchema } from "../../shared/schemas.ts";
import type { User } from "../../shared/types.ts";

export const authRouter = Router();

async function emailTaken(executor: Executor, email: string): Promise<boolean> {
  const [row] = await executor.select({ id: users.id }).from(users).where(eq(users.email, email));
  return row !== undefined;
}

async function createSession(executor: Executor, userId: number): Promise<string> {
  const sessionId = newSessionId();
  await executor.insert(sessions).values({ id: sessionId, userId, expiresAt: sessionExpiry() });
  return sessionId;
}

/** Signup creates the household and its first member together, then seeds categories. */
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(signupSchema, req.body);
    const db = getDb();
    if (await emailTaken(db, input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);

    const user = await db.transaction(async (tx) => {
      const [household] = await tx.insert(households).values({ name: input.householdName }).returning({ id: households.id });

      await seedCategories(tx, household!.id);

      const [created] = await tx
        .insert(users)
        .values({ householdId: household!.id, email: input.email, passwordHash, name: input.name })
        .returning({ id: users.id });

      return {
        id: created!.id,
        email: input.email,
        name: input.name,
        householdId: household!.id,
        householdName: input.householdName,
      } satisfies User;
    });

    setSessionCookie(res, await createSession(db, user.id));
    await purgeExpiredSessions();
    res.status(201).json(user);
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);
    const db = getDb();

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        householdId: users.householdId,
        householdName: households.name,
      })
      .from(users)
      .innerJoin(households, eq(households.id, users.householdId))
      .where(eq(users.email, input.email));

    // Same message and roughly the same work either way, so the response doesn't
    // reveal whether an email is registered.
    const ok = row ? await verifyPassword(input.password, row.passwordHash) : false;
    if (!row || !ok) throw unauthorized("Email or password is incorrect");

    setSessionCookie(res, await createSession(db, row.id));
    await purgeExpiredSessions();
    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      householdId: row.householdId,
      householdName: row.householdName,
    } satisfies User);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (typeof sessionId === "string") {
      await getDb().delete(sessions).where(eq(sessions.id, sessionId));
    }
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get("/me", (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  const { userId, email, name, householdId, householdName } = req.auth;
  res.json({ id: userId, email, name, householdId, householdName } satisfies User);
});

/** Add another member to the caller's household. They share all data. */
authRouter.post(
  "/invite",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { householdId, householdName } = auth(req);
    const input = parseOrThrow(inviteSchema, req.body);
    const db = getDb();
    if (await emailTaken(db, input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);
    const [created] = await db
      .insert(users)
      .values({ householdId, email: input.email, passwordHash, name: input.name })
      .returning({ id: users.id });

    res.status(201).json({
      id: created!.id,
      email: input.email,
      name: input.name,
      householdId,
      householdName,
    } satisfies User);
  }),
);

authRouter.get(
  "/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const members = await getDb()
      .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.householdId, householdId))
      .orderBy(users.id);
    res.json(members);
  }),
);
