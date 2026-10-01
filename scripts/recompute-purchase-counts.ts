/**
 * One-off backfill: recompute every item's denormalized purchaseCount/lastPurchase from
 * actual bill lines. Needed because deleteBill (and bill edits that remove a line) used to
 * skip this recompute, leaving stale purchaseCount on items with zero bills left.
 *
 * Usage: node --env-file-if-exists=.env scripts/recompute-purchase-counts.ts
 */
import { connectDb, disconnectDb } from "../server/db/connection.ts";
import { Item } from "../server/db/models/item.model.ts";
import { refreshLastPurchase } from "../server/lib/bills.ts";

async function main() {
  await connectDb();

  const items = await Item.find({}, { _id: 1 });
  const itemIds = items.map((item) => item._id.toString());
  console.log(`Recomputing purchaseCount/lastPurchase for ${itemIds.length} item(s)...`);

  await refreshLastPurchase(itemIds);

  await disconnectDb();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
