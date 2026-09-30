/**
 * Merge duplicate catalog items into one canonical item.
 *
 * Necessary because Item has a unique (household, brand, name) index — a plain rename
 * of two items to the same name would collide. This instead repoints every bill line
 * that referenced a duplicate onto the surviving item (so no purchase history is lost),
 * recomputes the survivor's denormalized purchaseCount/lastPurchase, renames it to the
 * canonical name, and deletes the duplicates.
 *
 * Run this from your own machine (not a sandboxed environment) so it can reach Atlas.
 *
 * Usage (dry run — prints the plan, writes nothing):
 *   node --env-file-if-exists=.env scripts/merge-items.ts --canonical "Onion" --alias "Onion Red" --alias "Onion 1kg"
 *
 * Add --apply once the plan looks right:
 *   node --env-file-if-exists=.env scripts/merge-items.ts --canonical "Onion" --alias "Onion Red" --alias "Onion 1kg" --apply
 */
import { Types } from "mongoose";
import { connectDb, disconnectDb } from "../server/db/connection.ts";
import { Item } from "../server/db/models/item.model.ts";
import { Bill } from "../server/db/models/bill.model.ts";
import { Household } from "../server/db/models/household.model.ts";

function parseArgs() {
  const args = process.argv.slice(2);
  let canonical: string | null = null;
  const aliases: string[] = [];
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--canonical") canonical = args[++i] ?? null;
    else if (a === "--alias") aliases.push(args[++i] ?? "");
    else if (a === "--apply") apply = true;
  }
  if (!canonical || aliases.length === 0) {
    console.error('Usage: --canonical "Onion" --alias "Onion Red" --alias "Onion 1kg" [--apply]');
    process.exit(1);
  }
  return { canonical, aliases, apply };
}

async function mergeForHousehold(
  householdId: Types.ObjectId,
  householdName: string,
  canonicalName: string,
  aliasNames: string[],
  apply: boolean,
) {
  const lowerNames = [canonicalName, ...aliasNames].map((n) => n.toLowerCase());
  const candidates = await Item.find({ householdId, nameLower: { $in: lowerNames } });
  if (candidates.length === 0) return;

  console.log(`\n=== Household: ${householdName} (${householdId}) ===`);
  for (const c of candidates) {
    console.log(
      `  candidate: "${c.name}" · brand="${c.brand}" unit=${c.defaultUnit} category=${c.categoryId ?? "none"} ` +
        `purchaseCount=${c.purchaseCount} archived=${c.archived} id=${c._id}`,
    );
  }

  // An item already named exactly the canonical name wins outright; otherwise the
  // candidate with the most purchases wins (ties broken by most recent purchase).
  const exact = candidates.find((c) => c.nameLower === canonicalName.toLowerCase());
  const winner =
    exact ??
    candidates.slice().sort((a, b) => {
      if (b.purchaseCount !== a.purchaseCount) return b.purchaseCount - a.purchaseCount;
      return (b.lastPurchase?.billDate ?? "").localeCompare(a.lastPurchase?.billDate ?? "");
    })[0]!;
  const losers = candidates.filter((c) => c._id.toString() !== winner._id.toString());

  console.log(`  winner: "${winner.name}" (${winner._id})`);

  if (losers.length === 0) {
    if (winner.nameLower === canonicalName.toLowerCase()) {
      console.log("  nothing to do (already canonical, no duplicates).");
      return;
    }
    console.log(`  plan: rename "${winner.name}" -> "${canonicalName}" (no duplicates to merge)`);
    if (apply) {
      winner.name = canonicalName;
      winner.nameLower = canonicalName.toLowerCase();
      await winner.save();
      console.log("  done.");
    } else {
      console.log("  (dry run — pass --apply to write this change)");
    }
    return;
  }

  for (const loser of losers) {
    const billCount = await Bill.countDocuments({ householdId, "lines.itemId": loser._id });
    console.log(`  plan: merge "${loser.name}" (${loser._id}, referenced by ${billCount} bill(s)) into winner, then delete it`);
    if (loser.brand !== winner.brand) {
      console.log(`    note: brand differs (loser="${loser.brand}", winner="${winner.brand}") — keeping winner's brand`);
    }
    if (String(loser.categoryId ?? "") !== String(winner.categoryId ?? "")) {
      console.log(`    note: category differs (loser=${loser.categoryId ?? "none"}, winner=${winner.categoryId ?? "none"}) — keeping winner's category`);
    }
    if (loser.defaultUnit !== winner.defaultUnit) {
      console.log(
        `    note: default unit differs (loser=${loser.defaultUnit}, winner=${winner.defaultUnit}) — keeping winner's default unit; ` +
          `existing bill lines keep their own recorded unit either way`,
      );
    }
  }

  if (!apply) {
    console.log("  (dry run — pass --apply to write these changes)");
    return;
  }

  for (const loser of losers) {
    await Bill.updateMany(
      { householdId, "lines.itemId": loser._id },
      { $set: { "lines.$[line].itemId": winner._id } },
      { arrayFilters: [{ "line.itemId": loser._id }] },
    );
  }

  // Recompute the survivor's denormalized fields from actual bill lines post-merge.
  const lines = await Bill.aggregate([
    { $match: { householdId, "lines.itemId": winner._id } },
    { $unwind: "$lines" },
    { $match: { "lines.itemId": winner._id } },
    { $sort: { billDate: -1, createdAt: -1 } },
  ]);

  winner.purchaseCount = lines.length;
  winner.lastPurchase = lines.length
    ? {
        unitPricePaise: lines[0].lines.unitPricePaise,
        unit: lines[0].lines.unit,
        billDate: lines[0].billDate,
        lineTotalPaise: lines[0].lines.lineTotalPaise,
        quantity: lines[0].lines.quantity,
      }
    : null;
  winner.name = canonicalName;
  winner.nameLower = canonicalName.toLowerCase();
  await winner.save();

  for (const loser of losers) {
    await Item.deleteOne({ _id: loser._id });
  }

  console.log(`  done: winner renamed to "${canonicalName}", ${losers.length} duplicate(s) merged and deleted.`);
}

async function main() {
  const { canonical, aliases, apply } = parseArgs();
  await connectDb();

  const households = await Household.find({});
  for (const h of households) {
    await mergeForHousehold(h._id as Types.ObjectId, h.name, canonical, aliases, apply);
  }

  await disconnectDb();
  console.log(apply ? "\nAll done." : "\nDry run complete — re-run with --apply to write changes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
