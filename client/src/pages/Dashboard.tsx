import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Summary } from "../api.ts";
import { monthRangeQs } from "../lib/dateRange.ts";
import { Card, CardHead, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import type { BillSummary, Category, TopItem } from "@shared/types.ts";

export function Dashboard() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<BillSummary[]>([]);
  const [top, setTop] = useState<TopItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const categoryIdByName = useMemo(() => new Map(categories.map((c) => [c.name, c.id])), [categories]);

  useEffect(() => {
    Promise.all([api.summary(), api.bills({ limit: 5 }), api.topItems({ limit: 5 }), api.categories()])
      .then(([loadedSummary, loadedBills, loadedTop, loadedCategories]) => {
        setSummary(loadedSummary);
        setRecent(loadedBills);
        setTop(loadedTop);
        setCategories(loadedCategories);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load the dashboard"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;

  const monthChange =
    summary?.currentMonth && summary.previousMonth && summary.previousMonth.totalPaise > 0
      ? ((summary.currentMonth.totalPaise - summary.previousMonth.totalPaise) / summary.previousMonth.totalPaise) * 100
      : null;

  return (
    <>
      <PageHead title="Dashboard" subtitle="Where your grocery money went.">
        <Link to="/new">
          <button type="button" className="primary">
            New bill
          </button>
        </Link>
      </PageHead>

      <ErrorBanner error={error} />

      <div className="grid cols-4">
        <Link
          to={summary?.currentMonth ? `/bills?${monthRangeQs(summary.currentMonth.month)}` : "/reports"}
          className="stat-card-link"
        >
          <Card className="stat-card">
            <div className="stat">
              <div className="stat-label">This month</div>
              <div className="stat-value">{formatPaise(summary?.currentMonth?.totalPaise ?? 0)}</div>
              <div className="stat-note">
                {monthChange === null ? (
                  <span className="faint">no previous month to compare</span>
                ) : (
                  <span className={monthChange > 0 ? "up" : "down"}>
                    {monthChange > 0 ? "▲" : "▼"} {Math.abs(monthChange).toFixed(1)}% vs last month
                  </span>
                )}
              </div>
            </div>
          </Card>
        </Link>

        <Link
          to={summary?.previousMonth ? `/bills?${monthRangeQs(summary.previousMonth.month)}` : "/reports"}
          className="stat-card-link"
        >
          <Card className="stat-card">
            <div className="stat">
              <div className="stat-label">Last month</div>
              <div className="stat-value">{formatPaise(summary?.previousMonth?.totalPaise ?? 0)}</div>
              <div className="stat-note faint">previous calendar month with bills</div>
            </div>
          </Card>
        </Link>

        <Link to="/bills" className="stat-card-link">
          <Card className="stat-card">
            <div className="stat">
              <div className="stat-label">All time</div>
              <div className="stat-value">{formatPaise(summary?.totalPaise ?? 0)}</div>
              <div className="stat-note faint">
                across {summary?.billCount ?? 0} bill{summary?.billCount === 1 ? "" : "s"}
              </div>
            </div>
          </Card>
        </Link>

        <Link to="/items" className="stat-card-link">
          <Card className="stat-card">
            <div className="stat">
              <div className="stat-label">Items tracked</div>
              <div className="stat-value">{summary?.itemCount ?? 0}</div>
              <div className="stat-note faint">in your catalog</div>
            </div>
          </Card>
        </Link>
      </div>

      <div className="grid cols-2" style={{ marginTop: "1.25rem" }}>
        <Card>
          <CardHead title="Recent bills">
            <Link to="/bills" className="small">
              View all
            </Link>
          </CardHead>
          <div className="card-body tight table-wrap">
            {recent.length === 0 ? (
              <Empty title="No bills yet">
                <Link to="/new">Add your first bill</Link> to start tracking.
              </Empty>
            ) : (
              <table className="row-hover row-link">
                <tbody>
                  {recent.map((bill) => (
                    <tr key={bill.id} onClick={() => navigate(`/bills/${bill.id}/edit`)}>
                      <td className="cell-title">
                        <Link
                          to={`/bills?shop=${encodeURIComponent(bill.shop)}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <strong>{bill.shop}</strong>
                        </Link>
                        <div className="small faint">
                          {bill.billDate} · {bill.lineCount} item{bill.lineCount === 1 ? "" : "s"} ·{" "}
                          <Link
                            to={`/bills?paymentMethod=${bill.paymentMethod}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {bill.paymentMethod}
                          </Link>
                        </div>
                      </td>
                      <td className="num-cell">{formatPaise(bill.computedTotalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Top items by spend">
            <Link to="/reports" className="small">
              Reports
            </Link>
          </CardHead>
          <div className="card-body tight table-wrap">
            {top.length === 0 ? (
              <Empty title="Nothing to rank yet">Add a bill and this fills in.</Empty>
            ) : (
              <table className="row-hover row-link">
                <tbody>
                  {top.map((item) => (
                    <tr
                      key={`${item.itemId}-${item.baseUnit}`}
                      onClick={() => navigate(`/items/${item.itemId}/price-history`)}
                    >
                      <td className="cell-title">
                        <strong>{item.itemName}</strong>
                        {item.brand && <span className="faint"> · {item.brand}</span>}
                        <div className="small faint">
                          {item.categoryName && categoryIdByName.get(item.categoryName) !== undefined ? (
                            <Link
                              to={`/items?categoryId=${categoryIdByName.get(item.categoryName)}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {item.categoryName}
                            </Link>
                          ) : (
                            (item.categoryName ?? "Uncategorised")
                          )}{" "}
                          · bought {item.purchaseCount}×
                        </div>
                      </td>
                      <td className="num-cell">{formatPaise(item.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
