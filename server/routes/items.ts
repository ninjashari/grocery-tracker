import { Router } from "express";
import { isValidObjectId, Types } from "mongoose";
import { Bill, Item } from "../db/models/index.ts";
import { asyncHandler, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import {
  assertCategoryInHousehold,
  assertItemNameFree,
  escapeRegex,
  getItem,
  listItems,
  requireItem,
} from "../lib/items.ts";
import { listBillLinesForItem } from "../lib/bills.ts";
import { itemCreateSchema, itemUpdateSchema } from "../../shared/schemas.ts";

export const itemsRouter = Router();

itemsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : undefined;
    const categoryId = typeof req.query["categoryId"] === "string" ? req.query["categoryId"] : undefined;

    res.json(
      await listItems(householdId, {
        ...(q ? { q } : {}),
        ...(categoryId ? { categoryId } : {}),
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
    const rows = await Bill.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId) } },
      {
        $group: {
          _id: "$shopLower",
          shop: { $first: "$shop" },
          billCount: { $sum: 1 },
          lastUsed: { $max: "$billDate" },
        },
      },
      { $sort: { lastUsed: -1, billCount: -1 } },
      { $project: { shop: 1, billCount: 1, lastUsed: 1, _id: 0 } },
    ]);
    res.json(rows);
  }),
);

/** Distinct item names (irrespective of brand), for the all-brand comparison page's
 * name-only picker — unlike "/" this never exposes brand, since picking a name there is
 * meant to be brand-agnostic. */
itemsRouter.get(
  "/names",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : undefined;

    const rows = await Item.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId), archived: false } },
      ...(q ? [{ $match: { nameLower: { $regex: escapeRegex(q.toLowerCase()) } } }] : []),
      {
        $group: {
          _id: "$nameLower",
          name: { $first: "$name" },
          purchaseCount: { $sum: "$purchaseCount" },
        },
      },
      { $match: { purchaseCount: { $gt: 1 } } },
      { $sort: { name: 1 } },
      { $project: { name: 1, purchaseCount: 1, _id: 0 } },
    ]);
    res.json(rows);
  }),
);

itemsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await requireItem(auth(req).householdId, String(req.params.id)));
  }),
);

/** Every purchase of this item across all bills, newest first. */
itemsRouter.get(
  "/:id/bills",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = String(req.params.id);
    await requireItem(householdId, id);
    res.json(await listBillLinesForItem(householdId, id));
  }),
);

itemsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const input = parseOrThrow(itemCreateSchema, req.body);

    await assertItemNameFree(householdId, input.brand, input.name);
    await assertCategoryInHousehold(householdId, input.categoryId);

    const created = await Item.create({
      householdId,
      brand: input.brand,
      brandLower: input.brand.toLowerCase(),
      name: input.name,
      nameLower: input.name.toLowerCase(),
      categoryId: input.categoryId,
      defaultUnit: input.defaultUnit,
      packSize: input.packSize,
    });

    res.status(201).json(await getItem(householdId, created._id.toString()));
  }),
);

itemsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const id = String(req.params.id);
    const current = await requireItem(householdId, id);
    const input = parseOrThrow(itemUpdateSchema, req.body);

    const brand = input.brand ?? current.brand;
    const name = input.name ?? current.name;
    if (brand !== current.brand || name !== current.name) {
      await assertItemNameFree(householdId, brand, name, id);
    }
    if (input.categoryId !== undefined) await assertCategoryInHousehold(householdId, input.categoryId);

    await Item.updateOne(
      { _id: id },
      {
        $set: {
          brand,
          brandLower: brand.toLowerCase(),
          name,
          nameLower: name.toLowerCase(),
          categoryId: input.categoryId !== undefined ? input.categoryId : current.categoryId,
          defaultUnit: input.defaultUnit ?? current.defaultUnit,
          packSize: input.packSize !== undefined ? input.packSize : current.packSize,
          archived: input.archived ?? current.archived,
        },
      },
    );

    res.json(await getItem(householdId, id));
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
    const id = String(req.params.id);
    await requireItem(householdId, id);

    const used = isValidObjectId(id) ? await Bill.exists({ "lines.itemId": id }) : null;

    if (used) {
      await Item.updateOne({ _id: id }, { $set: { archived: true } });
      res.json({ archived: true, item: await getItem(householdId, id) });
      return;
    }

    await Item.deleteOne({ _id: id });
    res.status(204).end();
  }),
);
