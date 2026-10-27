/**
 * Read-only helper for the grocery bill-entry skill. Never writes to the database.
 *
 * Usage (from the repo root):
 *   node --env-file-if-exists=.env scripts/grocery-skill-db.ts catalog [--household=<id|name>]
 *   node --env-file-if-exists=.env scripts/grocery-skill-db.ts bills 2026-10-18 [--household=<id|name>]
 *   node --env-file-if-exists=.env scripts/grocery-skill-db.ts excel [out.xlsx]
 *
 * `catalog` prints items, categories, shops and recent bill notes as JSON for matching.
 * `bills` prints every bill on one date (duplicate check before import, verification after).
 * Both are scoped to one household: --household, else the one with the most bills.
 * `excel` rewrites a workbook with every bill, bill line, item and category in the database.
 *
 * grocery-skill-db v2
 */
import { renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Types } from "mongoose";
import { crc32, deflateRawSync } from "node:zlib";
import { connectDb, disconnectDb } from "../server/db/connection.ts";
import { Bill, Category, Household, Item } from "../server/db/models/index.ts";

const DEFAULT_XLSX = join(homedir(), "Documents", "grocery-tracker-data.xlsx");

const rupees = (paise: number | null | undefined) =>
  paise === null || paise === undefined ? null : Math.round(paise) / 100;

async function lookups() {
  const [households, categories, items] = await Promise.all([
    Household.find({}).lean(),
    Category.find({}).sort({ sortOrder: 1 }).lean(),
    Item.find({}).lean(),
  ]);
  const householdName = new Map(households.map((h) => [h._id.toString(), h.name as string]));
  const categoryName = new Map(categories.map((c) => [c._id.toString(), c.name]));
  const itemById = new Map(items.map((i) => [i._id.toString(), i]));
  return { households, householdName, categories, categoryName, items, itemById };
}

/** Resolves --household (id or case-insensitive name), defaulting to the household with the most bills. */
async function pickHousehold(wanted: string | undefined) {
  const households = await Household.find({}).lean();
  const counts = new Map(
    (await Bill.aggregate([{ $group: { _id: "$householdId", bills: { $sum: 1 } } }])).map((r) => [r._id.toString(), r.bills as number]),
  );
  const all = households
    .map((h) => ({ id: h._id.toString(), name: h.name as string, bills: counts.get(h._id.toString()) ?? 0 }))
    .sort((a, b) => b.bills - a.bills);
  const chosen = wanted
    ? all.find((h) => h.id === wanted || h.name.toLowerCase() === wanted.toLowerCase())
    : all[0];
  if (!chosen) throw new Error(`No household matches "${wanted}". Households: ${JSON.stringify(all)}`);
  return { chosen, all, id: new Types.ObjectId(chosen.id) };
}

async function catalog(wanted: string | undefined) {
  const household = await pickHousehold(wanted);
  const { categoryName } = await lookups();
  const categories = await Category.find({ householdId: household.id }).sort({ sortOrder: 1 }).lean();
  const items = await Item.find({ householdId: household.id }).lean();
  const shops = await Bill.aggregate([
    { $match: { householdId: household.id } },
    { $group: { _id: "$shopLower", shop: { $first: "$shop" }, bills: { $sum: 1 }, lastUsed: { $max: "$billDate" } } },
    { $sort: { lastUsed: -1 } },
    { $project: { _id: 0, shop: 1, bills: 1, lastUsed: 1 } },
  ]);
  const recentBills = await Bill.find({ householdId: household.id }, { billDate: 1, shop: 1, paymentMethod: 1, statedTotalPaise: 1, note: 1 })
    .sort({ billDate: -1, _id: -1 })
    .limit(15)
    .lean();
  return {
    household: household.chosen,
    otherHouseholds: household.all.filter((h) => h.id !== household.chosen.id),
    categories: categories.map((c) => c.name),
    items: items
      .map((i) => ({
        item_name: i.name,
        brand: i.brand,
        category: i.categoryId ? (categoryName.get(i.categoryId.toString()) ?? "") : "",
        unit: i.defaultUnit,
        packSize: i.packSize,
        archived: i.archived,
        purchases: i.purchaseCount,
        last: i.lastPurchase
          ? { date: i.lastPurchase.billDate, qty: i.lastPurchase.quantity, unit: i.lastPurchase.unit, total: rupees(i.lastPurchase.lineTotalPaise) }
          : null,
      }))
      .sort((a, b) => a.item_name.localeCompare(b.item_name) || a.brand.localeCompare(b.brand)),
    shops,
    recentBills: recentBills.map((b) => ({
      date: b.billDate,
      shop: b.shop,
      payment: b.paymentMethod,
      total: rupees(b.statedTotalPaise),
      note: b.note,
    })),
  };
}

