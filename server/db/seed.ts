import type { Executor } from "./connection.ts";
import { categories } from "./schema.ts";

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
export async function seedCategories(executor: Executor, householdId: number): Promise<void> {
  await executor
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((name, index) => ({ householdId, name, sortOrder: index })));
}
