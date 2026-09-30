import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ItemName } from "../api.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { Card, CardHead, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { BASE_PRICE_STEP } from "@shared/units.ts";
import type { PriceHistoryByName } from "@shared/types.ts";

/** Recharts renders into SVG, so chart colours come from CSS variables resolved at runtime. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Standalone brand-agnostic price comparison: pick a product *name* (no brand attached)
 * and see every brand's price for it merged onto one trend, with each purchase's brand and
 * pack size shown so differently-sized packages stay easy to sanity-check.
 */
export function AllBrandsPriceHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const name = searchParams.get("name") ?? "";
  const navigate = useNavigate();

  const [names, setNames] = useState<ItemName[]>([]);
  const [history, setHistory] = useState<PriceHistoryByName | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accent = useMemo(() => cssVar("--accent", "#2563eb"), []);
  const accentTeal = useMemo(() => cssVar("--accent-teal", "#0d9488"), []);
  const isPhone = useMediaQuery("(max-width: 640px)");

  useEffect(() => {
    api.itemNames().then(setNames).catch(() => {});
  }, []);

  useEffect(() => {
    if (!name) {
      setHistory(null);
      return;
    }
    setLoading(true);
    api
      .priceHistoryAllBrands(name)
      .then(setHistory)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load price history"))
      .finally(() => setLoading(false));
  }, [name]);

  function pickName(next: string) {
    setSearchParams(next ? { name: next } : {}, { replace: true });
  }

  const stepLabel = history?.baseUnit ? BASE_PRICE_STEP[history.baseUnit].label : "";
  const historyData = (history?.points ?? []).map((point) => ({
    date: point.billDate,
    rupees: point.basePricePaise / 100,
    shop: point.shop,
    brand: point.brand,
    packLabel: point.packSize !== null ? `${point.packSize} ${point.packUnit}` : null,
    detail: `${point.quantity} ${point.unit} @ ${formatPaise(point.unitPricePaise)}/${point.unit}`,
  }));

  const subtitle = history ? `${history.name} · every brand` : undefined;

  return (
    <>
      <PageHead
        title="Compare brands"
        subtitle={subtitle ?? "Pick a product to see how its price has moved across every brand that sells it."}
      />

      <ErrorBanner error={error} />

      <Card>
        <CardHead title="Pick a product">
          <div style={{ minWidth: 260 }}>
            <NamePicker names={names} value={name} onPick={pickName} />
          </div>
        </CardHead>

        <div className="card-body">
          {loading && !history ? (
            <Loading />
          ) : !name ? (
            <Empty title="Pick a product name">Search above for a product to compare its price across brands.</Empty>
          ) : !history ? null : history.points.length < 2 ? (
            <Empty title="Not enough purchases yet">
              {history.points.length === 0
                ? "This item has never been bought, under any brand."
                : "Buy it once more and a trend appears here."}
            </Empty>
          ) : (
            <>
              <div className="grid cols-4" style={{ marginBottom: "1rem" }}>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">Latest</div>
                  <div className="stat-value">{formatPaise(Math.round(history.latestBasePricePaise!))}</div>
                  <div className="stat-note faint">{stepLabel}</div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">First recorded</div>
                  <div className="stat-value">{formatPaise(Math.round(history.firstBasePricePaise!))}</div>
                  <div className="stat-note faint">{history.points[0]!.billDate}</div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">vs first</div>
                  <div className={`stat-value ${history.changeVsFirstPct! > 0 ? "up" : "down"}`}>
                    {history.changeVsFirstPct! > 0 ? "+" : ""}
                    {history.changeVsFirstPct!.toFixed(1)}%
                  </div>
                </div>
                <div className="stat" style={{ padding: 0 }}>
                  <div className="stat-label">vs previous buy</div>
                  <div
                    className={`stat-value ${
                      history.changeVsPreviousPct === null ? "" : history.changeVsPreviousPct > 0 ? "up" : "down"
                    }`}
                  >
                    {history.changeVsPreviousPct === null
                      ? "—"
                      : `${history.changeVsPreviousPct > 0 ? "+" : ""}${history.changeVsPreviousPct.toFixed(1)}%`}
                  </div>
                </div>
              </div>

              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <defs>
                      <linearGradient id="allBrandsLineStroke" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={accent} />
                        <stop offset="100%" stopColor={accentTeal} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={isPhone ? 44 : 70}
                      domain={["auto", "auto"]}
                      tickFormatter={(value: number) => `₹${value.toFixed(2)}`}
                    />
                    <Tooltip
                      formatter={(value) => [`₹${Number(value).toFixed(2)} ${stepLabel}`, "Price"]}
                      labelFormatter={(label, payload) => {
                        const point = payload?.[0]?.payload as
                          | { shop?: string; brand?: string; packLabel?: string | null; detail?: string }
                          | undefined;
                        if (!point) return label;
                        const brandLabel = point.packLabel ? `${point.brand} (${point.packLabel})` : point.brand;
                        return `${String(label)} · ${brandLabel} · ${point.shop} · ${point.detail}`;
                      }}
                      contentStyle={{
                        background: cssVar("--surface", "#fff"),
                        border: `1px solid ${cssVar("--border", "#ddd")}`,
                        borderRadius: 8,
                        color: cssVar("--text", "#000"),
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rupees"
                      stroke="url(#allBrandsLineStroke)"
                      strokeWidth={2}
                      dot={{ r: 4, fill: accent }}
                      activeDot={{ r: 6 }}
                    />
                    <Scatter dataKey="rupees" fill={accent} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="table-wrap" style={{ marginTop: "1rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Brand</th>
                      <th>Pack size</th>
                      <th>Shop</th>
                      <th className="num-cell">Bought</th>
                      <th className="num-cell">Paid / unit</th>
                      <th className="num-cell">Price {stepLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.points.map((point, index) => {
                      const previous = history.points[index - 1];
                      const delta = previous ? point.basePricePaise - previous.basePricePaise : null;
                      return (
                        <tr key={`${point.billId}-${index}`}>
                          <td className="mono small cell-title">
                            <Link to={`/bills/${point.billId}/edit`} className="link-chip small">
                              {point.billDate}
                            </Link>
                          </td>
                          <td className="small muted" data-label="Brand">
                            {point.brand || <span className="faint">—</span>}
                          </td>
                          <td className="small muted" data-label="Pack size">
                            {point.packSize !== null ? `${point.packSize} ${point.packUnit}` : <span className="faint">—</span>}
                          </td>
                          <td data-label="Shop">
                            <Link to={`/bills?shop=${encodeURIComponent(point.shop)}`} className="link-chip small">
                              {point.shop}
                            </Link>
                          </td>
                          <td className="num-cell mono" data-label="Bought">
                            {point.quantity} {point.unit}
                          </td>
                          <td className="num-cell mono" data-label="Paid / unit">
                            {formatPaise(point.unitPricePaise)}/{point.unit}
                          </td>
                          <td className="num-cell mono" data-label={`Price ${stepLabel}`}>
                            {/* One wrapper so this cell is a single flex item on mobile. */}
                            <div>
                              {formatPaise(Math.round(point.basePricePaise))}
                              {delta !== null && delta !== 0 && (
                                <span className={delta > 0 ? "up" : "down"} style={{ marginLeft: 6 }}>
                                  {delta > 0 ? "▲" : "▼"}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}

/** Search-as-you-type picker over distinct item names only — never shows brand, since the
 * whole point of this page is comparing a product irrespective of which brand sold it. */
function NamePicker({
  names,
  value,
  onPick,
}: {
  names: ItemName[];
  value: string;
  onPick: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentDown);
    return () => document.removeEventListener("mousedown", onDocumentDown);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return names.filter((entry) => entry.name.toLowerCase().includes(q)).slice(0, 12);
  }, [names, query]);

  return (
    <div className="combo" ref={wrapRef}>
      <input
        value={query}
        placeholder="Search for a product…"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {open && matches.length > 0 && (
        <div className="combo-menu" id={listId} role="listbox">
          {matches.map((entry) => (
            <button
              key={entry.name}
              type="button"
              role="option"
              aria-selected={entry.name === value}
              className={`combo-option${entry.name === value ? " active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(entry.name);
                setOpen(false);
                onPick(entry.name);
              }}
            >
              <span>{entry.name}</span>
              <span className="opt-sub">{entry.purchaseCount} purchases</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
