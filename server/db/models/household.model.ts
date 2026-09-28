import { Schema, model, type InferSchemaType } from "mongoose";

const householdSchema = new Schema(
  {
    name: { type: String, required: true },
    // Migration/debugging aid only — the source SQLite row's integer id. Not read by
    // app code; dropped in a follow-up cleanup once the Mongo cutover is stable.
    legacyId: { type: Number, index: true, sparse: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type HouseholdDoc = InferSchemaType<typeof householdSchema>;
export const Household = model("Household", householdSchema);
