import { Router } from "express";
import { Types } from "mongoose";
import { Bill, Item } from "../db/models/index.ts";
import { asyncHandler, parseOrThrow } from "../lib/http.ts";
import { auth } from "../middleware/auth.ts";
import { requireItem } from "../lib/items.ts";
import {
  priceHistoryByNameQuerySchema,
  priceHistoryQuerySchema,
  spendQuerySchema,
  topItemsQuerySchema,
  type SpendGrouping,
} from "../../shared/schemas.ts";
import { basePricePaise } from "../../shared/units.ts";
import type { BaseUnit } from "../../shared/units.ts";
import type {
  PriceHistory,
  PriceHistoryByName,
  PricePoint,
  PricePointWithBrand,
  SpendBucket,
  SpendReport,
  TopItem,
} from "../../shared/types.ts";

export const reportsRouter = Router();

const MONTH_KEY_EXPR = { $substrCP: ["$billDate", 0, 7] };

/** Whitelist: these expressions build the aggregation $group key, so they can never be
 * user input. */
const SPEND_GROUP_KEY: Record<SpendGrouping, unknown> = {
  month: MONTH_KEY_EXPR,
  category: "$categoryName",
  shop: "$shop",
  paymentMethod: "$paymentMethod",
};

function dateMatch(from: string | undefined, to: string | undefined): Record<string, unknown> {
  if (!from && !to) return {};
  return { billDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  if (!year || !month) return key;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

reportsRouter.get(
  "/spend",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(spendQuerySchema, req.query);

    const buckets = await Bill.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId), ...dateMatch(query.from, query.to) } },
      { $unwind: "$lines" },
      { $lookup: { from: "items", localField: "lines.itemId", foreignField: "_id", as: "item" } },
      { $unwind: "$item" },
      ...(query.categoryId !== undefined
        ? [{ $match: { "item.categoryId": new Types.ObjectId(query.categoryId) } }]
        : []),
      { $lookup: { from: "categories", localField: "item.categoryId", foreignField: "_id", as: "category" } },
      {
        $addFields: {
          categoryName: { $ifNull: [{ $arrayElemAt: ["$category.name", 0] }, "Uncategorised"] },
        },
      },
      {
        $group: {
          _id: SPEND_GROUP_KEY[query.groupBy],
          totalPaise: { $sum: "$lines.lineTotalPaise" },
          billIds: { $addToSet: "$_id" },
          lineCount: { $sum: 1 },
        },
      },
      {
        $project: {
          key: "$_id",
          totalPaise: 1,
          billCount: { $size: "$billIds" },
          lineCount: 1,
          _id: 0,
        },
      },
      { $sort: query.groupBy === "month" ? { key: 1 } : { totalPaise: -1 } },
    ]);

    const withLabels: SpendBucket[] = (buckets as Omit<SpendBucket, "label">[]).map((bucket) => ({
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

/**
 * Price history for one item, quoted per 100 g / 100 ml / pc so purchases recorded in
 * different units (1 kg vs 500 g) sit on the same curve.
 */
reportsRouter.get(
  "/price-history",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(priceHistoryQuerySchema, req.query);
    const item = await requireItem(householdId, query.itemId);

    const rows = await Bill.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId) } },
      { $unwind: "$lines" },
      { $match: { "lines.itemId": new Types.ObjectId(query.itemId) } },
      { $sort: { billDate: 1, "lines._id": 1 } },
      {
        $project: {
          billId: "$_id",
          billDate: 1,
          shop: 1,
          quantity: "$lines.quantity",
          unit: "$lines.unit",
          unitPricePaise: "$lines.unitPricePaise",
          lineTotalPaise: "$lines.lineTotalPaise",
          baseQuantity: "$lines.baseQuantity",
          baseUnit: "$lines.baseUnit",
          _id: 0,
        },
      },
    ]);

    const points: PricePoint[] = (
      rows as (Omit<PricePoint, "basePricePaise" | "billId"> & { billId: Types.ObjectId })[]
    ).flatMap((row) => {
      const price = basePricePaise(row.lineTotalPaise, row.baseQuantity, row.baseUnit);
      return price === null ? [] : [{ ...row, billId: String(row.billId), basePricePaise: price }];
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

/**
 * Same as /price-history, but merged across every brand sharing this item's name —
 * "irrespective of brand". Groups on (household_id, name lowercased), the same
 * case-insensitive idiom findOrCreateItem/assertItemNameFree use, just without the brand
 * comparison half.
 */
reportsRouter.get(
  "/price-history-all-brands",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(priceHistoryByNameQuerySchema, req.query);
    const nameLower = query.name.toLowerCase();

    const categoryDoc = await Item.findOne({ householdId, nameLower }).populate<{ categoryId: { name: string } | null }>(
      "categoryId",
      "name",
    );

    const rows = await Bill.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId) } },
      { $unwind: "$lines" },
      { $lookup: { from: "items", localField: "lines.itemId", foreignField: "_id", as: "item" } },
      { $unwind: "$item" },
      { $match: { "item.nameLower": nameLower } },
      { $sort: { billDate: 1, "lines._id": 1 } },
      {
        $project: {
          billId: "$_id",
          billDate: 1,
          shop: 1,
          brand: "$item.brand",
          packSize: "$item.packSize",
          packUnit: "$item.defaultUnit",
          quantity: "$lines.quantity",
          unit: "$lines.unit",
          unitPricePaise: "$lines.unitPricePaise",
          lineTotalPaise: "$lines.lineTotalPaise",
          baseQuantity: "$lines.baseQuantity",
          baseUnit: "$lines.baseUnit",
          _id: 0,
        },
      },
    ]);

    const points: PricePointWithBrand[] = (rows as (Omit<PricePointWithBrand, "basePricePaise" | "billId"> & {
      billId: Types.ObjectId;
    })[]).flatMap((row) => {
      const price = basePricePaise(row.lineTotalPaise, row.baseQuantity, row.baseUnit);
      return price === null ? [] : [{ ...row, billId: String(row.billId), basePricePaise: price }];
    });

    const first = points[0]?.basePricePaise ?? null;
    const latest = points.at(-1)?.basePricePaise ?? null;
    const previous = points.length >= 2 ? points.at(-2)!.basePricePaise : null;

    res.json({
      name: query.name,
      categoryName: categoryDoc?.categoryId?.name ?? null,
      baseUnit: (points[0]?.baseUnit as BaseUnit | undefined) ?? null,
      points,
      firstBasePricePaise: first,
      latestBasePricePaise: latest,
      changeVsFirstPct: pctChange(first, latest),
      changeVsPreviousPct: pctChange(previous, latest),
    } satisfies PriceHistoryByName);
  }),
);

