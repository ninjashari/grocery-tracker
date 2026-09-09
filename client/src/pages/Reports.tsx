import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.ts";
import { Card, CardHead, Empty, ErrorBanner, Loading, PageHead, Segmented } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { BASE_PRICE_STEP } from "@shared/units.ts";
import type { SpendGrouping } from "@shared/schemas.ts";
import type { Item, PriceHistory, SpendReport, TopItem } from "@shared/types.ts";

const GROUPINGS: { value: SpendGrouping; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "category", label: "Category" },
  { value: "shop", label: "Shop" },
  { value: "paymentMethod", label: "Payment" },
];

/** Recharts renders into SVG, so chart colours come from CSS variables resolved at runtime. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<SpendGrouping>("month");
  const [metric, setMetric] = useState<"spend" | "quantity">("spend");

  const [spend, setSpend] = useState<SpendReport | null>(null);
  const [top, setTop] = useState<TopItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedItemId = searchParams.get("itemId") ?? "";

  const accent = useMemo(() => cssVar("--accent", "#1f6f43"), []);

  const load = useCallback(() => {
    setLoading(true);
    const range = { from: from || undefined, to: to || undefined };
    Promise.all([
      api.spend({ ...range, groupBy }),
      api.topItems({ ...range, metric, limit: 15 }),
      api.items(),
    ])
      .then(([loadedSpend, loadedTop, loadedItems]) => {
        setSpend(loadedSpend);
        setTop(loadedTop);
        setItems(loadedItems);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load reports"))
      .finally(() => setLoading(false));
  }, [from, to, groupBy, metric]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!selectedItemId) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    api
      .priceHistory(Number(selectedItemId))
      .then((result) => !cancelled && setHistory(result))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load price history"));
    return () => {
      cancelled = true;
    };
  }, [selectedItemId]);

  const spendData = (spend?.buckets ?? []).map((bucket) => ({
    label: bucket.label,
    rupees: bucket.totalPaise / 100,
    totalPaise: bucket.totalPaise,
  }));

  const stepLabel = history?.baseUnit ? BASE_PRICE_STEP[history.baseUnit].label : "";
  const historyData = (history?.points ?? []).map((point) => ({
    date: point.billDate,
    rupees: point.basePricePaise / 100,
    shop: point.shop,
    detail: `${point.quantity} ${point.unit} @ ${formatPaise(point.unitPricePaise)}/${point.unit}`,
  }));

  if (loading && !spend) return <Loading />;

  return (
    <>
      <PageHead title="Reports" subtitle="Spending patterns and how prices have moved." />

      <ErrorBanner error={error} />

      <Card>
        <div className="card-body">
          <div className="form-row">
            <div>
              <label htmlFor="rep-from">From</label>
              <input id="rep-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div>
              <label htmlFor="rep-to">To</label>
              <input id="rep-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div className="shrink">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                All time
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title={`Spend by ${GROUPINGS.find((entry) => entry.value === groupBy)?.label.toLowerCase()}`}>
          <Segmented value={groupBy} options={GROUPINGS} onChange={setGroupBy} />
        </CardHead>

        <div className="card-body">
          {spendData.length === 0 ? (
            <Empty title="Nothing in this range">Add bills or widen the date range.</Empty>
          ) : (
            <>
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={spendData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} angle={spendData.length > 6 ? -25 : 0} textAnchor={spendData.length > 6 ? "end" : "middle"} height={spendData.length > 6 ? 60 : 30} />
                    <YAxis tickLine={false} axisLine={false} width={70} tickFormatter={(value: number) => `₹${value.toLocaleString("en-IN")}`} />
                    <Tooltip
                      formatter={(value) => [formatPaise(Math.round(Number(value) * 100)), "Spend"]}
                      contentStyle={{
                        background: cssVar("--surface", "#fff"),
                        border: `1px solid ${cssVar("--border", "#ddd")}`,
                        borderRadius: 8,
                        color: cssVar("--text", "#000"),
                      }}
                    />
                    <Bar dataKey="rupees" fill={accent} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="table-wrap" style={{ marginTop: "1rem" }}>
                <table>
                  <thead>
                    <tr>
                      <th>{GROUPINGS.find((entry) => entry.value === groupBy)?.label}</th>
                      <th className="num-cell">Bills</th>
                      <th className="num-cell">Lines</th>
                      <th className="num-cell">Spend</th>
                      <th className="num-cell">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spend!.buckets.map((bucket) => (
                      <tr key={bucket.key}>
                        <td>{bucket.label}</td>
                        <td className="num-cell">{bucket.billCount}</td>
                        <td className="num-cell">{bucket.lineCount}</td>
                        <td className="num-cell mono">{formatPaise(bucket.totalPaise)}</td>
                        <td className="num-cell muted">
                          {spend!.totalPaise > 0
                            ? `${((bucket.totalPaise / spend!.totalPaise) * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {spend && spend.buckets.length > 0 && (
          <div className="totals-bar">
            <span>
              <span className="small muted">Total </span>
              <span className="amount">{formatPaise(spend.totalPaise)}</span>
            </span>
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Price history">
          <div style={{ minWidth: 260 }}>
            <select
              value={selectedItemId}
              aria-label="Item"
              onChange={(event) => {
                const next = new URLSearchParams(searchParams);
                if (event.target.value) next.set("itemId", event.target.value);
                else next.delete("itemId");
                setSearchParams(next, { replace: true });
              }}
            >
              <option value="">Pick an item…</option>
              {items.map((item) => (
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
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={70}
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
                      stroke={accent}
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
                          <td className="mono small">{point.billDate}</td>
                          <td>{point.shop}</td>
                          <td className="num-cell mono">
                            {point.quantity} {point.unit}
                          </td>
                          <td className="num-cell mono">
                            {formatPaise(point.unitPricePaise)}/{point.unit}
                          </td>
                          <td className="num-cell mono">
                            {formatPaise(Math.round(point.basePricePaise))}
                            {delta !== null && delta !== 0 && (
                              <span className={delta > 0 ? "up" : "down"} style={{ marginLeft: 6 }}>
                                {delta > 0 ? "▲" : "▼"}
                              </span>
                            )}
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

      <Card>
        <CardHead title="Top items">
          <Segmented
            value={metric}
            options={[
              { value: "spend", label: "By spend" },
              { value: "quantity", label: "By quantity" },
            ]}
            onChange={setMetric}
          />
        </CardHead>
        <div className="card-body tight table-wrap">
          {top.length === 0 ? (
            <Empty title="Nothing in this range" />
          ) : (
            <table className="row-hover">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="num-cell">Times bought</th>
                  <th className="num-cell">Quantity</th>
                  <th className="num-cell">Spend</th>
                </tr>
              </thead>
              <tbody>
                {top.map((item) => (
                  <tr key={`${item.itemId}-${item.baseUnit}`}>
                    <td>
                      <strong>{item.itemName}</strong>
                      {item.brand && <span className="faint"> · {item.brand}</span>}
                    </td>
                    <td className="small muted">{item.categoryName ?? "Uncategorised"}</td>
                    <td className="num-cell">{item.purchaseCount}</td>
                    <td className="num-cell mono">
                      {formatQuantity(item.totalBaseQuantity, item.baseUnit)}
                    </td>
                    <td className="num-cell mono">{formatPaise(item.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  );
}

/** 2500 g reads better as 2.5 kg; 800 ml stays as ml. */
function formatQuantity(baseQuantity: number, baseUnit: string): string {
  if (baseUnit === "g") return baseQuantity >= 1000 ? `${(baseQuantity / 1000).toFixed(2)} kg` : `${baseQuantity.toFixed(0)} g`;
  if (baseUnit === "ml") return baseQuantity >= 1000 ? `${(baseQuantity / 1000).toFixed(2)} L` : `${baseQuantity.toFixed(0)} ml`;
  return `${baseQuantity.toFixed(0)} pcs`;
}
