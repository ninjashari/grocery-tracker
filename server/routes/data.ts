import { Router } from "express";
import { getDb } from "../db/connection.ts";
import { badRequest, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { commitImport, stageImport, toPreview } from "../lib/csvImport.ts";
import { CSV_COLUMNS, toCsv } from "../../shared/csv.ts";
import { paiseToRupees } from "../../shared/money.ts";
import { importCommitSchema } from "../../shared/schemas.ts";

export const dataRouter = Router();

/** Every bill line, denormalised. This is exactly the shape /data/import accepts back. */
dataRouter.get("/export.csv", (req, res) => {
  const { householdId } = auth(req);

  const rows = getDb()
    .prepare(
      `SELECT b.bill_date, b.shop, b.payment_method, i.brand, i.name AS item_name,
              COALESCE(c.name, '') AS category,
              bl.quantity, bl.unit, bl.unit_price_paise, bl.line_total_paise,
              b.stated_total_paise, b.note
         FROM bill_lines bl
         JOIN bills b           ON b.id = bl.bill_id
         JOIN items i           ON i.id = bl.item_id
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE b.household_id = ?
        ORDER BY b.bill_date, b.id, bl.id`,
    )
    .all(householdId) as {
    bill_date: string;
    shop: string;
    payment_method: string;
    brand: string;
    item_name: string;
    category: string;
    quantity: number;
    unit: string;
    unit_price_paise: number;
    line_total_paise: number;
    stated_total_paise: number | null;
    note: string;
  }[];

  const csv = toCsv(
    CSV_COLUMNS,
    rows.map((row) => [
      row.bill_date,
      row.shop,
      row.payment_method,
      row.brand,
      row.item_name,
      row.category,
      row.quantity,
      row.unit,
      paiseToRupees(row.unit_price_paise).toFixed(2),
      paiseToRupees(row.line_total_paise).toFixed(2),
      row.stated_total_paise === null ? "" : paiseToRupees(row.stated_total_paise).toFixed(2),
      row.note,
    ]),
  );

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="grocery-export-${stamp}.csv"`);
  res.send(csv);
});

/** Dry run: parse, validate against current data, and report what would happen. No writes. */
dataRouter.post("/import/preview", (req, res) => {
  const { householdId } = auth(req);
  const csv = readCsvBody(req.body);
  res.json(toPreview(stageImport(householdId, csv)));
});

/** Commit. Re-stages from the same CSV so the write matches the reviewed preview. */
dataRouter.post("/import", (req, res) => {
  const { householdId, userId } = auth(req);
  const input = parseOrThrow(importCommitSchema, req.body);
  const staged = stageImport(householdId, input.csv);
  res.status(201).json({ ...commitImport(householdId, userId, staged), skippedRows: staged.errors.length });
});

/** Accepts either a raw text/csv body or JSON { csv }. */
function readCsvBody(body: unknown): string {
  if (typeof body === "string" && body.trim() !== "") return body;
  if (body && typeof body === "object" && typeof (body as { csv?: unknown }).csv === "string") {
    return (body as { csv: string }).csv;
  }
  throw badRequest("Send the CSV as a text/csv body or as JSON { csv }");
}
