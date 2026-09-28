/**
 * Migration: copies every row out of the production Turso/SQLite database and upserts it
 * into MongoDB Atlas, preserving relationships via an in-memory legacy-id -> ObjectId map
 * built up in dependency order.
 *
 * Read-only against the source (Turso) — safe to run against a live database while `main`
 * is still serving traffic from it. Safe to re-run, too: every write is an upsert keyed on
 * `legacyId`, so running this again after more changes land in Turso updates the matching
 * Mongo documents instead of duplicating them. The one thing it does NOT handle is a row
 * deleted from Turso between runs — its Mongo copy is left behind, since there's no cheap
 * way to tell "deleted upstream" apart from "never migrated" from this script alone. For
 * this app's data (rarely bulk-deleted) that's an acceptable gap; if it matters, delete
 * the corresponding Mongo document by hand.
 *
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... MONGODB_URI=... \
 *     node scripts/migrate-to-mongo.ts
 *
 * `@libsql/client` is kept as a devDependency solely for this script — the app itself no
 * longer talks to Turso.
 */
import { createClient } from "@libsql/client";
import mongoose, { Types } from "mongoose";
import { connectDb } from "../server/db/connection.ts";
import { Bill, Category, Household, Item, User } from "../server/db/models/index.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const source = createClient({
  url: requireEnv("TURSO_DATABASE_URL"),
  authToken: process.env["TURSO_AUTH_TOKEN"],
});

type SourceHousehold = { id: number; name: string; created_at: string };
type SourceUser = { id: number; household_id: number; email: string; password_hash: string; name: string; created_at: string };
type SourceCategory = { id: number; household_id: number; name: string; sort_order: number; created_at: string };
type SourceItem = {
  id: number;
  household_id: number;
  brand: string;
  name: string;
  category_id: number | null;
  default_unit: string;
  archived: number;
  created_at: string;
};
type SourceBill = {
  id: number;
  household_id: number;
  bill_date: string;
  shop: string;
  payment_method: string;
  stated_total_paise: number | null;
  note: string;
  created_by: number | null;
  created_at: string;
};
type SourceBillLine = {
  id: number;
  bill_id: number;
  item_id: number;
  quantity: number;
  unit: string;
  line_total_paise: number;
  unit_price_paise: number;
  base_quantity: number;
  base_unit: string;
};

async function selectAll<T>(sql: string): Promise<T[]> {
  const result = await source.execute(sql);
  return result.rows as unknown as T[];
}

