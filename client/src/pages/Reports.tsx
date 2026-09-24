import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.ts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { Card, CardHead, Empty, ErrorBanner, Loading, PageHead, Segmented } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import type { SpendGrouping } from "@shared/schemas.ts";
import type { SpendReport, TopItem } from "@shared/types.ts";

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
  const navigate = useNavigate();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<SpendGrouping>("month");
  const [metric, setMetric] = useState<"spend" | "quantity">("spend");

  const [spend, setSpend] = useState<SpendReport | null>(null);
  const [top, setTop] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const accent = useMemo(() => cssVar("--accent", "#1f6f43"), []);
  // Narrow phones need the Y-axis to give up width, and shop-name-length axis labels to
  // rotate even when there are only a few of them (the data-length check alone misses that).
  const isPhone = useMediaQuery("(max-width: 640px)");

  const load = useCallback(() => {
    setLoading(true);
    const range = { from: from || undefined, to: to || undefined };
    Promise.all([api.spend({ ...range, groupBy }), api.topItems({ ...range, metric, limit: 15 })])
      .then(([loadedSpend, loadedTop]) => {
        setSpend(loadedSpend);
        setTop(loadedTop);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load reports"))
      .finally(() => setLoading(false));
  }, [from, to, groupBy, metric]);

  useEffect(load, [load]);

  const spendData = (spend?.buckets ?? []).map((bucket) => ({
    label: bucket.label,
    rupees: bucket.totalPaise / 100,
    totalPaise: bucket.totalPaise,
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
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={isPhone || spendData.length > 6 ? -25 : 0}
                      textAnchor={isPhone || spendData.length > 6 ? "end" : "middle"}
                      height={isPhone || spendData.length > 6 ? 60 : 30}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={isPhone ? 44 : 70}
                      tickFormatter={(value: number) => `₹${value.toLocaleString("en-IN")}`}
                    />
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
                        <td className="cell-title">{bucket.label}</td>
                        <td className="num-cell" data-label="Bills">
                          {bucket.billCount}
                        </td>
                        <td className="num-cell" data-label="Lines">
                          {bucket.lineCount}
                        </td>
                        <td className="num-cell mono" data-label="Spend">
                          {formatPaise(bucket.totalPaise)}
                        </td>
                        <td className="num-cell muted" data-label="Share">
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
            <table className="row-hover row-link">
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
                  <tr
                    key={`${item.itemId}-${item.baseUnit}`}
                    onClick={() => navigate(`/items/${item.itemId}/price-history`)}
                  >
                    <td className="cell-title">
                      <strong>{item.itemName}</strong>
                      {item.brand && <span className="faint"> · {item.brand}</span>}
                    </td>
                    <td className="small muted" data-label="Category">
                      {item.categoryName ?? "Uncategorised"}
                    </td>
                    <td className="num-cell" data-label="Times bought">
                      {item.purchaseCount}
                    </td>
                    <td className="num-cell mono" data-label="Quantity">
                      {formatQuantity(item.totalBaseQuantity, item.baseUnit)}
                    </td>
                    <td className="num-cell mono" data-label="Spend">
                      {formatPaise(item.totalPaise)}
                    </td>
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