async function billsOn(date: string, wanted: string | undefined) {
  const household = await pickHousehold(wanted);
  const { categoryName, itemById } = await lookups();
  const bills = await Bill.find({ householdId: household.id, billDate: date }).sort({ _id: 1 }).lean();
  return bills.map((b) => ({
    id: b._id.toString(),
    date: b.billDate,
    shop: b.shop,
    payment: b.paymentMethod,
    total: rupees(b.statedTotalPaise),
    linesTotal: rupees(b.lines.reduce((sum, l) => sum + l.lineTotalPaise, 0)),
    note: b.note,
    lines: b.lines.map((l) => {
      const item = itemById.get(l.itemId.toString());
      return {
        item_name: item?.name ?? "(missing item)",
        brand: item?.brand ?? "",
        category: item?.categoryId ? (categoryName.get(item.categoryId.toString()) ?? "") : "",
        quantity: l.quantity,
        unit: l.unit,
        line_total: rupees(l.lineTotalPaise),
      };
    }),
  }));
}

// ---------- Excel export ----------

type Cell = string | number | null | undefined | { date: string } | { money: number | null };
type Sheet = { name: string; header: string[]; widths: number[]; rows: Cell[][] };

async function excel(outPath: string) {
  const { households, householdName, categories, categoryName, items, itemById } = await lookups();
  const bills = await Bill.find({}).sort({ billDate: 1, _id: 1 }).lean();
  const multiHousehold = households.length > 1;
  const hh = (id: { toString(): string }) => householdName.get(id.toString()) ?? "";

  const billRows: Cell[][] = [];
  const lineRows: Cell[][] = [];
  for (const b of bills) {
    const linesTotal = b.lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    billRows.push([
      ...(multiHousehold ? [hh(b.householdId)] : []),
      b._id.toString(),
      { date: b.billDate },
      b.shop,
      b.paymentMethod,
      b.lines.length,
      { money: rupees(linesTotal) },
      { money: rupees(b.statedTotalPaise) },
      b.note,
    ]);
    for (const l of b.lines) {
      const item = itemById.get(l.itemId.toString());
      lineRows.push([
        ...(multiHousehold ? [hh(b.householdId)] : []),
        b._id.toString(),
        { date: b.billDate },
        b.billDate.slice(0, 7),
        b.shop,
        b.paymentMethod,
        item?.brand ?? "",
        item?.name ?? "(missing item)",
        item?.categoryId ? (categoryName.get(item.categoryId.toString()) ?? "") : "",
        l.quantity,
        l.unit,
        { money: rupees(l.unitPricePaise) },
        { money: rupees(l.lineTotalPaise) },
        l.baseQuantity,
        l.baseUnit,
      ]);
    }
  }

  const itemRows: Cell[][] = items
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand))
    .map((i) => [
      ...(multiHousehold ? [hh(i.householdId)] : []),
      i._id.toString(),
      i.name,
      i.brand,
      i.categoryId ? (categoryName.get(i.categoryId.toString()) ?? "") : "",
      i.defaultUnit,
      i.packSize,
      i.archived ? "yes" : "no",
      i.purchaseCount,
      i.lastPurchase ? { date: i.lastPurchase.billDate } : null,
      i.lastPurchase ? i.lastPurchase.quantity : null,
      i.lastPurchase ? i.lastPurchase.unit : null,
      i.lastPurchase ? { money: rupees(i.lastPurchase.lineTotalPaise) } : null,
    ]);

  const categoryRows: Cell[][] = categories.map((c) => [
    ...(multiHousehold ? [hh(c.householdId)] : []),
    c._id.toString(),
    c.name,
    c.sortOrder,
  ]);

  const monthly = new Map<string, { bills: number; paise: number }>();
  for (const b of bills) {
    const key = (multiHousehold ? hh(b.householdId) + "|" : "") + b.billDate.slice(0, 7);
    const m = monthly.get(key) ?? { bills: 0, paise: 0 };
    m.bills += 1;
    m.paise += b.lines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
    monthly.set(key, m);
  }
  const monthRows: Cell[][] = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, m]) => [...key.split("|"), m.bills, { money: rupees(m.paise) }]);

  const hhCol = multiHousehold ? ["Household"] : [];
  const hhW = multiHousehold ? [16] : [];
  const sheets: Sheet[] = [
    {
      name: "Bills",
      header: [...hhCol, "Bill ID", "Date", "Shop", "Payment", "Lines", "Lines total (₹)", "Bill total (₹)", "Note"],
      widths: [...hhW, 26, 12, 24, 10, 7, 15, 14, 80],
      rows: billRows,
    },
    {
      name: "Bill lines",
      header: [...hhCol, "Bill ID", "Date", "Month", "Shop", "Payment", "Brand", "Item", "Category", "Quantity", "Unit", "Unit price (₹)", "Line total (₹)", "Base qty", "Base unit"],
      widths: [...hhW, 26, 12, 9, 24, 10, 18, 34, 20, 10, 7, 14, 14, 10, 9],
      rows: lineRows,
    },
    {
      name: "Items",
      header: [...hhCol, "Item ID", "Item", "Brand", "Category", "Default unit", "Pack size", "Archived", "Purchases", "Last bought", "Last qty", "Last unit", "Last total (₹)"],
      widths: [...hhW, 26, 34, 18, 20, 12, 10, 9, 10, 12, 9, 9, 14],
      rows: itemRows,
    },
    { name: "Categories", header: [...hhCol, "Category ID", "Category", "Sort order"], widths: [...hhW, 26, 24, 10], rows: categoryRows },
    { name: "Monthly spend", header: [...hhCol, "Month", "Bills", "Spend (₹)"], widths: [...hhW, 10, 8, 14], rows: monthRows },
  ];

  const tmp = outPath + ".tmp";
  writeFileSync(tmp, buildXlsx(sheets));
  renameSync(tmp, outPath);
  return { file: outPath, bills: billRows.length, lines: lineRows.length, items: itemRows.length, categories: categoryRows.length };
}

