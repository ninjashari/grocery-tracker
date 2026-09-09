import { z } from "zod";
import { UNITS } from "./units.ts";

/** One definition per shape, used by the server to validate and the client to type forms. */

export const PAYMENT_METHODS = ["Cash", "Card", "UPI", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date");

const paise = z.number().int("Amount must be a whole number of paise").min(0, "Amount cannot be negative");

const trimmed = (max: number) => z.string().trim().max(max);

/* ---------------------------------- auth ---------------------------------- */

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: trimmed(80).min(1, "Name is required"),
  householdName: trimmed(80).min(1, "Household name is required"),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  name: trimmed(80).min(1, "Name is required"),
});

/* -------------------------------- categories ------------------------------- */

export const categoryCreateSchema = z.object({
  name: trimmed(60).min(1, "Category name is required"),
});

export const categoryUpdateSchema = z.object({
  name: trimmed(60).min(1, "Category name is required").optional(),
  sortOrder: z.number().int().optional(),
});

/* ---------------------------------- items ---------------------------------- */

export const itemCreateSchema = z.object({
  brand: trimmed(80).default(""),
  name: trimmed(120).min(1, "Item name is required"),
  categoryId: z.number().int().positive().nullable().default(null),
  defaultUnit: z.enum(UNITS).default("pcs"),
});

export const itemUpdateSchema = z.object({
  brand: trimmed(80).optional(),
  name: trimmed(120).min(1, "Item name is required").optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  defaultUnit: z.enum(UNITS).optional(),
  archived: z.boolean().optional(),
});

/* ---------------------------------- bills ---------------------------------- */

/**
 * A line references an existing item by id, or carries a `newItem` payload so bill entry
 * never has to break flow to go create the item first. Exactly one of the two.
 */
export const billLineInputSchema = z
  .object({
    itemId: z.number().int().positive().optional(),
    newItem: itemCreateSchema.optional(),
    quantity: z.number().positive("Quantity must be greater than zero").max(1_000_000),
    unit: z.enum(UNITS),
    unitPricePaise: paise,
  })
  .refine((line) => (line.itemId == null) !== (line.newItem == null), {
    message: "Each line needs either an existing item or a new item, not both",
    path: ["itemId"],
  });

export const billInputSchema = z.object({
  billDate: isoDate,
  shop: trimmed(100).min(1, "Shop is required"),
  paymentMethod: z.enum(PAYMENT_METHODS),
  statedTotalPaise: paise.nullable().default(null),
  note: trimmed(500).default(""),
  lines: z.array(billLineInputSchema).min(1, "A bill needs at least one line"),
});

export const billQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  shop: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/* --------------------------------- reports --------------------------------- */

export const SPEND_GROUPINGS = ["month", "category", "shop", "paymentMethod"] as const;
export type SpendGrouping = (typeof SPEND_GROUPINGS)[number];

export const spendQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.enum(SPEND_GROUPINGS).default("month"),
});

export const priceHistoryQuerySchema = z.object({
  itemId: z.coerce.number().int().positive(),
});

export const topItemsQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  metric: z.enum(["spend", "quantity"]).default("spend"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/* ------------------------------- import/export ------------------------------ */

export const importCommitSchema = z.object({
  csv: z.string().min(1, "CSV content is required"),
  /** The client echoes this back after reviewing the dry run, so nothing is written blind. */
  confirm: z.literal(true),
});

/* ---------------------------------- types ---------------------------------- */

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type BillLineInput = z.infer<typeof billLineInputSchema>;
export type BillInput = z.infer<typeof billInputSchema>;
