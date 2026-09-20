import { and, eq, sql } from "drizzle-orm";
import type { DB, Executor } from "../db/connection.ts";
import { bills, billLines, categories, items } from "../db/schema.ts";
import { badRequest } from "./http.ts";
import { findOrCreateItem } from "./items.ts";
import { parseCsvWithHeader } from "../../shared/csv.ts";
import { derivedUnitPricePaise, lineTotalPaise, rupeesToPaise } from "../../shared/money.ts";
import { isUnit, toBaseQuantity, type Unit } from "../../shared/units.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "../../shared/schemas.ts";
import type { ImportPreview, ImportResult, ImportRowError } from "../../shared/types.ts";

type StagedLine = {
  brand: string;
  itemName: string;
  categoryName: string;
  quantity: number;
  unit: Unit;
  lineTotalPaise: number;
};

type StagedBill = {
  billDate: string;
  shop: string;
  paymentMethod: PaymentMethod;
  note: string;
  statedTotalPaise: number | null;
  lines: StagedLine[];
};

type Staged = {
  bills: StagedBill[];
  errors: ImportRowError[];
  newItemLabels: Set<string>;
  newCategoryNames: Set<string>;
  newShops: Set<string>;
  totalPaise: number;
};

const REQUIRED_HEADERS = ["bill_date", "shop", "item_name", "quantity", "unit"] as const;

/**
 * Remembers, within one import, whether a name has already been confirmed to exist -
 * without it, a large CSV means up to 3 network round-trips per row against a remote
 * database for values (category, shop) that repeat across many rows.
 */
function memoizedExists(check: (name: string) => Promise<boolean>) {
  const known = new Map<string, boolean>();
  return async function isKnownToExist(name: string): Promise<boolean> {
    const key = name.toLowerCase();
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const exists = await check(name);
    known.set(key, exists);
    return exists;
  };
}

/**
 * Same idea as memoizedExists, but keyed on two fields (brand and name) - an item's
 * identity can't be safely round-tripped through one concatenated string, since a
 * multi-word brand (for example "India Gate") makes "brand plus name" ambiguous to split
 * back apart.
 */
function memoizedItemExists(check: (brand: string, name: string) => Promise<boolean>) {
  const known = new Map<string, boolean>();
  return async function isKnownToExist(brand: string, name: string): Promise<boolean> {
    const key = `${brand.toLowerCase()}|${name.toLowerCase()}`;
    const cached = known.get(key);
    if (cached !== undefined) return cached;
    const exists = await check(brand, name);
    known.set(key, exists);
    return exists;
  };
}

/**
 * Parses and validates CSV against the household's current data without writing anything.
 *
 * Both the dry run and the commit call this, so the preview the user approves is exactly
 * what gets written - there is no second, divergent parse.
 */
