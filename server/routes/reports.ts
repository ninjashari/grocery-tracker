import { Router } from "express";
import { getDb } from "../db/connection.ts";
import { parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { requireItem } from "../lib/items.ts";
import { priceHistoryQuerySchema, spendQuerySchema, topItemsQuerySchema } from "../../shared/schemas.ts";
import { basePricePaise } from "../../shared/units.ts";
import type { BaseUnit } from "../../shared/units.ts";
import type { PriceHistory, PricePoint, SpendBucket, SpendReport, TopItem } from "../../shared/types.ts";

export const reportsRouter = Router();

/** Whitelist: these expressions are interpolated into SQL, so they can never be user input. */
const SPEND_GROUP_SQL = {
  month: "strftime('%Y-%m', b.bill_date)",
  category: "COALESCE(c.name, 'Uncategorised')",
  shop: "b.shop",
  paymentMethod: "b.payment_method",
} as const;

function dateFilter(from: string | undefined, to: string | undefined) {
  const where: string[] = [];
  const params: string[] = [];
  if (from) {
    where.push("b.bill_date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("b.bill_date <= ?");
    params.push(to);
  }
  return { where, params };
}

reportsRouter.get("/spend", (req, res) => {
  const { householdId } = auth(req);
  const query = parseOrThrow(spendQuerySchema, req.query);
  const { where, params } = dateFilter(query.from, query.to);
  const groupExpr = SPEND_GROUP_SQL[query.groupBy];

  const buckets = getDb()
    .prepare(
      `SELECT ${groupExpr}                        AS key,
              SUM(bl.line_total_paise)            AS totalPaise,
              COUNT(DISTINCT b.id)                AS billCount,
              COUNT(bl.id)                        AS lineCount
         FROM bill_lines bl
         JOIN bills b           ON b.id = bl.bill_id
         JOIN items i           ON i.id = bl.item_id
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE b.household_id = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}
        GROUP BY key
        ORDER BY ${query.groupBy === "month" ? "key" : "totalPaise DESC"}`,
    )
    .all(householdId, ...params) as Omit<SpendBucket, "label">[];

  const withLabels: SpendBucket[] = buckets.map((bucket) => ({
    ...bucket,
    label: query.groupBy === "month" ? monthLabel(bucket.key) : bucket.key,
  }));

  res.json({
    groupBy: query.groupBy,
    from: query.from ?? null,
    to: query.to ?? null,
    totalPaise: withLabels.reduce((sum, bucket) => sum + bucket.totalPaise, 0),
    buckets: withLabels,
  } satisfies SpendReport);
});

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  if (!year || !month) return key;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/**
 * Price history for one item, quoted per 100 g / 100 ml / pc so purchases recorded in
 * different units (1 kg vs 500 g) sit on the same curve.
 */
reportsRouter.get("/price-history", (req, res) => {
  const { householdId } = auth(req);
  const query = parseOrThrow(priceHistoryQuerySchema, req.query);
  const item = requireItem(householdId, query.itemId);

  const rows = getDb()
    .prepare(
      `SELECT b.id               AS billId,
              b.bill_date        AS billDate,
              b.shop,
              bl.quantity,
              bl.unit,
              bl.unit_price_paise AS unitPricePaise,
              bl.line_total_paise AS lineTotalPaise,
              bl.base_quantity    AS baseQuantity,
              bl.base_unit        AS baseUnit
         FROM bill_lines bl
         JOIN bills b ON b.id = bl.bill_id
        WHERE bl.item_id = ? AND b.household_id = ?
        ORDER BY b.bill_date, bl.id`,
    )
    .all(query.itemId, householdId) as Omit<PricePoint, "basePricePaise">[];

  const points: PricePoint[] = rows.flatMap((row) => {
    const price = basePricePaise(row.lineTotalPaise, row.baseQuantity, row.baseUnit);
    return price === null ? [] : [{ ...row, basePricePaise: price }];
  });

  const first = points[0]?.basePricePaise ?? null;
  const latest = points.at(-1)?.basePricePaise ?? null;
  const previous = points.length >= 2 ? points.at(-2)!.basePricePaise : null;

  res.json({
    item,
    baseUnit: (points[0]?.baseUnit as BaseUnit | undefined) ?? null,
    points,
    firstBasePricePaise: first,
    latestBasePricePaise: latest,
    changeVsFirstPct: pctChange(first, latest),
    changeVsPreviousPct: pctChange(previous, latest),
  } satisfies PriceHistory);
});

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

reportsRouter.get("/top-items", (req, res) => {
  const { householdId } = auth(req);
  const query = parseOrThrow(topItemsQuerySchema, req.query);
  const { where, params } = dateFilter(query.from, query.to);

  const rows = getDb()
    .prepare(
      `SELECT i.id                     AS itemId,
              i.brand,
              i.name                   AS itemName,
              c.name                   AS categoryName,
              SUM(bl.line_total_paise) AS totalPaise,
              SUM(bl.base_quantity)    AS totalBaseQuantity,
              bl.base_unit             AS baseUnit,
              COUNT(*)                 AS purchaseCount
         FROM bill_lines bl
         JOIN bills b           ON b.id = bl.bill_id
         JOIN items i           ON i.id = bl.item_id
         LEFT JOIN categories c ON c.id = i.category_id
        WHERE b.household_id = ?${where.length ? ` AND ${where.join(" AND ")}` : ""}
        GROUP BY i.id, bl.base_unit
        ORDER BY ${query.metric === "spend" ? "totalPaise" : "totalBaseQuantity"} DESC
        LIMIT ?`,
    )
    .all(householdId, ...params, query.limit) as TopItem[];

  res.json(rows);
});

/** Headline numbers for the dashboard: this month, last month, and all-time. */
reportsRouter.get("/summary", (req, res) => {
  const { householdId } = auth(req);
  const db = getDb();

  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(bl.line_total_paise), 0) AS totalPaise,
              COUNT(DISTINCT b.id)                  AS billCount
         FROM bills b
         LEFT JOIN bill_lines bl ON bl.bill_id = b.id
        WHERE b.household_id = ?`,
    )
    .get(householdId) as { totalPaise: number; billCount: number };

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', b.bill_date)      AS month,
              COALESCE(SUM(bl.line_total_paise), 0) AS totalPaise
         FROM bills b
         LEFT JOIN bill_lines bl ON bl.bill_id = b.id
        WHERE b.household_id = ?
        GROUP BY month
        ORDER BY month DESC
        LIMIT 2`,
    )
    .all(householdId) as { month: string; totalPaise: number }[];

  const itemCount = db
    .prepare("SELECT COUNT(*) AS n FROM items WHERE household_id = ? AND archived = 0")
    .get(householdId) as { n: number };

  res.json({
    totalPaise: totals.totalPaise,
    billCount: totals.billCount,
    itemCount: itemCount.n,
    currentMonth: byMonth[0] ?? null,
    previousMonth: byMonth[1] ?? null,
  });
});
