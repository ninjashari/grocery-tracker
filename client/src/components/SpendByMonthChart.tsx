import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMediaQuery } from "../hooks/useMediaQuery.ts";
import { monthRange } from "../lib/dateRange.ts";
import { Empty } from "./ui.tsx";
import { formatPaise } from "@shared/money.ts";
import type { SpendBucket } from "@shared/types.ts";

/** Recharts renders into SVG, so chart colours come from CSS variables resolved at runtime. */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Month-grouped spend, as a bar chart + table. Shared by Reports.tsx's month view and
 * CategorySpendHistory.tsx, so both render identically with no copy-pasted JSX. */
export function SpendByMonthChart({ buckets, totalPaise }: { buckets: SpendBucket[]; totalPaise: number }) {
  const accent = useMemo(() => cssVar("--accent", "#2563eb"), []);
  const accent2 = useMemo(() => cssVar("--accent-2", "#7c3aed"), []);
  const isPhone = useMediaQuery("(max-width: 640px)");

  const spendData = buckets.map((bucket) => ({
    label: bucket.label,
    rupees: bucket.totalPaise / 100,
  }));

  if (buckets.length === 0) {
    return <Empty title="Nothing in this range">Add bills or widen the date range.</Empty>;
  }

  return (
    <>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={spendData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <defs>
              <linearGradient id="spendByMonthBarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent2} />
                <stop offset="100%" stopColor={accent} stopOpacity={0.85} />
              </linearGradient>
            </defs>
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
            <Bar dataKey="rupees" fill="url(#spendByMonthBarFill)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap" style={{ marginTop: "1rem" }}>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th className="num-cell">Bills</th>
              <th className="num-cell">Lines</th>
              <th className="num-cell">Spend</th>
              <th className="num-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const { from, to } = monthRange(bucket.key);
              return (
                <tr key={bucket.key}>
                  <td className="cell-title">
                    <Link to={`/bills?from=${from}&to=${to}`} className="link-chip small">
                      {bucket.label}
                    </Link>
                  </td>
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
                    {totalPaise > 0 ? `${((bucket.totalPaise / totalPaise) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
