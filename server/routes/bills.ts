import { Router } from "express";
import { getDb } from "../db/connection.ts";
import { asyncHandler, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { deleteBill, listBills, requireBill, saveBill } from "../lib/bills.ts";
import { billInputSchema, billQuerySchema } from "../../shared/schemas.ts";

export const billsRouter = Router();

billsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(billQuerySchema, req.query);
    res.json(await listBills(getDb(), householdId, query));
  }),
);

billsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await requireBill(getDb(), auth(req).householdId, Number(req.params.id)));
  }),
);

billsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId, userId } = auth(req);
    const input = parseOrThrow(billInputSchema, req.body);
    res.status(201).json(await saveBill(getDb(), householdId, userId, input));
  }),
);

/** Replaces the header and every line, so the saved bill matches the form exactly. */
billsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId, userId } = auth(req);
    const id = Number(req.params.id);
    const db = getDb();
    await requireBill(db, householdId, id);
    const input = parseOrThrow(billInputSchema, req.body);
    res.json(await saveBill(db, householdId, userId, input, id));
  }),
);

billsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteBill(getDb(), auth(req).householdId, Number(req.params.id));
    res.status(204).end();
  }),
);