export async function stageImport(executor: Executor, householdId: number, csv: string): Promise<Staged> {
  const { headers, rows } = parseCsvWithHeader(csv);

  if (rows.length === 0) throw badRequest("That CSV has no data rows");

  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw badRequest(`CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }

  const itemExists = memoizedItemExists(async function checkItem(brand, name) {
    const [row] = await executor
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.householdId, householdId),
          sql`${items.brand} = ${brand} COLLATE NOCASE`,
          sql`${items.name} = ${name} COLLATE NOCASE`,
        ),
      );
    return row !== undefined;
  });

  const categoryExists = memoizedExists(async function checkCategory(name) {
    const [row] = await executor
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), sql`${categories.name} = ${name} COLLATE NOCASE`));
    return row !== undefined;
  });

  const shopExists = memoizedExists(async function checkShop(name) {
    const [row] = await executor
      .select({ id: bills.id })
      .from(bills)
      .where(and(eq(bills.householdId, householdId), sql`${bills.shop} = ${name} COLLATE NOCASE`));
    return row !== undefined;
  });

  const staged: Staged = {
    bills: [],
    errors: [],
    newItemLabels: new Set(),
    newCategoryNames: new Set(),
    newShops: new Set(),
    totalPaise: 0,
  };

  const billsByKey = new Map<string, StagedBill>();

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const fail = (message: string) => staged.errors.push({ row: rowNumber, message });

    const billDate = (row["bill_date"] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate) || Number.isNaN(Date.parse(billDate))) {
      fail(`bill_date "${billDate}" is not a valid YYYY-MM-DD date`);
      continue;
    }

    const shop = (row["shop"] ?? "").trim();
    if (!shop) {
      fail("shop is required");
      continue;
    }

    const itemName = (row["item_name"] ?? "").trim();
    if (!itemName) {
      fail("item_name is required");
      continue;
    }

    const unitRaw = (row["unit"] ?? "").trim();
    if (!isUnit(unitRaw)) {
      fail(`unit "${unitRaw}" is not one of kg, g, L, ml, pcs, pack, dozen`);
      continue;
    }
    const unit: Unit = unitRaw;

    const quantity = Number((row["quantity"] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      fail(`quantity "${row["quantity"]}" must be a number greater than zero`);
      continue;
    }

    let rowLineTotalPaise = rupeesToPaise(row["line_total"] ?? "");
    if (rowLineTotalPaise === null) {
      const unitPricePaise = rupeesToPaise(row["unit_price"] ?? "");
      if (unitPricePaise === null) {
        fail("needs either line_total or unit_price");
        continue;
      }
      rowLineTotalPaise = lineTotalPaise(quantity, unitPricePaise);
    }
    if (rowLineTotalPaise < 0) {
      fail("price cannot be negative");
      continue;
    }

    const brand = (row["brand"] ?? "").trim();
    const categoryName = (row["category"] ?? "").trim();
    const paymentRaw = (row["payment_method"] ?? "").trim();
    const paymentMethod =
      PAYMENT_METHODS.find((method) => method.toLowerCase() === paymentRaw.toLowerCase()) ?? "Other";

    const label = brand ? brand + " " + itemName : itemName;
    const alreadyExists = await itemExists(brand, itemName);
    if (!alreadyExists && !staged.newItemLabels.has(label)) {
      staged.newItemLabels.add(label);
    }
    if (categoryName) {
      const categoryAlreadyExists = await categoryExists(categoryName);
      if (!categoryAlreadyExists) staged.newCategoryNames.add(categoryName);
    }
    const shopAlreadyExists = await shopExists(shop);
    if (!shopAlreadyExists) staged.newShops.add(shop);

    const key = billDate + "|" + shop.toLowerCase() + "|" + paymentMethod;
    let bill = billsByKey.get(key);
    if (!bill) {
      bill = {
        billDate,
        shop,
        paymentMethod,
        note: (row["note"] ?? "").trim(),
        statedTotalPaise: rupeesToPaise(row["bill_total"] ?? ""),
        lines: [],
      };
      billsByKey.set(key, bill);
      staged.bills.push(bill);
    }

    bill.lines.push({ brand, itemName, categoryName, quantity, unit, lineTotalPaise: rowLineTotalPaise });
    staged.totalPaise += rowLineTotalPaise;
  }

  return staged;
}

export function toPreview(staged: Staged): ImportPreview {
  return {
    billCount: staged.bills.length,
    lineCount: staged.bills.reduce((sum, bill) => sum + bill.lines.length, 0),
    newItems: [...staged.newItemLabels].sort(),
    newCategories: [...staged.newCategoryNames].sort(),
    newShops: [...staged.newShops].sort(),
    totalPaise: staged.totalPaise,
    errors: staged.errors,
  };
}

/**
 * Writes a staged import. Rows that failed validation are skipped, not fatal - a single
 * bad row in a long export should not block the other 200.
 */
export async function commitImport(
  db: DB,
  householdId: number,
  userId: number,
  staged: Staged,
): Promise<ImportResult> {
  const result: ImportResult = { billsCreated: 0, linesCreated: 0, itemsCreated: 0, categoriesCreated: 0 };

  return db.transaction(async function runCommit(tx) {
    const categoryIds = new Map<string, number>();

    async function categoryIdFor(name: string): Promise<number | null> {
      if (!name) return null;
      const cacheKey = name.toLowerCase();
      const cached = categoryIds.get(cacheKey);
      if (cached !== undefined) return cached;

      const [found] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.householdId, householdId), sql`${categories.name} = ${name} COLLATE NOCASE`));
      if (found) {
        categoryIds.set(cacheKey, found.id);
        return found.id;
      }

      const [sort] = await tx
        .select({ n: sql<number>`COALESCE(MAX(${categories.sortOrder}), -1) + 1` })
        .from(categories)
        .where(eq(categories.householdId, householdId));

      const [created] = await tx
        .insert(categories)
        .values({ householdId, name, sortOrder: sort!.n })
        .returning({ id: categories.id });
      result.categoriesCreated += 1;
      categoryIds.set(cacheKey, created!.id);
      return created!.id;
    }

    const [itemsBeforeRow] = await tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(items)
      .where(eq(items.householdId, householdId));
    const itemsBefore = itemsBeforeRow!.n;

    for (const bill of staged.bills) {
      const statedTotal = bill.statedTotalPaise ?? bill.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

      const [created] = await tx
        .insert(bills)
        .values({
          householdId,
          billDate: bill.billDate,
          shop: bill.shop,
          paymentMethod: bill.paymentMethod,
          statedTotalPaise: statedTotal,
          note: bill.note,
          createdBy: userId,
        })
        .returning({ id: bills.id });
      result.billsCreated += 1;

      for (const line of bill.lines) {
        const categoryId = await categoryIdFor(line.categoryName);
        const itemId = await findOrCreateItem(tx, householdId, {
          brand: line.brand,
          name: line.itemName,
          categoryId,
          defaultUnit: line.unit,
        });
        const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);
        const unitPricePaise = derivedUnitPricePaise(line.lineTotalPaise, line.quantity);
        await tx.insert(billLines).values({
          billId: created!.id,
          itemId,
          quantity: line.quantity,
          unit: line.unit,
          lineTotalPaise: line.lineTotalPaise,
          unitPricePaise,
          baseQuantity,
          baseUnit,
        });
        result.linesCreated += 1;
      }
    }

    const [itemsAfterRow] = await tx
      .select({ n: sql<number>`COUNT(*)` })
      .from(items)
      .where(eq(items.householdId, householdId));
    result.itemsCreated = itemsAfterRow!.n - itemsBefore;
    return result;
  });
}
