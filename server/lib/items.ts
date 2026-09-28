import { isValidObjectId, type ClientSession } from "mongoose";
import { Category, Item } from "../db/models/index.ts";
import { conflict, notFound } from "./http.ts";
import type { Item as ItemShape } from "../../shared/types.ts";
import type { Unit } from "../../shared/units.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PopulatedCategory = { _id: { toString(): string }; name: string };

type ItemDocLike = {
  _id: { toString(): string };
  brand: string;
  name: string;
  categoryId: PopulatedCategory | { toString(): string } | null;
  defaultUnit: string;
  archived: boolean;
  lastPurchase: {
    unitPricePaise: number;
    unit: string;
    billDate: string;
    lineTotalPaise: number;
    quantity: number;
  } | null;
  purchaseCount: number;
};

function isPopulatedCategory(value: unknown): value is PopulatedCategory {
  return typeof value === "object" && value !== null && "name" in value;
}

function toItem(doc: ItemDocLike): ItemShape {
  const category = isPopulatedCategory(doc.categoryId) ? doc.categoryId : null;
  const categoryId = doc.categoryId === null ? null : category ? category._id.toString() : doc.categoryId.toString();

  return {
    id: doc._id.toString(),
    brand: doc.brand,
    name: doc.name,
    categoryId,
    categoryName: category?.name ?? null,
    defaultUnit: doc.defaultUnit as Unit,
    archived: doc.archived,
    lastUnitPricePaise: doc.lastPurchase?.unitPricePaise ?? null,
    lastUnit: (doc.lastPurchase?.unit as Unit | undefined) ?? null,
    lastPurchasedOn: doc.lastPurchase?.billDate ?? null,
    lastLineTotalPaise: doc.lastPurchase?.lineTotalPaise ?? null,
    lastQuantity: doc.lastPurchase?.quantity ?? null,
    purchaseCount: doc.purchaseCount,
  };
}

export type ItemQuery = {
  q?: string;
  categoryId?: string;
  includeArchived?: boolean;
  limit?: number;
};

export async function listItems(householdId: string, query: ItemQuery = {}): Promise<ItemShape[]> {
  const filter: Record<string, unknown> = { householdId };
  if (!query.includeArchived) filter.archived = false;
  if (query.categoryId !== undefined) filter.categoryId = query.categoryId;

  if (query.q) {
    // Match against "brand name" so typing either half, or both, finds the item.
    filter.$expr = {
      $regexMatch: { input: { $concat: ["$brand", " ", "$name"] }, regex: escapeRegex(query.q), options: "i" },
    };
  }

  const docs = await Item.find(filter)
    .sort({ nameLower: 1, brandLower: 1 })
    .limit(query.limit ?? 500)
    .populate("categoryId", "name");

  return docs.map((doc) => toItem(doc as unknown as ItemDocLike));
}

export async function getItem(householdId: string, id: string): Promise<ItemShape | null> {
  if (!isValidObjectId(id)) return null;
  const doc = await Item.findOne({ householdId, _id: id }).populate("categoryId", "name");
  return doc ? toItem(doc as unknown as ItemDocLike) : null;
}

export async function requireItem(householdId: string, id: string): Promise<ItemShape> {
  const item = await getItem(householdId, id);
  if (!item) throw notFound("Item not found");
  return item;
}

/** Throws unless the category belongs to this household (or is null). */
export async function assertCategoryInHousehold(
  householdId: string,
  categoryId: string | null,
  session?: ClientSession,
): Promise<void> {
  if (categoryId === null) return;
  const row = await Category.findOne({ _id: categoryId, householdId }).session(session ?? null);
  if (!row) throw notFound("Category not found");
}

export type NewItem = { brand: string; name: string; categoryId: string | null; defaultUnit: Unit };

/**
 * Find an existing item by (brand, name) or create it. Used by bill entry and CSV import
 * so neither has to stop and send the user to the catalog first.
 *
 * Pass `session` when this needs to be part of a transaction.
 */
export async function findOrCreateItem(
  householdId: string,
  input: NewItem,
  session?: ClientSession,
): Promise<string> {
  const brandLower = input.brand.toLowerCase();
  const nameLower = input.name.toLowerCase();

  const existing = await Item.findOne({ householdId, brandLower, nameLower }).session(session ?? null);
  if (existing) {
    // An item reappearing on a new bill is back in circulation.
    if (existing.archived) {
      existing.archived = false;
      await existing.save({ session });
    }
    return existing._id.toString();
  }

  await assertCategoryInHousehold(householdId, input.categoryId, session);

  const [created] = await Item.create(
    [
      {
        householdId,
        brand: input.brand,
        brandLower,
        name: input.name,
        nameLower,
        categoryId: input.categoryId,
        defaultUnit: input.defaultUnit,
      },
    ],
    { session },
  );

  return created!._id.toString();
}

export async function assertItemNameFree(
  householdId: string,
  brand: string,
  name: string,
  exceptId?: string,
): Promise<void> {
  const filter: Record<string, unknown> = {
    householdId,
    brandLower: brand.toLowerCase(),
    nameLower: name.toLowerCase(),
  };
  if (exceptId !== undefined) filter._id = { $ne: exceptId };

  const row = await Item.findOne(filter);
  if (row) {
    const label = brand ? `${brand} ${name}` : name;
    throw conflict(`You already have an item called "${label}"`);
  }
}
