import { Schema, model, type InferSchemaType } from "mongoose";

const sessionSchema = new Schema(
  {
    // The session token itself, reused as the Mongo _id — it's already the natural
    // primary key, exactly like the old `sessions.id text PRIMARY KEY`.
    _id: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, _id: false },
);

// TTL index: Mongo reaps a document once its clock passes the value in `expiresAt`
// (expireAfterSeconds: 0 means "expire exactly at the time stored in the field"). This
// replaces the old `purgeExpiredSessions()` manual sweep entirely.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const Session = model("Session", sessionSchema);
