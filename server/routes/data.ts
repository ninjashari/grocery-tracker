import { Router } from "express";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import { billLines, bills, categories, items } from "../db/schema.ts";
import { asyncHandler, badRequest, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { commitImport, stageImport, toPreview } from "../lib/csvImport.ts";
import { CSV_COLUMNS, toCsv } from "../../shared/csv.ts";
import { paiseToRupees } from "../../shared/money.ts";
import { importCommitSchema } from "../../shared/schemas.ts";

export const dataRouter = Router();

/** Every bill line, denormalised. This is exactly the shape /data/import accepts back. */
dataRouter.get(
  "/export.csv",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);

    const rows = await getDb()
      .select({
        billDate: bills.billDate,
        shop: bills.shop,
        paymentMethod: bills.paymentMethod,
        brand: items.brand,
        itemName: items.name,
        category: categories.name,
        quantity: billLines.quantity,
        unit: billLines.unit,
        unitPricePaise: billLines.unitPricePaise,
        lineTotalPaise: billLines.lineTotalPaise,
        statedTotalPaise: bills.statedTotalPaise,
        note: bills.note,
      })
      .from(billLines)
      .innerJoin(bills, eq(bills.id, billLines.billId))
      .innerJoin(items, eq(items.id, billLines.itemId))
      .leftJoin(categories, eq(categories.id, items.categoryId))
      .where(eq(bills.householdId, householdId))
      .orderBy(bills.billDate, bills.id, billLines.id);

    const csv = toCsv(
      CSV_COLUMNS,
      rows.map((row) => [
        row.billDate,
        row.shop,
        row.paymentMethod,
        row.brand,
        row.itemName,
        row.category ?? "",
        row.quantity,
        row.unit,
        paiseToRupees(row.unitPricePaise).toFixed(2),
        paiseToRupees(row.lineTotalPaise).toFixed(2),
        row.statedTotalPaise === null ? "" : paiseToRupees(row.statedTotalPaise).toFixed(2),
        row.note,
      ]),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="grocery-export-${stamp}.csv"`);
    res.send(csv);
  }),
);

/** Dry run: parse, validate against current data, and report what would happen. No writes. */
dataRouter.post(
  "/import/preview",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const csv = readCsvBody(req.body);
    const staged = await stageImport(getDb(), householdId, csv);
    res.json(toPreview(staged));
  }),
);

/** Commit. Re-stages from the same CSV so the write matches the reviewed preview. */
dataRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { householdId, userId } = auth(req);
    const input = parseOrThrow(importCommitSchema, req.body);
    const db = getDb();
    const staged = await stageImport(db, householdId, input.csv);
    const result = await commitImport(db, householdId, userId, staged);
    res.status(201).json({ ...result, skippedRows: staged.errors.length });
  }),
);

/** Accepts either a raw text/csv body or JSON { csv }. */
function readCsvBody(body: unknown): string {
  if (typeof body === "string" && body.trim() !== "") return body;
  if (body && typeof body === "object" && typeof (body as { csv?: unknown }).csv === "string") {
    return (body as { csv: string }).csv;
  }
  throw badRequest("Send the CSV as a text/csv body or as JSON { csv }");
}
