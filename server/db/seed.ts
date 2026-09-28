import type { ClientSession, Types } from "mongoose";
import { Category } from "./models/index.ts";

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
export async function seedCategories(householdId: Types.ObjectId, session: ClientSession): Promise<void> {
  await Category.insertMany(
    DEFAULT_CATEGORIES.map((name, index) => ({
      householdId,
      name,
      nameLower: name.toLowerCase(),
      sortOrder: index,
    })),
    { session },
  );
}