// Minimal dependency-free .xlsx writer (SpreadsheetML inside a zip).

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // Strip control characters that XML 1.0 cannot carry.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(n: number) {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function excelSerial(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) / 86400000 + 25569;
}

// Style ids from styles.xml below: 1 header, 2 date, 3 money.
function cellXml(ref: string, v: Cell): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : "";
  if (typeof v === "string") return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  if ("date" in v) {
    const serial = excelSerial(v.date);
    return serial === null ? cellXml(ref, v.date) : `<c r="${ref}" s="2"><v>${serial}</v></c>`;
  }
  return v.money === null ? "" : `<c r="${ref}" s="3"><v>${v.money}</v></c>`;
}

function sheetXml(sheet: Sheet): string {
  const lastCol = colName(sheet.header.length - 1);
  const head = `<row r="1">${sheet.header
    .map((h, c) => `<c r="${colName(c)}1" t="inlineStr" s="1"><is><t>${esc(h)}</t></is></c>`)
    .join("")}</row>`;
  const body = sheet.rows
    .map((row, r) => `<row r="${r + 2}">${row.map((v, c) => cellXml(`${colName(c)}${r + 2}`, v)).join("")}</row>`)
    .join("");
  const cols = sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${sheet.rows.length + 1}"/></worksheet>`
  );
}

function buildXlsx(sheets: Sheet[]): Buffer {
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets>` +
        // Excel needs a defined name per autofilter to show the filter buttons reliably.
        `<definedNames>${sheets
          .map((s, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${colName(s.header.length - 1)}$${s.rows.length + 1}</definedName>`)
          .join("")}</definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF4"/></patternFill></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files.map(([name, text]) => [name, Buffer.from(text, "utf8")]));
}

function zip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------- CLI ----------

async function main() {
  const args = process.argv.slice(2);
  const household = args.find((a) => a.startsWith("--household="))?.slice("--household=".length);
  const [command, arg] = args.filter((a) => !a.startsWith("--"));
  await connectDb();
  try {
    if (command === "catalog") console.log(JSON.stringify(await catalog(household), null, 1));
    else if (command === "bills" && arg) console.log(JSON.stringify(await billsOn(arg, household), null, 1));
    else if (command === "excel") console.log(JSON.stringify(await excel(arg ?? DEFAULT_XLSX)));
    else throw new Error("Usage: grocery-skill-db.ts catalog | bills YYYY-MM-DD | excel [out.xlsx]  (catalog/bills take --household=<id|name>)");
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
