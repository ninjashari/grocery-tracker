import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { PriceHistoryTabs } from "../components/PriceHistoryTabs.tsx";
import { Card, CardHead, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { BASE_PRICE_STEP } from "@shared/units.ts";
import type { Item, PriceHistory as PriceHistoryData } from "@shared/types.ts";

/** Recharts renders into SVG, so chart colours come from CSS variables resolved at runtime. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function PriceHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<PriceHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const accent = useMemo(() => cssVar("--accent", "#2563eb"), []);
  const accentTeal = useMemo(() => cssVar("--accent-teal", "#0d9488"), []);
  const isPhone = useMediaQuery("(max-width: 640px)");

  // Populates the item picker — only items with enough purchases to show a trend.
  useEffect(() => {
    api.items().then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .priceHistory(Number(id))
      .then(setHistory)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load price history"))
      .finally(() => setLoading(false));
  }, [id]);

  const stepLabel = history?.baseUnit ? BASE_PRICE_STEP[history.baseUnit].label : "";
  const historyData = (history?.points ?? []).map((point) => ({
    date: point.billDate,
    rupees: point.basePricePaise / 100,
    shop: point.shop,
    detail: `${point.quantity} ${point.unit} @ ${formatPaise(point.unitPricePaise)}/${point.unit}`,
  }));

  const pickableItems = items.filter((item) => item.purchaseCount > 1);
  const subtitle = history ? (history.item.brand ? `${history.item.brand} ${history.item.name}` : history.item.name) : undefined;

  if (loading && !history) return <Loading />;

  return (
    <>
      <PageHead title="Price history" subtitle={subtitle ?? "How an item's price has moved over time."} />

      {history && <PriceHistoryTabs itemId={history.item.id} categoryId={history.item.categoryId} />}

      <ErrorBanner error={error} />

      <Card>
        <CardHead title="Pick an item">
          <div style={{ minWidth: 260 }}>
            <select
              value={id ?? ""}
              aria-label="Item"
              onChange={(event) => {
                if (event.target.value) navigate(`/items/${event.target.value}/price-history`);
              }}
            >
              <option value="">Pick an item…</option>
              {pickableItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.brand ? `${item.brand} ${item.name}` : item.name}
                </option>
              ))}
            </select>
          </div>
        </CardHead>

        <div className="card-body">
          {!history ? (
            <Empty title="No item selected">
              Pick an item to see how its price has moved. Prices are quoted per 100 g / 100 ml / piece, so
              purchases in different units are directly comparable.
            </Empty>
          ) : history.points.length < 2 ? (
            <Empty title="Not enough purchases yet">
              {history.points.length === 0
                ? "This item has never been bought."
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
                      <linearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
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
                        const point = payload?.[0]?.payload as { shop?: string; detail?: string } | undefined;
                        return point ? `${String(label)} · ${point.shop} · ${point.detail}` : label;
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
                      stroke="url(#lineStroke)"
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
