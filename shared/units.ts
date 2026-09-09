/**
 * Units and their conversion to a base unit.
 *
 * Price history only works if 1 kg at Rs 60/kg and 500 g at Rs 0.07/g land on the same
 * curve, so every purchase is also recorded in a base unit: mass -> g, volume -> ml,
 * count -> pcs. Comparisons are then plain arithmetic on `line_total / base_quantity`.
 */

export const UNITS = ["kg", "g", "L", "ml", "pcs", "pack", "dozen"] as const;

export type Unit = (typeof UNITS)[number];

export const BASE_UNITS = ["g", "ml", "pcs"] as const;

export type BaseUnit = (typeof BASE_UNITS)[number];

type UnitDef = {
  /** Unit this converts into for comparison. */
  base: BaseUnit;
  /** Multiply a quantity in this unit by `factor` to get the base quantity. */
  factor: number;
  label: string;
};

export const UNIT_DEFS: Record<Unit, UnitDef> = {
  kg: { base: "g", factor: 1000, label: "kg" },
  g: { base: "g", factor: 1, label: "g" },
  L: { base: "ml", factor: 1000, label: "L" },
  ml: { base: "ml", factor: 1, label: "ml" },
  pcs: { base: "pcs", factor: 1, label: "pcs" },
  pack: { base: "pcs", factor: 1, label: "pack" },
  dozen: { base: "pcs", factor: 12, label: "dozen" },
};

export function isUnit(value: unknown): value is Unit {
  return typeof value === "string" && (UNITS as readonly string[]).includes(value);
}

/** Convert a quantity in `unit` to its base unit. Throws on an unknown unit. */
export function toBaseQuantity(quantity: number, unit: Unit): { baseQuantity: number; baseUnit: BaseUnit } {
  const def = UNIT_DEFS[unit];
  if (!def) throw new Error(`Unknown unit: ${unit}`);
  return { baseQuantity: quantity * def.factor, baseUnit: def.base };
}

/**
 * Human label for a base-unit price, e.g. "per 100 g".
 *
 * Rs/g and Rs/ml are unreadably small numbers, so mass and volume are quoted per 100
 * base units while counts stay per single piece.
 */
export const BASE_PRICE_STEP: Record<BaseUnit, { step: number; label: string }> = {
  g: { step: 100, label: "per 100 g" },
  ml: { step: 100, label: "per 100 ml" },
  pcs: { step: 1, label: "per pc" },
};

/** Price per display step (per 100 g / per 100 ml / per pc), in paise. */
export function basePricePaise(lineTotalPaise: number, baseQuantity: number, baseUnit: BaseUnit): number | null {
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) return null;
  return (lineTotalPaise / baseQuantity) * BASE_PRICE_STEP[baseUnit].step;
}
