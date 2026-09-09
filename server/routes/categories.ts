import { Router } from "express";
import { getDb, transaction } from "../db/connection.ts";
import { badRequest, conflict, notFound, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { categoryCreateSchema, categoryUpdateSchema } from "../../shared/schemas.ts";
import type { Category } from "../../shared/types.ts";

export const categoriesRouter = Router();

function listCategories(householdId: number): Category[] {
  return getDb()
    .prepare(
      `SELECT c.id,
              c.name,
              c.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) AS itemCount
         FROM categories c
        WHERE c.household_id = ?
        ORDER BY c.sort_order, c.name`,
    )
    .all(householdId) as Category[];
}

/** Fetch a category, scoped to the household so an id from another one reads as missing. */
function requireCategory(householdId: number, id: number): { id: number; name: string } {
  const row = getDb()
    .prepare("SELECT id, name FROM categories WHERE id = ? AND household_id = ?")
    .get(id, householdId) as { id: number; name: string } | undefined;
  if (!row) throw notFound("Category not found");
  return row;
}

categoriesRouter.get("/", (req, res) => {
  res.json(listCategories(auth(req).householdId));
});

categoriesRouter.post("/", (req, res) => {
  const { householdId } = auth(req);
  const input = parseOrThrow(categoryCreateSchema, req.body);
  const db = getDb();

  const existing = db
    .prepare("SELECT 1 FROM categories WHERE household_id = ? AND name = ? COLLATE NOCASE")
    .get(householdId, input.name);
  if (existing) throw conflict(`You already have a category called "${input.name}"`);

  const next = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE household_id = ?")
    .get(householdId) as { n: number };

  const created = db
    .prepare("INSERT INTO categories (household_id, name, sort_order) VALUES (?, ?, ?) RETURNING id")
    .get(householdId, input.name, next.n) as { id: number };

  res.status(201).json({ id: created.id, name: input.name, sortOrder: next.n, itemCount: 0 } satisfies Category);
});

categoriesRouter.patch("/:id", (req, res) => {
  const { householdId } = auth(req);
  const id = Number(req.params.id);
  requireCategory(householdId, id);

  const input = parseOrThrow(categoryUpdateSchema, req.body);
  const db = getDb();

  if (input.name !== undefined) {
    const clash = db
      .prepare("SELECT 1 FROM categories WHERE household_id = ? AND name = ? COLLATE NOCASE AND id <> ?")
      .get(householdId, input.name, id);
    if (clash) throw conflict(`You already have a category called "${input.name}"`);
    db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(input.name, id);
  }

  if (input.sortOrder !== undefined) {
    db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").run(input.sortOrder, id);
  }

  res.json(listCategories(householdId).find((category) => category.id === id));
});

/**
 * Deleting a category that items still use would silently null their category and lose
 * grouping, so it is refused. `?reassignTo=<id>` moves the items first, in one transaction.
 */
categoriesRouter.delete("/:id", (req, res) => {
  const { householdId } = auth(req);
  const id = Number(req.params.id);
  requireCategory(householdId, id);
  const db = getDb();

  const inUse = db.prepare("SELECT COUNT(*) AS n FROM items WHERE category_id = ?").get(id) as { n: number };

  if (inUse.n > 0) {
    const reassignRaw = req.query["reassignTo"];
    if (reassignRaw === undefined) {
      throw badRequest(
        `${inUse.n} item${inUse.n === 1 ? "" : "s"} still use this category. Reassign them first.`,
      );
    }

    const reassignTo = Number(reassignRaw);
    if (!Number.isInteger(reassignTo) || reassignTo === id) throw badRequest("Pick a different category to move items into");
    requireCategory(householdId, reassignTo);

    transaction(db, () => {
      db.prepare("UPDATE items SET category_id = ? WHERE category_id = ?").run(reassignTo, id);
      db.prepare("DELETE FROM categories WHERE id = ?").run(id);
    });
  } else {
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  }

  res.status(204).end();
});
