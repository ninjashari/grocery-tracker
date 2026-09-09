import { getDb, transaction } from "../db/connection.ts";
import { notFound } from "./http.ts";
import { findOrCreateItem } from "./items.ts";
import { toBaseQuantity } from "../../shared/units.ts";
import { derivedUnitPricePaise } from "../../shared/money.ts";
import type { BillInput } from "../../shared/schemas.ts";
import type { Bill, BillLine, BillSummary } from "../../shared/types.ts";

const BILL_SELECT = `
  SELECT b.id,
         b.bill_date          AS billDate,
         b.shop,
         b.payment_method     AS paymentMethod,
         b.stated_total_paise AS statedTotalPaise,
         b.note,
         COALESCE(SUM(bl.line_total_paise), 0) AS computedTotalPaise,
         COUNT(bl.id)                          AS lineCount,
         COALESCE(u.name, 'Unknown')           AS createdByName
    FROM bills b
    LEFT JOIN bill_lines bl ON bl.bill_id = b.id
    LEFT JOIN users u       ON u.id = b.created_by
`;

export type BillFilter = { from?: string; to?: string; shop?: string; limit: number; offset: number };

export function listBills(householdId: number, filter: BillFilter): BillSummary[] {
  const where = ["b.household_id = ?"];
  const params: (string | number)[] = [householdId];

  if (filter.from) {
    where.push("b.bill_date >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    where.push("b.bill_date <= ?");
    params.push(filter.to);
  }
  if (filter.shop) {
    where.push("b.shop LIKE ? COLLATE NOCASE");
    params.push(`%${filter.shop}%`);
  }

  params.push(filter.limit, filter.offset);

  return getDb()
    .prepare(
      `${BILL_SELECT}
        WHERE ${where.join(" AND ")}
        GROUP BY b.id
        ORDER BY b.bill_date DESC, b.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params) as BillSummary[];
}

export function getBillLines(billId: number): BillLine[] {
  return getDb()
    .prepare(
      `SELECT bl.id,
              bl.item_id          AS itemId,
              i.brand,
              i.name              AS itemName,
              c.name              AS categoryName,
              bl.quantity,
              bl.unit,
              bl.unit_price_paise AS unitPricePaise,
              bl.line_total_paise AS lineTotalPaise,
              bl.base_quantity    AS baseQuantity,
              bl.base_unit        AS baseUnit
         FROM bill_lines bl
         JOIN items i           ON i.id = bl.item_id
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE bl.bill_id = ?
        ORDER BY bl.id`,
    )
    .all(billId) as BillLine[];
}

export function getBill(householdId: number, id: number): Bill | null {
  const summary = getDb()
    .prepare(`${BILL_SELECT} WHERE b.household_id = ? AND b.id = ? GROUP BY b.id`)
    .get(householdId, id) as BillSummary | undefined;

  if (!summary) return null;
  return { ...summary, lines: getBillLines(id) };
}

export function requireBill(householdId: number, id: number): Bill {
  const bill = getBill(householdId, id);
  if (!bill) throw notFound("Bill not found");
  return bill;
}

/**
 * Writes a bill header and all its lines atomically, creating any inline `newItem`s along
 * the way. A half-saved bill would not match its receipt, so this is all-or-nothing.
 *
 * `billId` updates in place by replacing every line, which keeps edit semantics simple:
 * what you see in the form is exactly what ends up stored.
 */
export function saveBill(
  householdId: number,
  userId: number,
  input: BillInput,
  billId?: number,
): Bill {
  const db = getDb();

  const savedId = transaction(db, () => {
    let id = billId;

    if (id === undefined) {
      const created = db
        .prepare(
          `INSERT INTO bills (household_id, bill_date, shop, payment_method, stated_total_paise, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .get(
          householdId,
          input.billDate,
          input.shop,
          input.paymentMethod,
          input.statedTotalPaise,
          input.note,
          userId,
        ) as { id: number };
      id = created.id;
    } else {
      db.prepare(
        `UPDATE bills
            SET bill_date = ?, shop = ?, payment_method = ?, stated_total_paise = ?, note = ?
          WHERE id = ? AND household_id = ?`,
      ).run(input.billDate, input.shop, input.paymentMethod, input.statedTotalPaise, input.note, id, householdId);

      db.prepare("DELETE FROM bill_lines WHERE bill_id = ?").run(id);
    }

    const insertLine = db.prepare(
      `INSERT INTO bill_lines (bill_id, item_id, quantity, unit, line_total_paise, unit_price_paise, base_quantity, base_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const line of input.lines) {
      const itemId =
        line.itemId !== undefined
          ? assertItemInHousehold(householdId, line.itemId)
          : findOrCreateItem(householdId, line.newItem!);

      const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);
      const unitPricePaise = derivedUnitPricePaise(line.lineTotalPaise, line.quantity);
      insertLine.run(id, itemId, line.quantity, line.unit, line.lineTotalPaise, unitPricePaise, baseQuantity, baseUnit);
    }

    return id;
  });

  return requireBill(householdId, savedId);
}

/** Guards against a request naming an item id that belongs to a different household. */
function assertItemInHousehold(householdId: number, itemId: number): number {
  const row = getDb()
    .prepare("SELECT id FROM items WHERE id = ? AND household_id = ?")
    .get(itemId, householdId) as { id: number } | undefined;
  if (!row) throw notFound("Item not found");
  return row.id;
}

export function deleteBill(householdId: number, id: number): void {
  requireBill(householdId, id);
  // bill_lines cascade on delete.
  getDb().prepare("DELETE FROM bills WHERE id = ? AND household_id = ?").run(id, householdId);
}
