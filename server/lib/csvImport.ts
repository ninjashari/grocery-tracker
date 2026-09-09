import { getDb, transaction } from "../db/connection.ts";
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
  /** The receipt's printed amount for this line — authoritative, stored as-is. */
  lineTotalPaise: number;
};

type StagedBill = {
  billDate: string;
  shop: string;
  paymentMethod: PaymentMethod;
  note: string;
  /** The printed receipt total, when the CSV carries one. Null falls back to the line sum. */
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
 * Parses and validates CSV against the household's current data without writing anything.
 *
 * Both the dry run and the commit call this, so the preview the user approves is exactly
 * what gets written — there is no second, divergent parse.
 */
export function stageImport(householdId: number, csv: string): Staged {
  const { headers, rows } = parseCsvWithHeader(csv);

  if (rows.length === 0) throw badRequest("That CSV has no data rows");

  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw badRequest(`CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
  }

  const db = getDb();
  const existingItem = db.prepare(
    "SELECT 1 FROM items WHERE household_id = ? AND brand = ? COLLATE NOCASE AND name = ? COLLATE NOCASE",
  );
  const existingCategory = db.prepare(
    "SELECT 1 FROM categories WHERE household_id = ? AND name = ? COLLATE NOCASE",
  );
  const existingShop = db.prepare(
    "SELECT 1 FROM bills WHERE household_id = ? AND shop = ? COLLATE NOCASE",
  );

  const staged: Staged = {
    bills: [],
    errors: [],
    newItemLabels: new Set(),
    newCategoryNames: new Set(),
    newShops: new Set(),
    totalPaise: 0,
  };

  // Rows sharing a date + shop + payment method are one trip to the shop, so one bill.
  const billsByKey = new Map<string, StagedBill>();

  rows.forEach((row, index) => {
    // +2: one for the header row, one to make it 1-indexed like a spreadsheet.
    const rowNumber = index + 2;
    const fail = (message: string) => staged.errors.push({ row: rowNumber, message });

    const billDate = (row["bill_date"] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate) || Number.isNaN(Date.parse(billDate))) {
      fail(`bill_date "${billDate}" is not a valid YYYY-MM-DD date`);
      return;
    }

    const shop = (row["shop"] ?? "").trim();
    if (!shop) {
      fail("shop is required");
      return;
    }

    const itemName = (row["item_name"] ?? "").trim();
    if (!itemName) {
      fail("item_name is required");
      return;
    }

    const unitRaw = (row["unit"] ?? "").trim();
    if (!isUnit(unitRaw)) {
      fail(`unit "${unitRaw}" is not one of kg, g, L, ml, pcs, pack, dozen`);
      return;
    }
    const unit: Unit = unitRaw;

    const quantity = Number((row["quantity"] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      fail(`quantity "${row["quantity"]}" must be a number greater than zero`);
      return;
    }

    // line_total is authoritative — it's what the receipt prints. unit_price is only a
    // fallback for CSVs that never had a total, and gets multiplied back out to one.
    let rowLineTotalPaise = rupeesToPaise(row["line_total"] ?? "");
    if (rowLineTotalPaise === null) {
      const unitPricePaise = rupeesToPaise(row["unit_price"] ?? "");
      if (unitPricePaise === null) {
        fail("needs either line_total or unit_price");
        return;
      }
      rowLineTotalPaise = lineTotalPaise(quantity, unitPricePaise);
    }
    if (rowLineTotalPaise < 0) {
      fail("price cannot be negative");
      return;
    }

    const brand = (row["brand"] ?? "").trim();
    const categoryName = (row["category"] ?? "").trim();
    const paymentRaw = (row["payment_method"] ?? "").trim();
    const paymentMethod =
      PAYMENT_METHODS.find((method) => method.toLowerCase() === paymentRaw.toLowerCase()) ?? "Other";

    const label = brand ? `${brand} ${itemName}` : itemName;
    if (!existingItem.get(householdId, brand, itemName) && !staged.newItemLabels.has(label)) {
      staged.newItemLabels.add(label);
    }
    if (categoryName && !existingCategory.get(householdId, categoryName)) {
      staged.newCategoryNames.add(categoryName);
    }
    if (!existingShop.get(householdId, shop)) staged.newShops.add(shop);

    const key = `${billDate}|${shop.toLowerCase()}|${paymentMethod}`;
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
  });

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
 * Writes a staged import. Rows that failed validation are skipped, not fatal — a single
 * bad row in a long export should not block the other 200.
 */
export function commitImport(householdId: number, userId: number, staged: Staged): ImportResult {
  const db = getDb();
  const result: ImportResult = { billsCreated: 0, linesCreated: 0, itemsCreated: 0, categoriesCreated: 0 };

  return transaction(db, () => {
    const categoryIds = new Map<string, number>();

    const findCategory = db.prepare(
      "SELECT id FROM categories WHERE household_id = ? AND name = ? COLLATE NOCASE",
    );
    const nextSort = db.prepare(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE household_id = ?",
    );
    const insertCategory = db.prepare(
      "INSERT INTO categories (household_id, name, sort_order) VALUES (?, ?, ?) RETURNING id",
    );

    const categoryIdFor = (name: string): number | null => {
      if (!name) return null;
      const cached = categoryIds.get(name.toLowerCase());
      if (cached !== undefined) return cached;

      const found = findCategory.get(householdId, name) as { id: number } | undefined;
      if (found) {
        categoryIds.set(name.toLowerCase(), found.id);
        return found.id;
      }

      const sort = nextSort.get(householdId) as { n: number };
      const created = insertCategory.get(householdId, name, sort.n) as { id: number };
      result.categoriesCreated += 1;
      categoryIds.set(name.toLowerCase(), created.id);
      return created.id;
    };

    const insertBill = db.prepare(
      `INSERT INTO bills (household_id, bill_date, shop, payment_method, stated_total_paise, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    );
    const insertLine = db.prepare(
      `INSERT INTO bill_lines (bill_id, item_id, quantity, unit, line_total_paise, unit_price_paise, base_quantity, base_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const countItems = db.prepare("SELECT COUNT(*) AS n FROM items WHERE household_id = ?");

    const itemsBefore = (countItems.get(householdId) as { n: number }).n;

    for (const bill of staged.bills) {
      // Prefer the printed total the CSV carried; fall back to the line sum so an import
      // without a bill_total column still records something to check against.
      const statedTotal =
        bill.statedTotalPaise ?? bill.lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

      const created = insertBill.get(
        householdId,
        bill.billDate,
        bill.shop,
        bill.paymentMethod,
        statedTotal,
        bill.note,
        userId,
      ) as { id: number };
      result.billsCreated += 1;

      for (const line of bill.lines) {
        const itemId = findOrCreateItem(householdId, {
          brand: line.brand,
          name: line.itemName,
          categoryId: categoryIdFor(line.categoryName),
          defaultUnit: line.unit,
        });
        const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);
        const unitPricePaise = derivedUnitPricePaise(line.lineTotalPaise, line.quantity);
        insertLine.run(
          created.id,
          itemId,
          line.quantity,
          line.unit,
          line.lineTotalPaise,
          unitPricePaise,
          baseQuantity,
          baseUnit,
        );
        result.linesCreated += 1;
      }
    }

    result.itemsCreated = (countItems.get(householdId) as { n: number }).n - itemsBefore;
    return result;
  });
}
