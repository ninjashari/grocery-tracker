import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/connection.ts";
import { bills, billLines, categories, items, users } from "../db/schema.ts";
import { notFound } from "./http.ts";
import { findOrCreateItem } from "./items.ts";
import { toBaseQuantity } from "../../shared/units.ts";
import { derivedUnitPricePaise } from "../../shared/money.ts";
import type { BillInput } from "../../shared/schemas.ts";
import type { Bill, BillLine, BillSummary } from "../../shared/types.ts";

const billSummaryColumns = {
  id: bills.id,
  billDate: bills.billDate,
  shop: bills.shop,
  paymentMethod: bills.paymentMethod,
  statedTotalPaise: bills.statedTotalPaise,
  note: bills.note,
  computedTotalPaise: sql<number>`COALESCE(SUM(${billLines.lineTotalPaise}), 0)`,
  lineCount: sql<number>`COUNT(${billLines.id})`,
  createdByName: sql<string>`COALESCE(${users.name}, 'Unknown')`,
};

export type BillFilter = { from?: string; to?: string; shop?: string; limit: number; offset: number };

export async function listBills(executor: Executor, householdId: number, filter: BillFilter): Promise<BillSummary[]> {
  const conditions = [eq(bills.householdId, householdId)];
  if (filter.from) conditions.push(gte(bills.billDate, filter.from));
  if (filter.to) conditions.push(lte(bills.billDate, filter.to));
  if (filter.shop) conditions.push(sql`${bills.shop} LIKE ${`%${filter.shop}%`} COLLATE NOCASE`);

  const rows = await executor
    .select(billSummaryColumns)
    .from(bills)
    .leftJoin(billLines, eq(billLines.billId, bills.id))
    .leftJoin(users, eq(users.id, bills.createdBy))
    .where(and(...conditions))
    .groupBy(bills.id)
    .orderBy(sql`${bills.billDate} DESC`, sql`${bills.id} DESC`)
    .limit(filter.limit)
    .offset(filter.offset);

  return rows as unknown as BillSummary[];
}

export async function getBillLines(executor: Executor, billId: number): Promise<BillLine[]> {
  const rows = await executor
    .select({
      id: billLines.id,
      itemId: billLines.itemId,
      brand: items.brand,
      itemName: items.name,
      categoryName: categories.name,
      quantity: billLines.quantity,
      unit: billLines.unit,
      unitPricePaise: billLines.unitPricePaise,
      lineTotalPaise: billLines.lineTotalPaise,
      baseQuantity: billLines.baseQuantity,
      baseUnit: billLines.baseUnit,
    })
    .from(billLines)
    .innerJoin(items, eq(items.id, billLines.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(eq(billLines.billId, billId))
    .orderBy(billLines.id);

  return rows as unknown as BillLine[];
}

export async function getBill(executor: Executor, householdId: number, id: number): Promise<Bill | null> {
  const [summary] = await executor
    .select(billSummaryColumns)
    .from(bills)
    .leftJoin(billLines, eq(billLines.billId, bills.id))
    .leftJoin(users, eq(users.id, bills.createdBy))
    .where(and(eq(bills.householdId, householdId), eq(bills.id, id)))
    .groupBy(bills.id);

  if (!summary) return null;
  return { ...(summary as unknown as BillSummary), lines: await getBillLines(executor, id) };
}

export async function requireBill(executor: Executor, householdId: number, id: number): Promise<Bill> {
  const bill = await getBill(executor, householdId, id);
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
export async function saveBill(
  db: DB,
  householdId: number,
  userId: number,
  input: BillInput,
  billId?: number,
): Promise<Bill> {
  const savedId = await db.transaction(async (tx) => {
    let id = billId;

    if (id === undefined) {
      const [created] = await tx
        .insert(bills)
        .values({
          householdId,
          billDate: input.billDate,
          shop: input.shop,
          paymentMethod: input.paymentMethod,
          statedTotalPaise: input.statedTotalPaise,
          note: input.note,
          createdBy: userId,
        })
        .returning({ id: bills.id });
      id = created!.id;
    } else {
      await tx
        .update(bills)
        .set({
          billDate: input.billDate,
          shop: input.shop,
          paymentMethod: input.paymentMethod,
          statedTotalPaise: input.statedTotalPaise,
          note: input.note,
        })
        .where(and(eq(bills.id, id), eq(bills.householdId, householdId)));

      await tx.delete(billLines).where(eq(billLines.billId, id));
    }

    for (const line of input.lines) {
      const itemId =
        line.itemId !== undefined
          ? await assertItemInHousehold(tx, householdId, line.itemId)
          : await findOrCreateItem(tx, householdId, line.newItem!);

      const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);
      const unitPricePaise = derivedUnitPricePaise(line.lineTotalPaise, line.quantity);
      await tx.insert(billLines).values({
        billId: id!,
        itemId,
        quantity: line.quantity,
        unit: line.unit,
        lineTotalPaise: line.lineTotalPaise,
        unitPricePaise,
        baseQuantity,
        baseUnit,
      });
    }

    return id!;
  });

  return requireBill(db, householdId, savedId);
}

/** Guards against a request naming an item id that belongs to a different household. */
async function assertItemInHousehold(executor: Executor, householdId: number, itemId: number): Promise<number> {
  const [row] = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.householdId, householdId)));
  if (!row) throw notFound("Item not found");
  return row.id;
}

export async function deleteBill(executor: Executor, householdId: number, id: number): Promise<void> {
  await requireBill(executor, householdId, id);
  // bill_lines cascade on delete.
  await executor.delete(bills).where(and(eq(bills.id, id), eq(bills.householdId, householdId)));
}
