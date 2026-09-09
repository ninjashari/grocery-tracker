CREATE TABLE households (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Emails are stored lowercased by the API; this makes the uniqueness real.
CREATE UNIQUE INDEX users_email_unique ON users(email);
CREATE INDEX users_household_idx ON users(household_id);

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (household_id, name)
);

CREATE TABLE items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  brand        TEXT    NOT NULL DEFAULT '',
  name         TEXT    NOT NULL,
  category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  default_unit TEXT    NOT NULL DEFAULT 'pcs',
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (household_id, brand, name)
);

CREATE INDEX items_household_name_idx ON items(household_id, name);
CREATE INDEX items_category_idx ON items(category_id);

CREATE TABLE bills (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id       INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  bill_date          TEXT    NOT NULL,
  shop               TEXT    NOT NULL,
  payment_method     TEXT    NOT NULL DEFAULT 'Cash',
  -- What the printed receipt said. Null when not recorded. Compared against the sum of
  -- lines to surface data-entry slips, but never enforced: real receipts have discounts.
  stated_total_paise INTEGER,
  note               TEXT    NOT NULL DEFAULT '',
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX bills_household_date_idx ON bills(household_id, bill_date DESC);
CREATE INDEX bills_shop_idx ON bills(household_id, shop);

CREATE TABLE bill_lines (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id          INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity         REAL    NOT NULL CHECK (quantity > 0),
  unit             TEXT    NOT NULL,
  unit_price_paise INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise INTEGER GENERATED ALWAYS AS
                     (CAST(ROUND(quantity * unit_price_paise) AS INTEGER)) STORED,
  -- Quantity restated in a base unit (g / ml / pcs) so 1 kg and 500 g are comparable.
  base_quantity    REAL    NOT NULL CHECK (base_quantity > 0),
  base_unit        TEXT    NOT NULL,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX bill_lines_bill_idx ON bill_lines(bill_id);
CREATE INDEX bill_lines_item_idx ON bill_lines(item_id);
