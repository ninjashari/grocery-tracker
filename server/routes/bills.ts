import { Router } from "express";
import { parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { deleteBill, listBills, requireBill, saveBill } from "../lib/bills.ts";
import { billInputSchema, billQuerySchema } from "../../shared/schemas.ts";

export const billsRouter = Router();

billsRouter.get("/", (req, res) => {
  const { householdId } = auth(req);
  const query = parseOrThrow(billQuerySchema, req.query);
  res.json(listBills(householdId, query));
});

billsRouter.get("/:id", (req, res) => {
  res.json(requireBill(auth(req).householdId, Number(req.params.id)));
});

billsRouter.post("/", (req, res) => {
  const { householdId, userId } = auth(req);
  const input = parseOrThrow(billInputSchema, req.body);
  res.status(201).json(saveBill(householdId, userId, input));
});

/** Replaces the header and every line, so the saved bill matches the form exactly. */
billsRouter.patch("/:id", (req, res) => {
  const { householdId, userId } = auth(req);
  const id = Number(req.params.id);
  requireBill(householdId, id);
  const input = parseOrThrow(billInputSchema, req.body);
  res.json(saveBill(householdId, userId, input, id));
});

billsRouter.delete("/:id", (req, res) => {
  deleteBill(auth(req).householdId, Number(req.params.id));
  res.status(204).end();
});
