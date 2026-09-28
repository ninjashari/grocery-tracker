import { Router } from "express";
import { isValidObjectId } from "mongoose";
import { withTransaction } from "../db/connection.ts";
import { Category, Item } from "../db/models/index.ts";
import { asyncHandler, badRequest, conflict, notFound, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { categoryCreateSchema, categoryUpdateSchema } from "../../shared/schemas.ts";
import type { Category as CategoryShape } from "../../shared/types.ts";

export const categoriesRouter = Router();

async function listCategories(householdId: string): Promise<CategoryShape[]> {
  const docs = await Category.find({ householdId }).sort({ sortOrder: 1, name: 1 });
  const counts = await Promise.all(docs.map((doc) => Item.countDocuments({ categoryId: doc._id })));
  return docs.map((doc, index) => ({
    id: doc._id.toString(),
    name: doc.name,
    sortOrder: doc.sortOrder,
    itemCount: counts[index]!,
  }));
}

/** Fetch a category, scoped to the household so an id from another one reads as missing. */
async function requireCategory(householdId: string, id: string): Promise<{ id: string; name: string }> {
  if (!isValidObjectId(id)) throw notFound("Category not found");
  const row = await Category.findOne({ _id: id, householdId });
  if (!row) throw notFound("Category not found");
  return { id: row._id.toString(), name: row.name };
}

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listCategories(auth(req).householdId));
  }),
);

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const input = parseOrThrow(categoryCreateSchema, req.body);
    const nameLower = input.name.toLowerCase();

    const existing = await Category.findOne({ householdId, nameLower });
    if (existing) throw conflict(`You already have a category called "${input.name}"`);

    const top = await Category.findOne({ householdId }).sort({ sortOrder: -1 });
    const sortOrder = top ? top.sortOrder + 1 : 0;

    const created = await Category.create({ householdId, name: input.name, nameLower, sortOrder });

    res.status(201).json({
      id: created._id.toString(),
      name: input.name,
      sortOrder,
      itemCount: 0,
    } satisfies CategoryShape);
  }),
);

categoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = String(req.params.id);
    await requireCategory(householdId, id);

    const input = parseOrThrow(categoryUpdateSchema, req.body);

    if (input.name !== undefined) {
      const nameLower = input.name.toLowerCase();
      const clash = await Category.findOne({ householdId, nameLower, _id: { $ne: id } });
      if (clash) throw conflict(`You already have a category called "${input.name}"`);
      await Category.updateOne({ _id: id }, { $set: { name: input.name, nameLower } });
    }

    if (input.sortOrder !== undefined) {
      await Category.updateOne({ _id: id }, { $set: { sortOrder: input.sortOrder } });
    }

    const list = await listCategories(householdId);
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
    const id = String(req.params.id);
    await requireCategory(householdId, id);

    const inUse = await Item.countDocuments({ categoryId: id });

    if (inUse > 0) {
      const reassignTo = req.query["reassignTo"];
      if (typeof reassignTo !== "string") {
        throw badRequest(`${inUse} item${inUse === 1 ? "" : "s"} still use this category. Reassign them first.`);
      }
      if (reassignTo === id) throw badRequest("Pick a different category to move items into");
      await requireCategory(householdId, reassignTo);

      await withTransaction(async (session) => {
        await Item.updateMany({ categoryId: id }, { $set: { categoryId: reassignTo } }, { session });
        await Category.deleteOne({ _id: id }, { session });
      });
    } else {
      await Category.deleteOne({ _id: id });
    }

    res.status(204).end();
  }),
);
