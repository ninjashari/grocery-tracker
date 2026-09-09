-- Flips which of unit_price_paise / line_total_paise is authoritative.
--
-- Receipts print a line's total (NetAmt); they rarely print a clean per-unit rate, and
-- even when they do, dividing it back out can land on a paisa the printed total doesn't
-- match (e.g. a 200 g pack at Rs 109 flat has no exact per-gram price in whole paise).
-- So the total is now what's entered and stored, and unit_price_paise becomes a derived
-- convenience value (total / quantity, rounded) kept for prefill, display and CSV export.
--
-- SQLite can't ALTER a column out of GENERATED ALWAYS, so the table is rebuilt.

CREATE TABLE bill_lines_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id          INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity         REAL    NOT NULL CHECK (quantity > 0),
  unit             TEXT    NOT NULL,
  line_total_paise INTEGER NOT NULL CHECK (line_total_paise >= 0),
  -- Derived: ROUND(line_total_paise / quantity). Not authoritative — recomputed whenever
  -- the line is saved, never itself the source of a stored total.
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  base_quantity    REAL    NOT NULL CHECK (base_quantity > 0),
  base_unit        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO bill_lines_new (id, bill_id, item_id, quantity, unit, line_total_paise, unit_price_paise, base_quantity, base_unit, created_at)
SELECT id, bill_id, item_id, quantity, unit, line_total_paise, unit_price_paise, base_quantity, base_unit, created_at
FROM bill_lines;

DROP TABLE bill_lines;
ALTER TABLE bill_lines_new RENAME TO bill_lines;

CREATE INDEX bill_lines_bill_idx ON bill_lines(bill_id);
CREATE INDEX bill_lines_item_idx ON bill_lines(item_id);
