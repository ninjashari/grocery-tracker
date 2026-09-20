import { Router } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import type { Executor } from "../db/connection.ts";
import { categories, items } from "../db/schema.ts";
import { asyncHandler, badRequest, conflict, notFound, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { categoryCreateSchema, categoryUpdateSchema } from "../../shared/schemas.ts";
import type { Category } from "../../shared/types.ts";

export const categoriesRouter = Router();

async function listCategories(executor: Executor, householdId: number): Promise<Category[]> {
  const rows = await executor
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      // Written with explicit literal table names, not interpolated column refs: Drizzle
      // renders a single-table outer query's own columns unqualified (just "id"), which
      // inside this nested subquery collides with items' own "id" column and silently
      // breaks the correlation.
      itemCount: sql<number>`(SELECT COUNT(*) FROM items WHERE items.category_id = categories.id)`,
    })
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(categories.sortOrder, categories.name);
  return rows as unknown as Category[];
}

/** Fetch a category, scoped to the household so an id from another one reads as missing. */
async function requireCategory(
  executor: Executor,
  householdId: number,
  id: number,
): Promise<{ id: number; name: string }> {
  const [row] = await executor
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)));
  if (!row) throw notFound("Category not found");
  return row;
}

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listCategories(getDb(), auth(req).householdId));
  }),
);

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const input = parseOrThrow(categoryCreateSchema, req.body);
    const db = getDb();

    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, householdId), sql`${categories.name} = ${input.name} COLLATE NOCASE`));
    if (existing) throw conflict(`You already have a category called "${input.name}"`);

    const [next] = await db
      .select({ n: sql<number>`COALESCE(MAX(${categories.sortOrder}), -1) + 1` })
      .from(categories)
      .where(eq(categories.householdId, householdId));

    const [created] = await db
      .insert(categories)
      .values({ householdId, name: input.name, sortOrder: next!.n })
      .returning({ id: categories.id });

    res.status(201).json({ id: created!.id, name: input.name, sortOrder: next!.n, itemCount: 0 } satisfies Category);
  }),
);

categoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = Number(req.params.id);
    const db = getDb();
    await requireCategory(db, householdId, id);

    const input = parseOrThrow(categoryUpdateSchema, req.body);

    if (input.name !== undefined) {
      const [clash] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.householdId, householdId),
            sql`${categories.name} = ${input.name} COLLATE NOCASE`,
            ne(categories.id, id),
          ),
        );
      if (clash) throw conflict(`You already have a category called "${input.name}"`);
      await db.update(categories).set({ name: input.name }).where(eq(categories.id, id));
    }

    if (input.sortOrder !== undefined) {
      await db.update(categories).set({ sortOrder: input.sortOrder }).where(eq(categories.id, id));
    }

    const list = await listCategories(db, householdId);
    res.json(list.find((category) => category.id === id));
  }),
);

/**
 * Deleting a category that items still use would silently null their category and lose
 * grouping, so it is refused. `?reassignTo=<id>` moves the items first, in one transaction.
 */
categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = Number(req.params.id);
    const db = getDb();
    await requireCategory(db, householdId, id);

    const [inUse] = await db.select({ n: sql<number>`COUNT(*)` }).from(items).where(eq(items.categoryId, id));

    if (inUse!.n > 0) {
      const reassignRaw = req.query["reassignTo"];
      if (reassignRaw === undefined) {
        throw badRequest(`${inUse!.n} item${inUse!.n === 1 ? "" : "s"} still use this category. Reassign them first.`);
      }

      const reassignTo = Number(reassignRaw);
      if (!Number.isInteger(reassignTo) || reassignTo === id) {
        throw badRequest("Pick a different category to move items into");
      }
      await requireCategory(db, householdId, reassignTo);

      await db.transaction(async (tx) => {
        await tx.update(items).set({ categoryId: reassignTo }).where(eq(items.categoryId, id));
        await tx.delete(categories).where(eq(categories.id, id));
      });
    } else {
      await db.delete(categories).where(eq(categories.id, id));
    }

    res.status(204).end();
  }),
);
