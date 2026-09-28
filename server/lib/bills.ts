import { isValidObjectId, Types, type ClientSession } from "mongoose";
import { withTransaction } from "../db/connection.ts";
import { Bill, Item } from "../db/models/index.ts";
import { notFound } from "./http.ts";
import { findOrCreateItem } from "./items.ts";
import { toBaseQuantity } from "../../shared/units.ts";
import { derivedUnitPricePaise } from "../../shared/money.ts";
import type { BillInput, PaymentMethod } from "../../shared/schemas.ts";
import type { Bill as BillShape, BillLine, BillSummary, ItemPurchase } from "../../shared/types.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type BillFilter = {
  from?: string;
  to?: string;
  shop?: string;
  categoryId?: string;
  paymentMethod?: PaymentMethod;
  limit: number;
  offset: number;
};

async function itemIdsInCategory(householdId: string, categoryId: string): Promise<Types.ObjectId[]> {
  return Item.find({ householdId, categoryId }).distinct("_id");
}

export async function listBills(householdId: string, filter: BillFilter): Promise<BillSummary[]> {
  const match: Record<string, unknown> = { householdId: new Types.ObjectId(householdId) };
  if (filter.from || filter.to) {
    match.billDate = {
      ...(filter.from ? { $gte: filter.from } : {}),
      ...(filter.to ? { $lte: filter.to } : {}),
    };
  }
  if (filter.shop) match.shopLower = { $regex: escapeRegex(filter.shop.toLowerCase()), $options: "i" };
  if (filter.paymentMethod) match.paymentMethod = filter.paymentMethod;
  if (filter.categoryId !== undefined) {
    // A category filter narrows which BILLS qualify, without shrinking computedTotalPaise
    // down to just that category's lines — a qualifying bill's full total still counts.
    const ids = await itemIdsInCategory(householdId, filter.categoryId);
    match["lines.itemId"] = { $in: ids };
  }

  const rows = await Bill.aggregate([
    { $match: match },
    {
      $addFields: {
        computedTotalPaise: { $sum: "$lines.lineTotalPaise" },
        lineCount: { $size: "$lines" },
      },
    },
    { $lookup: { from: "users", localField: "createdBy", foreignField: "_id", as: "creator" } },
    { $addFields: { createdByName: { $ifNull: [{ $arrayElemAt: ["$creator.name", 0] }, "Unknown"] } } },
    { $sort: { billDate: -1, _id: -1 } },
    { $skip: filter.offset },
    { $limit: filter.limit },
    {
      $project: {
        id: "$_id",
        billDate: 1,
        shop: 1,
        paymentMethod: 1,
        statedTotalPaise: 1,
        note: 1,
        computedTotalPaise: 1,
        lineCount: 1,
        createdByName: 1,
        _id: 0,
      },
    },
  ]);

  return rows.map((row) => ({ ...row, id: row.id.toString() }) as BillSummary);
}

/** Every purchase of one item across all bills, newest first — a raw ledger, not the
 * aggregated price-trend view reports/price-history returns. */
