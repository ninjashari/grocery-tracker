import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import { billLines, bills, items } from "../db/schema.ts";
import { asyncHandler, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import {
  assertCategoryInHousehold,
  assertItemNameFree,
  getItem,
  listItems,
  requireItem,
} from "../lib/items.ts";
import { itemCreateSchema, itemUpdateSchema } from "../../shared/schemas.ts";

export const itemsRouter = Router();

itemsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : undefined;
    const categoryRaw = req.query["categoryId"];
    const categoryId = typeof categoryRaw === "string" && categoryRaw !== "" ? Number(categoryRaw) : undefined;

    res.json(
      await listItems(getDb(), householdId, {
        ...(q ? { q } : {}),
        ...(Number.isInteger(categoryId) ? { categoryId: categoryId as number } : {}),
        includeArchived: req.query["includeArchived"] === "true",
      }),
    );
  }),
);

/** Distinct shop names seen so far, for the shop autocomplete on bill entry. */
itemsRouter.get(
  "/shops",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const billCountExpr = sql<number>`COUNT(*)`;
    const lastUsedExpr = sql<string>`MAX(${bills.billDate})`;
    const rows = await getDb()
      .select({
        shop: bills.shop,
        billCount: billCountExpr,
        lastUsed: lastUsedExpr,
      })
      .from(bills)
      .where(eq(bills.householdId, householdId))
      .groupBy(sql`${bills.shop} COLLATE NOCASE`)
      .orderBy(sql`${lastUsedExpr} DESC`, sql`${billCountExpr} DESC`);
    res.json(rows);
  }),
);

itemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await requireItem(getDb(), auth(req).householdId, Number(req.params.id)));
  }),
);

itemsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const input = parseOrThrow(itemCreateSchema, req.body);
    const db = getDb();

    await assertItemNameFree(db, householdId, input.brand, input.name);
    await assertCategoryInHousehold(db, householdId, input.categoryId);

    const [created] = await db
      .insert(items)
      .values({
        householdId,
        brand: input.brand,
        name: input.name,
        categoryId: input.categoryId,
        defaultUnit: input.defaultUnit,
      })
      .returning({ id: items.id });

    res.status(201).json(await getItem(db, householdId, created!.id));
  }),
);

itemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = Number(req.params.id);
    const db = getDb();
    const current = await requireItem(db, householdId, id);
    const input = parseOrThrow(itemUpdateSchema, req.body);

    const brand = input.brand ?? current.brand;
    const name = input.name ?? current.name;
    if (brand !== current.brand || name !== current.name) {
      await assertItemNameFree(db, householdId, brand, name, id);
    }
    if (input.categoryId !== undefined) await assertCategoryInHousehold(db, householdId, input.categoryId);

    await db
      .update(items)
      .set({
        brand,
        name,
        categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
        defaultUnit: input.defaultUnit ?? current.defaultUnit,
        archived: (input.archived ?? current.archived) ? 1 : 0,
      })
      .where(eq(items.id, id));

    res.json(await getItem(db, householdId, id));
  }),
);

/**
 * Deleting an item that appears on past bills would rewrite spending history, so those are
 * archived instead — hidden from pickers, still counted in reports. Unused items are
 * removed outright.
 */
itemsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = Number(req.params.id);
    const db = getDb();
    await requireItem(db, householdId, id);

    const [used] = await db.select({ n: sql<number>`COUNT(*)` }).from(billLines).where(eq(billLines.itemId, id));

    if (used!.n > 0) {
      await db.update(items).set({ archived: 1 }).where(eq(items.id, id));
      res.json({ archived: true, item: await getItem(db, householdId, id) });
      return;
    }

    await db.delete(items).where(eq(items.id, id));
    res.status(204).end();
  }),
);
