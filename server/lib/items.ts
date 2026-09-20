import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "../db/connection.ts";
import { categories, items } from "../db/schema.ts";
import { conflict, notFound } from "./http.ts";
import type { Item } from "../../shared/types.ts";
import type { Unit } from "../../shared/units.ts";

/**
 * Item rows always carry their most recent purchase, because bill entry prefills the unit
 * price from it — that prefill is what makes repeat shopping fast.
 *
 * Kept as raw SQL rather than the query builder: the `last` subquery needs
 * `ROW_NUMBER() OVER (PARTITION BY ...)`, which Drizzle's SQLite builder has no
 * first-class helper for.
 */
const ITEM_SELECT = sql`
  SELECT i.id,
         i.brand,
         i.name,
         i.category_id   AS categoryId,
         c.name          AS categoryName,
         i.default_unit  AS defaultUnit,
         i.archived      AS archivedInt,
         last.unit_price_paise AS lastUnitPricePaise,
         last.unit             AS lastUnit,
         last.bill_date        AS lastPurchasedOn,
         last.line_total_paise AS lastLineTotalPaise,
         last.quantity         AS lastQuantity,
         COALESCE(stats.purchaseCount, 0) AS purchaseCount
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN (
      SELECT bl.item_id, COUNT(*) AS purchaseCount
        FROM bill_lines bl
       GROUP BY bl.item_id
    ) stats ON stats.item_id = i.id
    LEFT JOIN (
      SELECT bl.item_id, bl.unit_price_paise, bl.unit, bl.line_total_paise, bl.quantity, b.bill_date,
             ROW_NUMBER() OVER (
               PARTITION BY bl.item_id ORDER BY b.bill_date DESC, bl.id DESC
             ) AS rn
        FROM bill_lines bl
        JOIN bills b ON b.id = bl.bill_id
    ) last ON last.item_id = i.id AND last.rn = 1
`;

type ItemRow = Omit<Item, "archived"> & { archivedInt: number };

function toItem(row: ItemRow): Item {
  const { archivedInt, ...rest } = row;
  return { ...rest, archived: archivedInt === 1 };
}

export type ItemQuery = {
  q?: string;
  categoryId?: number;
  includeArchived?: boolean;
  limit?: number;
};

export async function listItems(executor: Executor, householdId: number, query: ItemQuery = {}): Promise<Item[]> {
  const conditions = [sql`i.household_id = ${householdId}`];

  if (!query.includeArchived) conditions.push(sql`i.archived = 0`);

  if (query.q) {
    // Match against "brand name" so typing either half, or both, finds the item.
    conditions.push(sql`(i.brand || ' ' || i.name) LIKE ${`%${query.q}%`} COLLATE NOCASE`);
  }

  if (query.categoryId !== undefined) {
    conditions.push(sql`i.category_id = ${query.categoryId}`);
  }

  const rows = await executor.all<ItemRow>(sql`
    ${ITEM_SELECT}
     WHERE ${sql.join(conditions, sql` AND `)}
     ORDER BY i.name COLLATE NOCASE, i.brand COLLATE NOCASE
     LIMIT ${query.limit ?? 500}
  `);

  return rows.map(toItem);
}

export async function getItem(executor: Executor, householdId: number, id: number): Promise<Item | null> {
  const rows = await executor.all<ItemRow>(
    sql`${ITEM_SELECT} WHERE i.household_id = ${householdId} AND i.id = ${id}`,
  );
  return rows[0] ? toItem(rows[0]) : null;
}

export async function requireItem(executor: Executor, householdId: number, id: number): Promise<Item> {
  const item = await getItem(executor, householdId, id);
  if (!item) throw notFound("Item not found");
  return item;
}

/** Throws unless the category belongs to this household (or is null). */
export async function assertCategoryInHousehold(
  executor: Executor,
  householdId: number,
  categoryId: number | null,
): Promise<void> {
  if (categoryId === null) return;
  const [row] = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)));
  if (!row) throw notFound("Category not found");
}

export type NewItem = { brand: string; name: string; categoryId: number | null; defaultUnit: Unit };

/**
 * Find an existing item by (brand, name) or create it. Used by bill entry and CSV import
 * so neither has to stop and send the user to the catalog first.
 *
 * Caller must pass the transaction's executor if this needs to be part of one.
 */
export async function findOrCreateItem(executor: Executor, householdId: number, input: NewItem): Promise<number> {
  const [existing] = await executor
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.householdId, householdId),
        sql`${items.brand} = ${input.brand} COLLATE NOCASE`,
        sql`${items.name} = ${input.name} COLLATE NOCASE`,
      ),
    );

  if (existing) {
    // An item reappearing on a new bill is back in circulation.
    await executor.update(items).set({ archived: 0 }).where(eq(items.id, existing.id));
    return existing.id;
  }

  await assertCategoryInHousehold(executor, householdId, input.categoryId);

  const [created] = await executor
    .insert(items)
    .values({
      householdId,
      brand: input.brand,
      name: input.name,
      categoryId: input.categoryId,
      defaultUnit: input.defaultUnit,
    })
    .returning({ id: items.id });

  return created!.id;
}

export async function assertItemNameFree(
  executor: Executor,
  householdId: number,
  brand: string,
  name: string,
  exceptId?: number,
): Promise<void> {
  const conditions = [
    eq(items.householdId, householdId),
    sql`${items.brand} = ${brand} COLLATE NOCASE`,
    sql`${items.name} = ${name} COLLATE NOCASE`,
  ];
  if (exceptId !== undefined) conditions.push(sql`${items.id} <> ${exceptId}`);

  const [row] = await executor
    .select({ id: items.id })
    .from(items)
    .where(and(...conditions));

  if (row) {
    const label = brand ? `${brand} ${name}` : name;
    throw conflict(`You already have an item called "${label}"`);
  }
}
