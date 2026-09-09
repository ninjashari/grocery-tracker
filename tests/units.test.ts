import { describe, expect, it } from "vitest";
import { basePricePaise, toBaseQuantity, UNITS, UNIT_DEFS, isUnit } from "../shared/units.ts";
import { derivedUnitPricePaise, formatPaise, lineTotalPaise, paiseToRupees, rupeesToPaise } from "../shared/money.ts";

describe("unit conversion", () => {
  it("converts every unit to its base", () => {
    expect(toBaseQuantity(1, "kg")).toEqual({ baseQuantity: 1000, baseUnit: "g" });
    expect(toBaseQuantity(500, "g")).toEqual({ baseQuantity: 500, baseUnit: "g" });
    expect(toBaseQuantity(2, "L")).toEqual({ baseQuantity: 2000, baseUnit: "ml" });
    expect(toBaseQuantity(750, "ml")).toEqual({ baseQuantity: 750, baseUnit: "ml" });
    expect(toBaseQuantity(3, "pcs")).toEqual({ baseQuantity: 3, baseUnit: "pcs" });
    expect(toBaseQuantity(2, "pack")).toEqual({ baseQuantity: 2, baseUnit: "pcs" });
    expect(toBaseQuantity(1, "dozen")).toEqual({ baseQuantity: 12, baseUnit: "pcs" });
  });

  it("has a definition for every listed unit", () => {
    for (const unit of UNITS) expect(UNIT_DEFS[unit]).toBeDefined();
  });

  it("rejects unknown units", () => {
    expect(isUnit("furlong")).toBe(false);
    expect(isUnit("kg")).toBe(true);
    expect(isUnit(null)).toBe(false);
  });

  /** The whole point of base units: the same goods at the same price compare as equal. */
  it("puts 1 kg and 500 g of equally-priced goods on one curve", () => {
    // 1 kg at Rs 60/kg = Rs 60 for 1000 g.
    const bulk = toBaseQuantity(1, "kg");
    const bulkPrice = basePricePaise(6000, bulk.baseQuantity, bulk.baseUnit);

    // 500 g at Rs 0.06/g = Rs 30 for 500 g. Same rate.
    const small = toBaseQuantity(500, "g");
    const smallPrice = basePricePaise(3000, small.baseQuantity, small.baseUnit);

    expect(bulkPrice).toBe(smallPrice);
    expect(bulkPrice).toBe(600); // Rs 6.00 per 100 g
  });

  it("prices litres and millilitres on one curve", () => {
    const litres = toBaseQuantity(2, "L");
    const millilitres = toBaseQuantity(500, "ml");

    // 2 L at Rs 60/L = Rs 120; 500 ml at Rs 0.06/ml = Rs 30. Both Rs 6.00 per 100 ml.
    expect(basePricePaise(12000, litres.baseQuantity, litres.baseUnit)).toBe(600);
    expect(basePricePaise(3000, millilitres.baseQuantity, millilitres.baseUnit)).toBe(600);
  });

  it("returns null rather than dividing by zero", () => {
    expect(basePricePaise(1000, 0, "g")).toBeNull();
    expect(basePricePaise(1000, Number.NaN, "g")).toBeNull();
  });
});

describe("money", () => {
  it("parses rupee input into paise", () => {
    expect(rupeesToPaise("60")).toBe(6000);
    expect(rupeesToPaise("60.50")).toBe(6050);
    expect(rupeesToPaise("1,234.5")).toBe(123450);
    expect(rupeesToPaise("₹99.99")).toBe(9999);
    expect(rupeesToPaise(37.5)).toBe(3750);
  });

  it("rejects input that is not a number", () => {
    expect(rupeesToPaise("")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("1.2.3")).toBeNull();
  });

  it("rounds sub-paise input rather than carrying a float", () => {
    expect(rupeesToPaise("0.005")).toBe(1);
    expect(rupeesToPaise("0.004")).toBe(0);
    // 8.115 * 100 is 811.4999... in binary floating point; rounding must still land on 812.
    expect(rupeesToPaise("8.115")).toBe(812);
  });

  it("multiplies a unit price out to a total, half-away-from-zero", () => {
    expect(lineTotalPaise(2, 6000)).toBe(12000);
    expect(lineTotalPaise(1.5, 3750)).toBe(5625);
    expect(lineTotalPaise(0.3, 3333)).toBe(1000); // 999.9 -> 1000
    expect(lineTotalPaise(150, 90)).toBe(13500); // 150 g at Rs 0.90/g
    expect(lineTotalPaise(0.5, 7)).toBe(4); // 3.5 rounds away from zero
  });

  /**
   * `bill_lines.line_total_paise` is what's entered and stored; unit_price_paise is
   * derived from it for display/prefill only. This must NOT be expected to reproduce the
   * total when multiplied back by quantity — that's the whole reason the total, not the
   * unit price, is authoritative.
   */
  describe("derivedUnitPricePaise", () => {
    it("divides a total back to a per-unit price, rounded", () => {
      expect(derivedUnitPricePaise(12000, 2)).toBe(6000);
      expect(derivedUnitPricePaise(10900, 1)).toBe(10900); // a 1-piece pack: exact by construction
    });

    it("does not necessarily reproduce the original total when multiplied back out", () => {
      // Rs 1.00 split three ways: 100 / 3 = 33.33 -> rounds to 33 paise/pc.
      const derived = derivedUnitPricePaise(100, 3);
      expect(derived).toBe(33);
      expect(3 * derived).toBe(99); // not 100 — the stored total is what's authoritative
    });

    it("matches the real receipt case that motivated this: a 200g pack at Rs 109 flat", () => {
      // No exact per-gram price exists in whole paise; the total is what was printed.
      expect(derivedUnitPricePaise(10900, 200)).toBe(55); // 109 / 200 = 0.545 -> 54.5 -> 55
      expect(200 * 55).not.toBe(10900);
    });
  });

  it("formats paise in Indian digit grouping", () => {
    expect(formatPaise(123456)).toBe("₹1,234.56");
    expect(formatPaise(100000000)).toBe("₹10,00,000.00");
    expect(formatPaise(600000, { symbol: false })).toBe("6,000.00");
    expect(paiseToRupees(6050)).toBe(60.5);
  });
});
