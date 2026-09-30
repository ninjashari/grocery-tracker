import { Schema, model, type InferSchemaType } from "mongoose";

const lastPurchaseSchema = new Schema(
  {
    unitPricePaise: { type: Number, required: true },
    unit: { type: String, required: true },
    billDate: { type: String, required: true },
    lineTotalPaise: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

const itemSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true, index: true },
    // Not `required`: an empty string is a valid, common value here (many items have no
    // brand) — Mongoose's built-in `required` validator treats "" as absent for strings.
    brand: { type: String, default: "" },
    brandLower: { type: String, default: "" },
    name: { type: String, required: true },
    nameLower: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null, index: true },
    defaultUnit: { type: String, required: true, default: "pcs" },
    // Package size in `defaultUnit`'s terms, e.g. defaultUnit "ml" + packSize 500 = "500 ml".
    // Catalog-level (unlike the per-purchase baseQuantity on bill lines) so it can be shown
    // next to brand when comparing prices across differently-sized packages.
    packSize: { type: Number, default: null },
    archived: { type: Boolean, required: true, default: false },
    legacyId: { type: Number, index: true, sparse: true },
    // Denormalized so `listItems` (bill entry's most common read) is a plain find() —
    // this replaces the old ROW_NUMBER() OVER (PARTITION BY ...) window query, which was
    // the slowest query in the app. Kept in sync from saveBill/csvImport whenever a bill
    // line for this item is written; treated as prefill convenience, not the ledger of
    // truth (the bills collection is authoritative).
    lastPurchase: { type: lastPurchaseSchema, default: null },
    purchaseCount: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

itemSchema.index({ householdId: 1, brandLower: 1, nameLower: 1 }, { unique: true });
itemSchema.index({ householdId: 1, nameLower: 1 });

export type ItemDoc = InferSchemaType<typeof itemSchema>;
export const Item = model("Item", itemSchema);
