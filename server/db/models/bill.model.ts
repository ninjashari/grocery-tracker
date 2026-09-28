import { Schema, model, type InferSchemaType } from "mongoose";

const positive = (label: string) => (value: number) => {
  if (!(value > 0)) throw new Error(`${label} must be greater than zero`);
  return true;
};

const nonNegative = (label: string) => (value: number) => {
  if (!(value >= 0)) throw new Error(`${label} cannot be negative`);
  return true;
};

/**
 * Embedded, not a separate collection: a bill's lines are always read and written as a
 * unit with their parent bill (saveBill's replace-all-lines semantics, getBill's always-
 * join), and are queried independently across bills in exactly two report paths, both of
 * which become $unwind aggregations. Embedding also means the bill+lines write is a
 * single atomic document write with no transaction needed for that part.
 */
const billLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true, index: true },
    quantity: {
      type: Number,
      required: true,
      validate: { validator: positive("quantity"), message: "quantity must be greater than zero" },
    },
    unit: { type: String, required: true },
    // Authoritative: what's entered and stored, exactly as printed on the receipt.
    lineTotalPaise: {
      type: Number,
      required: true,
      validate: { validator: nonNegative("lineTotalPaise"), message: "lineTotalPaise cannot be negative" },
    },
    // Derived (total / quantity, rounded) for prefill/display/CSV only.
    unitPricePaise: {
      type: Number,
      required: true,
      validate: { validator: nonNegative("unitPricePaise"), message: "unitPricePaise cannot be negative" },
    },
    baseQuantity: {
      type: Number,
      required: true,
      validate: { validator: positive("baseQuantity"), message: "baseQuantity must be greater than zero" },
    },
    baseUnit: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const billSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true, index: true },
    // Kept as an opaque YYYY-MM-DD string, not a real Date: the app already treats it as
    // a sortable/comparable string for range filters and month-bucketing, and a real
    // Date would force timezone handling the current code doesn't have.
    billDate: { type: String, required: true },
    shop: { type: String, required: true },
    shopLower: { type: String, required: true },
    paymentMethod: { type: String, required: true, default: "Cash" },
    statedTotalPaise: { type: Number, default: null },
    // Not `required`: "" (no note) is the common case, and Mongoose's `required`
    // validator treats an empty string as absent.
    note: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    legacyId: { type: Number, index: true, sparse: true },
    lines: { type: [billLineSchema], required: true, default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

billSchema.index({ householdId: 1, billDate: -1 });
billSchema.index({ householdId: 1, shopLower: 1 });

export type BillDoc = InferSchemaType<typeof billSchema>;
export const Bill = model("Bill", billSchema);