/** Upsert-by-legacyId, returning the target document's _id either way. */
async function upsertByLegacyId(
  model: typeof Household | typeof User | typeof Category | typeof Item | typeof Bill,
  legacyId: number,
  fields: Record<string, unknown>,
): Promise<Types.ObjectId> {
  const doc = await model.findOneAndUpdate(
    { legacyId },
    { $set: fields },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc!._id;
}

async function main(): Promise<void> {
  await connectDb();

  const householdIdMap = new Map<number, Types.ObjectId>();
  const userIdMap = new Map<number, Types.ObjectId>();
  const categoryIdMap = new Map<number, Types.ObjectId>();
  const itemIdMap = new Map<number, Types.ObjectId>();

  // households
  const households = await selectAll<SourceHousehold>("SELECT * FROM households");
  for (const row of households) {
    const id = await upsertByLegacyId(Household, row.id, { name: row.name });
    householdIdMap.set(row.id, id);
  }
  console.log(`households: ${households.length} upserted`);

  // users — password hashes carry over verbatim, no re-hashing.
  const users = await selectAll<SourceUser>("SELECT * FROM users");
  for (const row of users) {
    const id = await upsertByLegacyId(User, row.id, {
      householdId: householdIdMap.get(row.household_id),
      email: row.email,
      passwordHash: row.password_hash,
      name: row.name,
    });
    userIdMap.set(row.id, id);
  }
  console.log(`users: ${users.length} upserted`);

  // categories
  const categories = await selectAll<SourceCategory>("SELECT * FROM categories");
  for (const row of categories) {
    const id = await upsertByLegacyId(Category, row.id, {
      householdId: householdIdMap.get(row.household_id),
      name: row.name,
      nameLower: row.name.toLowerCase(),
      sortOrder: row.sort_order,
    });
    categoryIdMap.set(row.id, id);
  }
  console.log(`categories: ${categories.length} upserted`);

  // items, pass 1 — bare docs so bill lines below have valid itemId targets. lastPurchase/
  // purchaseCount are backfilled in pass 2, after bills are migrated. On a re-run, an
  // upsert here would otherwise clobber the previous run's backfilled lastPurchase with
  // nothing, since this $set doesn't mention that field — but $set only ever touches the
  // fields listed, so an existing lastPurchase survives untouched until pass 2 recomputes
  // it fresh anyway.
  const items = await selectAll<SourceItem>("SELECT * FROM items");
  for (const row of items) {
    const id = await upsertByLegacyId(Item, row.id, {
      householdId: householdIdMap.get(row.household_id),
      brand: row.brand,
      brandLower: row.brand.toLowerCase(),
      name: row.name,
      nameLower: row.name.toLowerCase(),
      categoryId: row.category_id !== null ? categoryIdMap.get(row.category_id) : null,
      defaultUnit: row.default_unit,
      archived: row.archived === 1,
    });
    itemIdMap.set(row.id, id);
  }
  console.log(`items: ${items.length} upserted (pass 1, lastPurchase pending)`);

  // bills + bill_lines — bulk-fetch both tables, group lines by billId in memory. The
  // whole `lines` array is replaced on each upsert, so an edited bill's lines in Turso
  // (added/removed/changed) are fully reflected on a re-run, not merged.
  const bills = await selectAll<SourceBill>("SELECT * FROM bills");
  const billLines = await selectAll<SourceBillLine>("SELECT * FROM bill_lines");
  const linesByBillId = new Map<number, SourceBillLine[]>();
  for (const line of billLines) {
    const list = linesByBillId.get(line.bill_id) ?? [];
    list.push(line);
    linesByBillId.set(line.bill_id, list);
  }

  let linesMigrated = 0;
  for (const row of bills) {
    const lines = (linesByBillId.get(row.id) ?? []).map((line) => ({
      itemId: itemIdMap.get(line.item_id),
      quantity: line.quantity,
      unit: line.unit,
      lineTotalPaise: line.line_total_paise,
      unitPricePaise: line.unit_price_paise,
      baseQuantity: line.base_quantity,
      baseUnit: line.base_unit,
    }));

    await upsertByLegacyId(Bill, row.id, {
      householdId: householdIdMap.get(row.household_id),
      billDate: row.bill_date,
      shop: row.shop,
      shopLower: row.shop.toLowerCase(),
      paymentMethod: row.payment_method,
      statedTotalPaise: row.stated_total_paise,
      note: row.note,
      createdBy: row.created_by !== null ? (userIdMap.get(row.created_by) ?? null) : null,
      lines,
    });
    linesMigrated += lines.length;
  }
  console.log(`bills: ${bills.length} upserted, ${linesMigrated} lines`);

  // items, pass 2 — backfill lastPurchase/purchaseCount from the now-migrated bills.
  // Recomputed from scratch every run, so this is correct whether items/bills changed or not.
  const lastPurchaseByItem = await Bill.aggregate([
    { $unwind: "$lines" },
    { $sort: { billDate: -1, "lines._id": -1 } },
    {
      $group: {
        _id: "$lines.itemId",
        purchaseCount: { $sum: 1 },
        latest: { $first: "$lines" },
        latestBillDate: { $first: "$billDate" },
      },
    },
  ]);

  const bulkOps = lastPurchaseByItem.map((entry) => ({
    updateOne: {
      filter: { _id: entry._id },
      update: {
        $set: {
          purchaseCount: entry.purchaseCount,
          lastPurchase: {
            unitPricePaise: entry.latest.unitPricePaise,
            unit: entry.latest.unit,
            billDate: entry.latestBillDate,
            lineTotalPaise: entry.latest.lineTotalPaise,
            quantity: entry.latest.quantity,
          },
        },
      },
    },
  }));
  if (bulkOps.length > 0) await Item.bulkWrite(bulkOps);
  console.log(`items: lastPurchase/purchaseCount backfilled for ${bulkOps.length} items (pass 2)`);

  // Sessions are intentionally not migrated — everyone logs in again after cutover.

  console.log("\nParity summary:");
  console.log(`  households: source ${households.length} -> target ${await Household.countDocuments()}`);
  console.log(`  users:      source ${users.length} -> target ${await User.countDocuments()}`);
  console.log(`  categories: source ${categories.length} -> target ${await Category.countDocuments()}`);
  console.log(`  items:      source ${items.length} -> target ${await Item.countDocuments()}`);
  console.log(`  bills:      source ${bills.length} -> target ${await Bill.countDocuments()}`);
  console.log(`  bill lines: source ${billLines.length} -> target ${linesMigrated}`);
  console.log(
    "\nA target count higher than source for a collection means the target has documents this run didn't touch " +
      "(e.g. a legacyId-less test account, or a row deleted upstream since a previous run) — investigate before cutover.",
  );
  console.log(
    "\nSpot-check a few real bills' computed totals and price-history against the pre-migration app before cutting over.",
  );
}

await main();
await mongoose.disconnect();
source.close();
