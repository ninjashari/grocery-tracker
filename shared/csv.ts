/**
 * Minimal RFC 4180 CSV reader/writer.
 *
 * Small enough to own outright, and owning it means export -> import round-trips are
 * covered by our own tests rather than by assumptions about a dependency.
 */

export const CSV_COLUMNS = [
  "bill_date",
  "shop",
  "payment_method",
  "brand",
  "item_name",
  "category",
  "quantity",
  "unit",
  "unit_price",
  "line_total",
  // The total as printed on the receipt, repeated on every row of the same bill. Kept
  // separate from the line sum because real receipts disagree with it by a rounding
  // paisa, and losing it would make an export -> import round trip lossy.
  "bill_total",
  "note",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Parse CSV text into rows of raw cell strings. Handles quotes, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  // Strip a UTF-8 BOM; spreadsheet exports commonly include one.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // Drop rows that are entirely empty (trailing newline, blank separator lines).
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\r") {
      // Swallow CR; the following LF (or its absence) ends the row.
      if (input[i + 1] === "\n") i++;
      endRow();
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
      fieldStarted = true;
    }
  }

  // A file not ending in a newline still has a final field/row pending.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

/** Parse CSV with a header row into objects keyed by normalised header name. */
export function parseCsvWithHeader(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const raw = parseCsv(text);
  if (raw.length === 0) return { headers: [], rows: [] };

  const headers = raw[0]!.map(normaliseHeader);
  const rows = raw.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers, rows };
}

/** "Bill Date" / " unit_price " / "Unit-Price" all normalise to "bill_date" / "unit_price". */
export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

export function escapeCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvValue).join(",")];
  for (const row of rows) lines.push(row.map(escapeCsvValue).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