export async function listBillLinesForItem(householdId: string, itemId: string): Promise<ItemPurchase[]> {
  const rows = await Bill.aggregate([
    { $match: { householdId: new Types.ObjectId(householdId) } },
    { $unwind: "$lines" },
    { $match: { "lines.itemId": new Types.ObjectId(itemId) } },
    { $sort: { billDate: -1, "lines._id": -1 } },
    {
      $project: {
        billId: "$_id",
        billDate: 1,
        shop: 1,
        paymentMethod: 1,
        note: 1,
        statedTotalPaise: 1,
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

  return rows.map((row) => ({ ...row, billId: row.billId.toString() }) as ItemPurchase);
}

type BillLineDoc = {
  _id: { toString(): string };
  itemId: { _id: { toString(): string }; brand: string; name: string; categoryId: { name: string } | null } | null;
  quantity: number;
  unit: string;
  unitPricePaise: number;
  lineTotalPaise: number;
  baseQuantity: number;
  baseUnit: string;
};

function toBillLine(line: BillLineDoc): BillLine {
  return {
    id: line._id.toString(),
    itemId: line.itemId?._id.toString() ?? "",
    brand: line.itemId?.brand ?? "",
    itemName: line.itemId?.name ?? "",
    categoryName: line.itemId?.categoryId?.name ?? null,
    quantity: line.quantity,
    unit: line.unit as BillLine["unit"],
    unitPricePaise: line.unitPricePaise,
    lineTotalPaise: line.lineTotalPaise,
    baseQuantity: line.baseQuantity,
    baseUnit: line.baseUnit as BillLine["baseUnit"],
  };
}

export async function getBill(householdId: string, id: string): Promise<BillShape | null> {
  if (!isValidObjectId(id)) return null;

  const doc = await Bill.findOne({ householdId, _id: id })
    .populate({
      path: "lines.itemId",
      select: "brand name categoryId",
      populate: { path: "categoryId", select: "name" },
    })
    .populate("createdBy", "name");

  if (!doc) return null;

  const lines = (doc.lines as unknown as BillLineDoc[]).map(toBillLine);
  const computedTotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
  const createdByName = (doc.createdBy as unknown as { name: string } | null)?.name ?? "Unknown";

  return {
    id: doc._id.toString(),
    billDate: doc.billDate,
    shop: doc.shop,
    paymentMethod: doc.paymentMethod as PaymentMethod,
    statedTotalPaise: doc.statedTotalPaise ?? null,
    note: doc.note,
    computedTotalPaise,
    lineCount: lines.length,
    createdByName,
    lines,
  };
}

export async function requireBill(householdId: string, id: string): Promise<BillShape> {
  const bill = await getBill(householdId, id);
  if (!bill) throw notFound("Bill not found");
  return bill;
}

/** Best-effort: keeps each item's prefill data current. Not itself the source of truth —
 * the bills collection is — so a crash between the bill commit and this pass just leaves
 * a stale prefill until the item's next purchase, which is an acceptable tradeoff. */
export async function refreshLastPurchase(itemIds: string[]): Promise<void> {
  for (const itemId of itemIds) {
    const [latest] = await Bill.aggregate([
      { $unwind: "$lines" },
      { $match: { "lines.itemId": new Types.ObjectId(itemId) } },
      { $sort: { billDate: -1, "lines._id": -1 } },
      { $limit: 1 },
      {
        $project: {
          unitPricePaise: "$lines.unitPricePaise",
          unit: "$lines.unit",
          billDate: 1,
          lineTotalPaise: "$lines.lineTotalPaise",
          quantity: "$lines.quantity",
        },
      },
    ]);

    const purchaseCount = await Bill.countDocuments({ "lines.itemId": new Types.ObjectId(itemId) });

    await Item.updateOne(
      { _id: itemId },
      {
        $set: {
          lastPurchase: latest
            ? {
                unitPricePaise: latest.unitPricePaise,
                unit: latest.unit,
                billDate: latest.billDate,
                lineTotalPaise: latest.lineTotalPaise,
                quantity: latest.quantity,
              }
            : null,
          purchaseCount,
        },
      },
    );
  }
}

/** Guards against a request naming an item id that belongs to a different household. */
async function assertItemInHousehold(householdId: string, itemId: string, session: ClientSession): Promise<string> {
  const row = await Item.findOne({ _id: itemId, householdId }).session(session);
  if (!row) throw notFound("Item not found");
  return row._id.toString();
}

/**
 * Writes a bill header and all its lines atomically, creating any inline `newItem`s along
 * the way. A half-saved bill would not match its receipt, so this is all-or-nothing.
 *
 * `billId` updates in place by replacing every line, which keeps edit semantics simple:
 * what you see in the form is exactly what ends up stored.
 */
export async function saveBill(
  householdId: string,
  userId: string,
  input: BillInput,
  billId?: string,
): Promise<BillShape> {
  const affectedItemIds = new Set<string>();

  const savedId = await withTransaction(async (session) => {
    const lines = [];
    for (const line of input.lines) {
      const itemId =
        line.itemId !== undefined
          ? await assertItemInHousehold(householdId, line.itemId, session)
          : await findOrCreateItem(householdId, line.newItem!, session);
      affectedItemIds.add(itemId);

      const { baseQuantity, baseUnit } = toBaseQuantity(line.quantity, line.unit);
      const unitPricePaise = derivedUnitPricePaise(line.lineTotalPaise, line.quantity);
      lines.push({
        itemId,
        quantity: line.quantity,
        unit: line.unit,
        lineTotalPaise: line.lineTotalPaise,
        unitPricePaise,
        baseQuantity,
        baseUnit,
      });
    }

    const header = {
      householdId,
      billDate: input.billDate,
      shop: input.shop,
      shopLower: input.shop.toLowerCase(),
      paymentMethod: input.paymentMethod,
      statedTotalPaise: input.statedTotalPaise,
      note: input.note,
      lines,
    };

    if (billId === undefined) {
      const [created] = await Bill.create([{ ...header, createdBy: userId }], { session });
      return created!._id.toString();
    }

    const updated = await Bill.findOneAndUpdate({ _id: billId, householdId }, { $set: header }, { session, new: true });
    if (!updated) throw notFound("Bill not found");
    return updated._id.toString();
  });

  await refreshLastPurchase([...affectedItemIds]);
  return requireBill(householdId, savedId);
}

export async function deleteBill(householdId: string, id: string): Promise<void> {
  await requireBill(householdId, id);
  await Bill.deleteOne({ _id: id, householdId });
  // Any item whose lastPurchase pointed only at this bill now shows a stale prefill until
  // its next purchase — accepted as a rare, low-stakes staleness (see refreshLastPurchase).
}
