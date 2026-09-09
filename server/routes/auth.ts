import { Router } from "express";
import { getDb, transaction } from "../db/connection.ts";
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

function emailTaken(email: string): boolean {
  return getDb().prepare("SELECT 1 FROM users WHERE email = ?").get(email) !== undefined;
}

function createSession(userId: number): string {
  const sessionId = newSessionId();
  getDb()
    .prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sessionId, userId, sessionExpiry());
  return sessionId;
}

/** Signup creates the household and its first member together, then seeds categories. */
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(signupSchema, req.body);
    if (emailTaken(input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);
    const db = getDb();

    const user = transaction(db, () => {
      const household = db
        .prepare("INSERT INTO households (name) VALUES (?) RETURNING id")
        .get(input.householdName) as { id: number };

      seedCategories(db, household.id);

      const created = db
        .prepare(
          "INSERT INTO users (household_id, email, password_hash, name) VALUES (?, ?, ?, ?) RETURNING id",
        )
        .get(household.id, input.email, passwordHash, input.name) as { id: number };

      return {
        id: created.id,
        email: input.email,
        name: input.name,
        householdId: household.id,
        householdName: input.householdName,
      } satisfies User;
    });

    setSessionCookie(res, createSession(user.id));
    purgeExpiredSessions();
    res.status(201).json(user);
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);

    const row = getDb()
      .prepare(
        `SELECT u.id, u.email, u.name, u.password_hash AS passwordHash,
                u.household_id AS householdId, h.name AS householdName
           FROM users u
           JOIN households h ON h.id = u.household_id
          WHERE u.email = ?`,
      )
      .get(input.email) as
      | { id: number; email: string; name: string; passwordHash: string; householdId: number; householdName: string }
      | undefined;

    // Same message and roughly the same work either way, so the response doesn't
    // reveal whether an email is registered.
    const ok = row ? await verifyPassword(input.password, row.passwordHash) : false;
    if (!row || !ok) throw unauthorized("Email or password is incorrect");

    setSessionCookie(res, createSession(row.id));
    purgeExpiredSessions();
    res.json({
      id: row.id,
      email: row.email,
      name: row.name,
      householdId: row.householdId,
      householdName: row.householdName,
    } satisfies User);
  }),
);

authRouter.post("/logout", (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof sessionId === "string") {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

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
    if (emailTaken(input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);
    const created = getDb()
      .prepare("INSERT INTO users (household_id, email, password_hash, name) VALUES (?, ?, ?, ?) RETURNING id")
      .get(householdId, input.email, passwordHash, input.name) as { id: number };

    res.status(201).json({
      id: created.id,
      email: input.email,
      name: input.name,
      householdId,
      householdName,
    } satisfies User);
  }),
);

authRouter.get("/members", requireAuth, (req, res) => {
  const { householdId } = auth(req);
  const members = getDb()
    .prepare("SELECT id, email, name, created_at AS createdAt FROM users WHERE household_id = ? ORDER BY id")
    .all(householdId);
  res.json(members);
});
