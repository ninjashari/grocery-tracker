import type { Db } from "./connection.ts";

/** Starting point for a new household. Fully editable afterwards. */
export const DEFAULT_CATEGORIES = [
  "Produce",
  "Dairy",
  "Bakery",
  "Grains & Pulses",
  "Meat & Fish",
  "Snacks",
  "Beverages",
  "Spices & Condiments",
  "Frozen",
  "Household",
  "Personal Care",
  "Other",
] as const;

/** Must run inside the same transaction that created the household. */
export function seedCategories(db: Db, householdId: number): void {
  const insert = db.prepare(
    "INSERT INTO categories (household_id, name, sort_order) VALUES (?, ?, ?)",
  );
  DEFAULT_CATEGORIES.forEach((name, index) => {
    insert.run(householdId, name, index);
  });
}
