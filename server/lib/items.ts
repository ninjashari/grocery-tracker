import { getDb } from "../db/connection.ts";
import { conflict, notFound } from "./http.ts";
import type { Item } from "../../shared/types.ts";
import type { Unit } from "../../shared/units.ts";

/**
 * Item rows always carry their most recent purchase, because bill entry prefills the unit
 * price from it — that prefill is what makes repeat shopping fast.
 */
const ITEM_SELECT = `
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
         COALESCE(stats.purchaseCount, 0) AS purchaseCount
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN (
      SELECT bl.item_id, COUNT(*) AS purchaseCount
        FROM bill_lines bl
       GROUP BY bl.item_id
    ) stats ON stats.item_id = i.id
    LEFT JOIN (
      SELECT bl.item_id, bl.unit_price_paise, bl.unit, b.bill_date,
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

export function listItems(householdId: number, query: ItemQuery = {}): Item[] {
  const where = ["i.household_id = ?"];
  const params: (string | number)[] = [householdId];

  if (!query.includeArchived) where.push("i.archived = 0");

  if (query.q) {
    // Match against "brand name" so typing either half, or both, finds the item.
    where.push("(i.brand || ' ' || i.name) LIKE ? COLLATE NOCASE");
    params.push(`%${query.q}%`);
  }

  if (query.categoryId !== undefined) {
    where.push("i.category_id = ?");
    params.push(query.categoryId);
  }

  params.push(query.limit ?? 500);

  const rows = getDb()
    .prepare(`${ITEM_SELECT} WHERE ${where.join(" AND ")} ORDER BY i.name COLLATE NOCASE, i.brand COLLATE NOCASE LIMIT ?`)
    .all(...params) as ItemRow[];

  return rows.map(toItem);
}

export function getItem(householdId: number, id: number): Item | null {
  const row = getDb()
    .prepare(`${ITEM_SELECT} WHERE i.household_id = ? AND i.id = ?`)
    .get(householdId, id) as ItemRow | undefined;
  return row ? toItem(row) : null;
}

export function requireItem(householdId: number, id: number): Item {
  const item = getItem(householdId, id);
  if (!item) throw notFound("Item not found");
  return item;
}

/** Throws unless the category belongs to this household (or is null). */
export function assertCategoryInHousehold(householdId: number, categoryId: number | null): void {
  if (categoryId === null) return;
  const row = getDb()
    .prepare("SELECT 1 FROM categories WHERE id = ? AND household_id = ?")
    .get(categoryId, householdId);
  if (!row) throw notFound("Category not found");
}

export type NewItem = { brand: string; name: string; categoryId: number | null; defaultUnit: Unit };

/**
 * Find an existing item by (brand, name) or create it. Used by bill entry and CSV import
 * so neither has to stop and send the user to the catalog first.
 *
 * Caller must already be inside a transaction.
 */
export function findOrCreateItem(householdId: number, input: NewItem): number {
  const db = getDb();

  const existing = db
    .prepare(
      "SELECT id FROM items WHERE household_id = ? AND brand = ? COLLATE NOCASE AND name = ? COLLATE NOCASE",
    )
    .get(householdId, input.brand, input.name) as { id: number } | undefined;

  if (existing) {
    // An item reappearing on a new bill is back in circulation.
    db.prepare("UPDATE items SET archived = 0 WHERE id = ?").run(existing.id);
    return existing.id;
  }

  assertCategoryInHousehold(householdId, input.categoryId);

  const created = db
    .prepare(
      "INSERT INTO items (household_id, brand, name, category_id, default_unit) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .get(householdId, input.brand, input.name, input.categoryId, input.defaultUnit) as { id: number };

  return created.id;
}

export function assertItemNameFree(householdId: number, brand: string, name: string, exceptId?: number): void {
  const params: (string | number)[] = [householdId, brand, name];
  let sql =
    "SELECT 1 FROM items WHERE household_id = ? AND brand = ? COLLATE NOCASE AND name = ? COLLATE NOCASE";
  if (exceptId !== undefined) {
    sql += " AND id <> ?";
    params.push(exceptId);
  }
  if (getDb().prepare(sql).get(...params)) {
    const label = brand ? `${brand} ${name}` : name;
    throw conflict(`You already have an item called "${label}"`);
  }
}
