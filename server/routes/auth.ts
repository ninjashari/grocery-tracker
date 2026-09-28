import { Router } from "express";
import { Types, type ClientSession } from "mongoose";
import { withTransaction } from "../db/connection.ts";
import { Household, Session, User } from "../db/models/index.ts";
import { seedCategories } from "../db/seed.ts";
import { hashPassword, newSessionId, verifyPassword } from "../lib/password.ts";
import { asyncHandler, conflict, parseOrThrow, unauthorized } from "../lib/http.ts";
import {
  auth,
  clearSessionCookie,
  requireAuth,
  SESSION_COOKIE,
  sessionExpiry,
  setSessionCookie,
} from "../middleware/auth.ts";
import { inviteSchema, loginSchema, signupSchema } from "../../shared/schemas.ts";
import type { User as UserShape } from "../../shared/types.ts";

export const authRouter = Router();

async function emailTaken(email: string): Promise<boolean> {
  return User.exists({ email }).then(Boolean);
}

async function createSession(userId: string): Promise<string> {
  const sessionId = newSessionId();
  await Session.create({ _id: sessionId, userId, expiresAt: sessionExpiry() });
  return sessionId;
}

/** Signup creates the household and its first member together, then seeds categories. */
authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(signupSchema, req.body);
    if (await emailTaken(input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);

    const user = await withTransaction(async (session: ClientSession) => {
      const [household] = await Household.create([{ name: input.householdName }], { session });
      await seedCategories(household!._id, session);

      const [created] = await User.create(
        [{ householdId: household!._id, email: input.email, passwordHash, name: input.name }],
        { session },
      );

      return {
        id: created!._id.toString(),
        email: input.email,
        name: input.name,
        householdId: household!._id.toString(),
        householdName: input.householdName,
      } satisfies UserShape;
    });

    setSessionCookie(res, await createSession(user.id));
    res.status(201).json(user);
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(loginSchema, req.body);

    const row = await User.findOne({ email: input.email }).populate<{
      householdId: { _id: Types.ObjectId; name: string };
    }>("householdId", "name");

    // Same message and roughly the same work either way, so the response doesn't
    // reveal whether an email is registered.
    const ok = row ? await verifyPassword(input.password, row.passwordHash) : false;
    if (!row || !ok) throw unauthorized("Email or password is incorrect");

    setSessionCookie(res, await createSession(row._id.toString()));
    res.json({
      id: row._id.toString(),
      email: row.email,
      name: row.name,
      householdId: row.householdId._id.toString(),
      householdName: row.householdId.name,
    } satisfies UserShape);
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (typeof sessionId === "string") {
      await Session.deleteOne({ _id: sessionId });
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
  res.json({ id: userId, email, name, householdId, householdName } satisfies UserShape);
});

/** Add another member to the caller's household. They share all data. */
authRouter.post(
  "/invite",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { householdId, householdName } = auth(req);
    const input = parseOrThrow(inviteSchema, req.body);
    if (await emailTaken(input.email)) throw conflict("That email is already registered");

    const passwordHash = await hashPassword(input.password);
    const created = await User.create({ householdId, email: input.email, passwordHash, name: input.name });

    res.status(201).json({
      id: created._id.toString(),
      email: input.email,
      name: input.name,
      householdId,
      householdName,
    } satisfies UserShape);
  }),
);

authRouter.get(
  "/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const members = await User.find({ householdId }).sort({ _id: 1 }).select("email name createdAt");
    res.json(
      members.map((member) => ({
        id: member._id.toString(),
        email: member.email,
        name: member.name,
        createdAt: member.createdAt,
      })),
    );
  }),
);
