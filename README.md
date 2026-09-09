# Grocery Tracker

Log each day's grocery bill, keep a catalog of what you buy, and see where the money goes.

- **Item catalog** — brand, name, category, usual unit. Items are created inline while
  entering a bill, so entry never has to stop.
- **Bill entry** — date, shop, payment method and the printed total, plus one line per
  item (quantity, unit, price per unit). Line totals are computed.
- **Reports** — spend by month / category / shop / payment method, per-item price history,
  and top items by spend or quantity.
- **CSV import & export** — round-trippable, with a dry-run preview before anything is written.
- **Households** — several people share one dataset; each account signs in separately.

Currency is INR (₹) and units are metric: kg, g, L, ml, pcs, pack, dozen.

## Requirements

Node **24 or newer**. The server runs TypeScript directly through Node's native type
stripping and stores data with the built-in `node:sqlite` module, so there is no build step
for the server and no native modules to compile.

## Running it

```bash
npm install
```

```bash
npm run dev
```

That starts the API on `http://localhost:5174` and the Vite dev server on
`http://localhost:5173`. Open the second one. Both bind to all interfaces, so the app is
reachable from a phone on the same wifi at `http://<your-machine-ip>:5173`.

Copy `.env.example` to `.env` to change the port or the data directory.

For a single-process production run, build the client first — the server then serves it
from the same origin:

```bash
npm run build && npm start
```

## First use

Sign up to create a household. That seeds twelve editable categories (Produce, Dairy,
Bakery, …) and signs you in. Add other people from **Settings → Add member**; everyone in
a household sees and edits the same items, bills and reports.

## How prices are compared

Prices are entered **per unit** — what the shelf label says. The line total is
`quantity × unit price`.

Every line is also stored in a base unit (mass → g, volume → ml, count → pcs), which is
what makes price history trustworthy: 1 kg at ₹60/kg and 500 g at ₹0.06/g are the same
rate, so they land on the same curve. Price history is quoted per 100 g, per 100 ml or per
piece.

Money is stored as integer paise throughout — never as a float.

## CSV format

```
bill_date, shop, payment_method, brand, item_name, category, quantity, unit, unit_price, line_total, note
```

Required: `bill_date` (YYYY-MM-DD), `shop`, `item_name`, `quantity`, `unit`. Either
`unit_price` or `line_total` must be present; if only the total is given, the unit price is
derived from it. Rows sharing a date, shop and payment method become one bill.

Import always shows a preview first — how many bills and lines, which items, categories and
shops are new, and which rows are invalid. Nothing is written until you confirm, and
invalid rows are skipped rather than failing the whole file. An export can always be
re-imported without creating duplicates.

## Layout

```
shared/     units, money, CSV and zod schemas — used by both server and client
server/     Express API; routes/ per resource, lib/ for the logic they share
  db/       connection, migrations (applied at boot), category seed
client/     React app; pages/ per screen, components/ for shared UI
tests/      vitest — unit tests for shared/, integration tests against the real API
```

## Commands

```bash
npm test
```

```bash
npm run typecheck
```

`npm run build` builds the client into `dist/client`.

## Data and deployment

The database is a single SQLite file at `data/grocery.db` (override with `DATA_DIR` or
`DB_PATH`). Back it up by copying that file. Schema changes go in
`server/db/migrations/` as new numbered `.sql` files, applied in filename order at
startup — never rename one that has already run.

The included `Dockerfile` runs the same single process and keeps the database in a `/data`
volume:

```bash
docker build -t grocery-tracker . && docker run -p 5174:5174 -v grocery-data:/data grocery-tracker
```

Set `SESSION_SECRET` and run behind TLS if you expose it beyond your own network; session
cookies are marked `secure` when `NODE_ENV=production`.
