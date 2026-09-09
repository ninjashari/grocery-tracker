import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, normaliseHeader, parseCsv, parseCsvWithHeader, toCsv } from "../shared/csv.ts";

describe("parseCsv", () => {
  it("parses plain rows", () => {
    expect(parseCsv("a,b,c\r\n1,2,3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles LF, CRLF and a missing trailing newline", () => {
    const expected = [
      ["a", "b"],
      ["1", "2"],
    ];
    expect(parseCsv("a,b\n1,2\n")).toEqual(expected);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual(expected);
    expect(parseCsv("a,b\r\n1,2")).toEqual(expected);
  });

  it("keeps commas, quotes and newlines inside quoted fields", () => {
    expect(parseCsv('a,"b,c",d\r\n')).toEqual([["a", "b,c", "d"]]);
    expect(parseCsv('"say ""hi""",x\r\n')).toEqual([['say "hi"', "x"]]);
    expect(parseCsv('"line one\nline two",x\r\n')).toEqual([["line one\nline two", "x"]]);
  });

  it("preserves empty fields", () => {
    expect(parseCsv("a,,c\r\n")).toEqual([["a", "", "c"]]);
    expect(parseCsv(",,\r\n")).toEqual([["", "", ""]]);
  });

  it("skips blank lines and strips a BOM", () => {
    expect(parseCsv("a,b\r\n\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("﻿a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("header handling", () => {
  it("normalises spreadsheet-mangled headers", () => {
    expect(normaliseHeader("Bill Date")).toBe("bill_date");
    expect(normaliseHeader(" unit_price ")).toBe("unit_price");
    expect(normaliseHeader("Unit-Price")).toBe("unit_price");
    expect(normaliseHeader("Item Name!")).toBe("item_name");
  });

  it("maps rows onto normalised keys and trims values", () => {
    const { headers, rows } = parseCsvWithHeader("Bill Date,Shop\r\n2026-09-08, DMart \r\n");
    expect(headers).toEqual(["bill_date", "shop"]);
    expect(rows).toEqual([{ bill_date: "2026-09-08", shop: "DMart" }]);
  });

  it("fills missing trailing cells with empty strings", () => {
    const { rows } = parseCsvWithHeader("a,b,c\r\n1\r\n");
    expect(rows).toEqual([{ a: "1", b: "", c: "" }]);
  });
});

describe("toCsv", () => {
  it("quotes only what needs quoting", () => {
    expect(toCsv(["a", "b"], [["plain", "has,comma"]])).toBe('a,b\r\nplain,"has,comma"\r\n');
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
    expect(toCsv(["a"], [[null]])).toBe("a\r\n\r\n");
  });

  /** Export writes this shape and import reads it, so a round trip must be lossless. */
  it("round-trips awkward values through parse", () => {
    const rows = [
      ["2026-09-08", 'Shop, "The" One', "Cash", "Amul", "Milk\nCarton", "Dairy", 2, "L", "60.00", "120.00", ""],
    ];
    const csv = toCsv(CSV_COLUMNS, rows);
    const { rows: parsed } = parseCsvWithHeader(csv);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!["shop"]).toBe('Shop, "The" One');
    expect(parsed[0]!["item_name"]).toBe("Milk\nCarton");
    expect(parsed[0]!["quantity"]).toBe("2");
    expect(parsed[0]!["unit_price"]).toBe("60.00");
  });
});
