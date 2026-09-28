import { Schema, model, type InferSchemaType } from "mongoose";

const categorySchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true, index: true },
    name: { type: String, required: true },
    // Shadow field for case-insensitive matching/uniqueness — replaces SQLite's
    // `COLLATE NOCASE`, which Mongo has no drop-in equivalent for.
    nameLower: { type: String, required: true },
    sortOrder: { type: Number, required: true, default: 0 },
    legacyId: { type: Number, index: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

categorySchema.index({ householdId: 1, nameLower: 1 }, { unique: true });

export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export const Category = model("Category", categorySchema);
