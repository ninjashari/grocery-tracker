import { Router } from "express";
import { getDb } from "../db/connection.ts";
import { parseOrThrow } from "../lib/http.ts";
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

itemsRouter.get("/", (req, res) => {
  const { householdId } = auth(req);
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : undefined;
  const categoryRaw = req.query["categoryId"];
  const categoryId = typeof categoryRaw === "string" && categoryRaw !== "" ? Number(categoryRaw) : undefined;

  res.json(
    listItems(householdId, {
      ...(q ? { q } : {}),
      ...(Number.isInteger(categoryId) ? { categoryId: categoryId as number } : {}),
      includeArchived: req.query["includeArchived"] === "true",
    }),
  );
});

/** Distinct shop names seen so far, for the shop autocomplete on bill entry. */
itemsRouter.get("/shops", (req, res) => {
  const { householdId } = auth(req);
  const rows = getDb()
    .prepare(
      `SELECT shop, COUNT(*) AS billCount, MAX(bill_date) AS lastUsed
         FROM bills
        WHERE household_id = ?
        GROUP BY shop COLLATE NOCASE
        ORDER BY lastUsed DESC, billCount DESC`,
    )
    .all(householdId);
  res.json(rows);
});

itemsRouter.get("/:id", (req, res) => {
  res.json(requireItem(auth(req).householdId, Number(req.params.id)));
});

itemsRouter.post("/", (req, res) => {
  const { householdId } = auth(req);
  const input = parseOrThrow(itemCreateSchema, req.body);

  assertItemNameFree(householdId, input.brand, input.name);
  assertCategoryInHousehold(householdId, input.categoryId);

  const created = getDb()
    .prepare(
      "INSERT INTO items (household_id, brand, name, category_id, default_unit) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .get(householdId, input.brand, input.name, input.categoryId, input.defaultUnit) as { id: number };

  res.status(201).json(getItem(householdId, created.id));
});

itemsRouter.patch("/:id", (req, res) => {
  const { householdId } = auth(req);
  const id = Number(req.params.id);
  const current = requireItem(householdId, id);
  const input = parseOrThrow(itemUpdateSchema, req.body);

  const brand = input.brand ?? current.brand;
  const name = input.name ?? current.name;
  if (brand !== current.brand || name !== current.name) {
    assertItemNameFree(householdId, brand, name, id);
  }
  if (input.categoryId !== undefined) assertCategoryInHousehold(householdId, input.categoryId);

  getDb()
    .prepare(
      `UPDATE items
          SET brand = ?, name = ?, category_id = ?, default_unit = ?, archived = ?
        WHERE id = ?`,
    )
    .run(
      brand,
      name,
      input.categoryId !== undefined ? input.categoryId : current.categoryId,
      input.defaultUnit ?? current.defaultUnit,
      (input.archived ?? current.archived) ? 1 : 0,
      id,
    );

  res.json(getItem(householdId, id));
});

/**
 * Deleting an item that appears on past bills would rewrite spending history, so those are
 * archived instead — hidden from pickers, still counted in reports. Unused items are
 * removed outright.
 */
itemsRouter.delete("/:id", (req, res) => {
  const { householdId } = auth(req);
  const id = Number(req.params.id);
  requireItem(householdId, id);
  const db = getDb();

  const used = db.prepare("SELECT COUNT(*) AS n FROM bill_lines WHERE item_id = ?").get(id) as { n: number };

  if (used.n > 0) {
    db.prepare("UPDATE items SET archived = 1 WHERE id = ?").run(id);
    res.json({ archived: true, item: getItem(householdId, id) });
    return;
  }

  db.prepare("DELETE FROM items WHERE id = ?").run(id);
  res.status(204).end();
});
