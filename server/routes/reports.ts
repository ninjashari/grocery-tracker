import { Router } from "express";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDb } from "../db/connection.ts";
import { billLines, bills, categories, items } from "../db/schema.ts";
import { asyncHandler, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { requireItem } from "../lib/items.ts";
import { priceHistoryQuerySchema, spendQuerySchema, topItemsQuerySchema } from "../../shared/schemas.ts";
import { basePricePaise } from "../../shared/units.ts";
import type { BaseUnit } from "../../shared/units.ts";
import type { PriceHistory, PricePoint, SpendBucket, SpendReport, TopItem } from "../../shared/types.ts";

export const reportsRouter = Router();

/** Whitelist: these expressions are interpolated into SQL, so they can never be user input. */
const SPEND_GROUP_SQL = {
  month: sql`strftime('%Y-%m', ${bills.billDate})`,
  category: sql`COALESCE(${categories.name}, 'Uncategorised')`,
  shop: bills.shop,
  paymentMethod: bills.paymentMethod,
} as const;

function dateConditions(from: string | undefined, to: string | undefined) {
  const conditions = [];
  if (from) conditions.push(gte(bills.billDate, from));
  if (to) conditions.push(lte(bills.billDate, to));
  return conditions;
}

reportsRouter.get(
  "/spend",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(spendQuerySchema, req.query);
    const groupExpr = SPEND_GROUP_SQL[query.groupBy];
    const totalPaiseExpr = sql<number>`SUM(${billLines.lineTotalPaise})`;

    // Drizzle doesn't emit SQL-level aliases for raw `sql` select fields, so ORDER BY must
    // reuse the actual expression — an alias like `ORDER BY key` would reference a column
    // that doesn't exist in the generated SQL.
    const buckets = await getDb()
      .select({
        key: groupExpr,
        totalPaise: totalPaiseExpr,
        billCount: sql<number>`COUNT(DISTINCT ${bills.id})`,
        lineCount: sql<number>`COUNT(${billLines.id})`,
      })
      .from(billLines)
      .innerJoin(bills, eq(bills.id, billLines.billId))
      .innerJoin(items, eq(items.id, billLines.itemId))
      .leftJoin(categories, eq(categories.id, items.categoryId))
      .where(and(eq(bills.householdId, householdId), ...dateConditions(query.from, query.to)))
      .groupBy(groupExpr)
      .orderBy(query.groupBy === "month" ? groupExpr : sql`${totalPaiseExpr} DESC`);

    const withLabels: SpendBucket[] = (buckets as unknown as Omit<SpendBucket, "label">[]).map((bucket) => ({
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
  }),
);

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
reportsRouter.get(
  "/price-history",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(priceHistoryQuerySchema, req.query);
    const db = getDb();
    const item = await requireItem(db, householdId, query.itemId);

    const rows = await db
      .select({
        billId: bills.id,
        billDate: bills.billDate,
        shop: bills.shop,
        quantity: billLines.quantity,
        unit: billLines.unit,
        unitPricePaise: billLines.unitPricePaise,
        lineTotalPaise: billLines.lineTotalPaise,
        baseQuantity: billLines.baseQuantity,
        baseUnit: billLines.baseUnit,
      })
      .from(billLines)
      .innerJoin(bills, eq(bills.id, billLines.billId))
      .where(and(eq(billLines.itemId, query.itemId), eq(bills.householdId, householdId)))
      .orderBy(bills.billDate, billLines.id);

    const points: PricePoint[] = (rows as unknown as Omit<PricePoint, "basePricePaise">[]).flatMap((row) => {
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
  }),
);

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

reportsRouter.get(
  "/top-items",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(topItemsQuerySchema, req.query);

    const rows = await getDb()
      .select({
        itemId: items.id,
        brand: items.brand,
        itemName: items.name,
        categoryName: categories.name,
        totalPaise: sql<number>`SUM(${billLines.lineTotalPaise})`,
        totalBaseQuantity: sql<number>`SUM(${billLines.baseQuantity})`,
        baseUnit: billLines.baseUnit,
        purchaseCount: sql<number>`COUNT(*)`,
      })
      .from(billLines)
      .innerJoin(bills, eq(bills.id, billLines.billId))
      .innerJoin(items, eq(items.id, billLines.itemId))
      .leftJoin(categories, eq(categories.id, items.categoryId))
      .where(and(eq(bills.householdId, householdId), ...dateConditions(query.from, query.to)))
      .groupBy(items.id, billLines.baseUnit)
      .orderBy(
        query.metric === "spend"
          ? sql`SUM(${billLines.lineTotalPaise}) DESC`
          : sql`SUM(${billLines.baseQuantity}) DESC`,
      )
      .limit(query.limit);

    res.json(rows as unknown as TopItem[]);
  }),
);

/** Headline numbers for the dashboard: this month, last month, and all-time. */
reportsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const db = getDb();

    const [totals] = await db
      .select({
        totalPaise: sql<number>`COALESCE(SUM(${billLines.lineTotalPaise}), 0)`,
        billCount: sql<number>`COUNT(DISTINCT ${bills.id})`,
      })
      .from(bills)
      .leftJoin(billLines, eq(billLines.billId, bills.id))
      .where(eq(bills.householdId, householdId));

    const monthExpr = sql<string>`strftime('%Y-%m', ${bills.billDate})`;
    const byMonth = await db
      .select({
        month: monthExpr,
        totalPaise: sql<number>`COALESCE(SUM(${billLines.lineTotalPaise}), 0)`,
      })
      .from(bills)
      .leftJoin(billLines, eq(billLines.billId, bills.id))
      .where(eq(bills.householdId, householdId))
      .groupBy(monthExpr)
      .orderBy(sql`${monthExpr} DESC`)
      .limit(2);

    const [itemCount] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(items)
      .where(and(eq(items.householdId, householdId), eq(items.archived, 0)));

    res.json({
      totalPaise: totals!.totalPaise,
      billCount: totals!.billCount,
      itemCount: itemCount!.n,
      currentMonth: byMonth[0] ?? null,
      previousMonth: byMonth[1] ?? null,
    });
  }),
);
