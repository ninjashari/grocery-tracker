/**
 * Money is stored and transported as integer paise. Rupee floats only exist at the edges
 * (user input and display), never in the database or in arithmetic.
 */

export const CURRENCY_SYMBOL = "₹";

/** Parse user input ("60", "60.50", "1,234.5", "") into paise. Returns null if unparseable. */
export function rupeesToPaise(input: string | number): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.replace(/[,\s₹]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/** Format paise for display, e.g. 123456 -> "₹1,234.56". */
export function formatPaise(paise: number, opts: { symbol?: boolean; decimals?: number } = {}): string {
  const { symbol = true, decimals = 2 } = opts;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(paise / 100);
  return symbol ? `${CURRENCY_SYMBOL}${formatted}` : formatted;
}

/**
 * Line total in paise, rounded half-away-from-zero (quantities and prices are never
 * negative here, so this matches Math.round). Used where a total genuinely needs deriving
 * from a unit price — CSV rows that only give unit_price, mainly — but the line total
 * itself is authoritative once known, not recomputed from the unit price on every read.
 */
export function lineTotalPaise(quantity: number, unitPricePaise: number): number {
  return Math.round(quantity * unitPricePaise);
}

/**
 * Unit price derived from a line total, for prefill/display/CSV only.
 *
 * Receipts print a line's total, not a clean per-unit rate — a 200 g pack at Rs 109 flat
 * has no exact per-gram price in whole paise. So `bill_lines.line_total_paise` is what's
 * entered and stored, and this derives `unit_price_paise` from it, rounded. Never treat
 * the result as exact: `quantity * derivedUnitPricePaise(...)` will not always reproduce
 * `lineTotalPaise` to the paisa.
 */
export function derivedUnitPricePaise(lineTotalPaise: number, quantity: number): number {
  return Math.round(lineTotalPaise / quantity);
}