reportsRouter.get(
  "/top-items",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const query = parseOrThrow(topItemsQuerySchema, req.query);

    const rows = await Bill.aggregate([
      { $match: { householdId: new Types.ObjectId(householdId), ...dateMatch(query.from, query.to) } },
      { $unwind: "$lines" },
      {
        $group: {
          _id: { itemId: "$lines.itemId", baseUnit: "$lines.baseUnit" },
          totalPaise: { $sum: "$lines.lineTotalPaise" },
          totalBaseQuantity: { $sum: "$lines.baseQuantity" },
          purchaseCount: { $sum: 1 },
        },
      },
      { $lookup: { from: "items", localField: "_id.itemId", foreignField: "_id", as: "item" } },
      { $unwind: "$item" },
      { $lookup: { from: "categories", localField: "item.categoryId", foreignField: "_id", as: "category" } },
      {
        $project: {
          itemId: "$_id.itemId",
          brand: "$item.brand",
          itemName: "$item.name",
          categoryName: { $arrayElemAt: ["$category.name", 0] },
          totalPaise: 1,
          totalBaseQuantity: 1,
          baseUnit: "$_id.baseUnit",
          purchaseCount: 1,
          _id: 0,
        },
      },
      { $sort: query.metric === "spend" ? { totalPaise: -1 } : { totalBaseQuantity: -1 } },
      { $limit: query.limit },
    ]);

    res.json((rows as (Omit<TopItem, "itemId"> & { itemId: Types.ObjectId })[]).map((row) => ({
      ...row,
      itemId: String(row.itemId),
    })) satisfies TopItem[]);
  }),
);

/** Headline numbers for the dashboard: this month, last month, and all-time. */
reportsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { householdId } = auth(req);
    const match = { householdId: new Types.ObjectId(householdId) };

    const [totals] = await Bill.aggregate([
      { $match: match },
      { $project: { billTotal: { $sum: "$lines.lineTotalPaise" } } },
      { $group: { _id: null, totalPaise: { $sum: "$billTotal" }, billCount: { $sum: 1 } } },
    ]);

    const byMonth = await Bill.aggregate([
      { $match: match },
      { $project: { month: MONTH_KEY_EXPR, billTotal: { $sum: "$lines.lineTotalPaise" } } },
      { $group: { _id: "$month", totalPaise: { $sum: "$billTotal" } } },
      { $sort: { _id: -1 } },
      { $limit: 2 },
      { $project: { month: "$_id", totalPaise: 1, _id: 0 } },
    ]);

    const itemCount = await Item.countDocuments({ householdId, archived: false });

    res.json({
      totalPaise: totals?.totalPaise ?? 0,
      billCount: totals?.billCount ?? 0,
      itemCount,
      currentMonth: byMonth[0] ?? null,
      previousMonth: byMonth[1] ?? null,
    });
  }),
);
