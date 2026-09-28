import { Router } from "express";
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
    res.json(await listBills(householdId, query));
  }),
);

billsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await requireBill(auth(req).householdId, String(req.params.id)));
  }),
);

billsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId, userId } = auth(req);
    const input = parseOrThrow(billInputSchema, req.body);
    res.status(201).json(await saveBill(householdId, userId, input));
  }),
);

/** Replaces the header and every line, so the saved bill matches the form exactly. */
billsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId, userId } = auth(req);
    const id = String(req.params.id);
    await requireBill(householdId, id);
    const input = parseOrThrow(billInputSchema, req.body);
    res.json(await saveBill(householdId, userId, input, id));
  }),
);

billsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteBill(auth(req).householdId, String(req.params.id));
    res.status(204).end();
  }),
);
