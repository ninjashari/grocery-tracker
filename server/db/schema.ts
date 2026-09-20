import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

export const households = sqliteTable("households", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_household_idx").on(table.householdId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [unique("categories_household_name_unique").on(table.householdId, table.name)],
);

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    brand: text("brand").notNull().default(""),
    name: text("name").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    defaultUnit: text("default_unit").notNull().default("pcs"),
    archived: integer("archived").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    unique("items_household_brand_name_unique").on(table.householdId, table.brand, table.name),
    index("items_household_name_idx").on(table.householdId, table.name),
    index("items_category_idx").on(table.categoryId),
  ],
);

export const bills = sqliteTable(
  "bills",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    householdId: integer("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    billDate: text("bill_date").notNull(),
    shop: text("shop").notNull(),
    paymentMethod: text("payment_method").notNull().default("Cash"),
    // What the printed receipt said. Null when not recorded. Compared against the sum of
    // lines to surface data-entry slips, but never enforced: real receipts have discounts.
    statedTotalPaise: integer("stated_total_paise"),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    // drizzle-kit's SQLite push doesn't correctly generate DESC index columns from a raw
    // `sql` fragment here, so this is ascending — SQLite can still scan it backwards for
    // an `ORDER BY bill_date DESC` at negligible cost over this app's data volumes.
    index("bills_household_date_idx").on(table.householdId, table.billDate),
    index("bills_shop_idx").on(table.householdId, table.shop),
  ],
);

export const billLines = sqliteTable(
  "bill_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    billId: integer("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
    unit: text("unit").notNull(),
    // Authoritative: what's entered and stored, exactly as printed on the receipt. The
    // app computes this, never the DB — a receipt's total rarely divides evenly by
    // quantity into a clean per-unit rate.
    lineTotalPaise: integer("line_total_paise").notNull(),
    // Derived (total / quantity, rounded) by the app for prefill/display/CSV export.
    // Never itself the source of a stored total.
    unitPricePaise: integer("unit_price_paise").notNull(),
    // Quantity restated in a base unit (g / ml / pcs) so 1 kg and 500 g are comparable.
    baseQuantity: real("base_quantity").notNull(),
    baseUnit: text("base_unit").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("bill_lines_bill_idx").on(table.billId),
    index("bill_lines_item_idx").on(table.itemId),
    check("bill_lines_quantity_positive", sql`${table.quantity} > 0`),
    check("bill_lines_line_total_non_negative", sql`${table.lineTotalPaise} >= 0`),
    check("bill_lines_unit_price_non_negative", sql`${table.unitPricePaise} >= 0`),
    check("bill_lines_base_quantity_positive", sql`${table.baseQuantity} > 0`),
  ],
);

export type Household = typeof households.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type BillRow = typeof bills.$inferSelect;
export type BillLineRow = typeof billLines.$inferSelect;
