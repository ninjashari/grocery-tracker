import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { Card, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import type { Bill, BillSummary } from "@shared/types.ts";

export function Bills() {
  const navigate = useNavigate();
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [expanded, setExpanded] = useState<Record<number, Bill>>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shop, setShop] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .bills({ from: from || undefined, to: to || undefined, shop: shop || undefined })
      .then(setBills)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load bills"))
      .finally(() => setLoading(false));
  }, [from, to, shop]);

  useEffect(load, [load]);

  async function toggle(id: number) {
    if (expanded[id]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const bill = await api.bill(id);
      setExpanded((current) => ({ ...current, [id]: bill }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that bill");
    }
  }

  async function remove(bill: BillSummary) {
    const confirmed = window.confirm(
      `Delete the ${bill.billDate} bill from ${bill.shop} (${formatPaise(bill.computedTotalPaise)})? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      await api.deleteBill(bill.id);
      load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete that bill");
    }
  }

  const total = bills.reduce((sum, bill) => sum + bill.computedTotalPaise, 0);

  return (
    <>
      <PageHead title="Bills" subtitle="Every shopping trip you've logged.">
        <Link to="/new">
          <button type="button" className="primary">
            New bill
          </button>
        </Link>
      </PageHead>

      <ErrorBanner error={error} />

      <Card>
        <div className="card-body">
          <div className="form-row">
            <div>
              <label htmlFor="from">From</label>
              <input id="from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </div>
            <div>
              <label htmlFor="to">To</label>
              <input id="to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
            <div>
              <label htmlFor="shopFilter">Shop</label>
              <input
                id="shopFilter"
                value={shop}
                onChange={(event) => setShop(event.target.value)}
                placeholder="any shop"
              />
            </div>
            <div className="shrink">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setShop("");
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-body tight table-wrap">
          {loading ? (
            <Loading />
          ) : bills.length === 0 ? (
            <Empty title="No bills match">
              {from || to || shop ? "Try widening the filters." : <Link to="/new">Add your first bill</Link>}
            </Empty>
          ) : (
            <table className="row-hover">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Date</th>
                  <th>Shop</th>
                  <th>Paid with</th>
                  <th className="num-cell">Items</th>
                  <th className="num-cell">Total</th>
                  <th style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {bills.map((bill) => {
                  const detail = expanded[bill.id];
                  const mismatch =
                    bill.statedTotalPaise !== null && bill.statedTotalPaise !== bill.computedTotalPaise;

                  return (
                    <Fragment key={bill.id}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="ghost small"
                            onClick={() => void toggle(bill.id)}
                            aria-expanded={Boolean(detail)}
                            aria-label={detail ? "Hide items" : "Show items"}
                          >
                            {detail ? "▾" : "▸"}
                          </button>
                        </td>
                        <td className="mono small">{bill.billDate}</td>
                        <td>
                          <strong>{bill.shop}</strong>
                          {bill.note && <div className="small faint">{bill.note}</div>}
                        </td>
                        <td>
                          <span className="pill">{bill.paymentMethod}</span>
                        </td>
                        <td className="num-cell">{bill.lineCount}</td>
                        <td className="num-cell">
                          {formatPaise(bill.computedTotalPaise)}
                          {mismatch && (
                            <div className="small" style={{ color: "var(--warn)" }}>
                              receipt said {formatPaise(bill.statedTotalPaise!)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="button-row">
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() => navigate(`/bills/${bill.id}/edit`)}
                            >
                              Edit
                            </button>
                            <button type="button" className="danger small" onClick={() => void remove(bill)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>

                      {detail && (
                        <tr>
                          <td />
                          <td colSpan={6} style={{ padding: 0, background: "var(--surface-2)" }}>
                            <table>
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th>Category</th>
                                  <th className="num-cell">Qty</th>
                                  <th className="num-cell">Price / unit</th>
                                  <th className="num-cell">Line total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.lines.map((line) => (
                                  <tr key={line.id}>
                                    <td>
                                      {line.brand && <span className="faint">{line.brand} </span>}
                                      {line.itemName}
                                    </td>
                                    <td className="small muted">{line.categoryName ?? "Uncategorised"}</td>
                                    <td className="num-cell mono">
                                      {line.quantity} {line.unit}
                                    </td>
                                    <td className="num-cell mono">{formatPaise(line.unitPricePaise)}</td>
                                    <td className="num-cell mono">{formatPaise(line.lineTotalPaise)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {bills.length > 0 && (
          <div className="totals-bar">
            <span className="small muted">
              {bills.length} bill{bills.length === 1 ? "" : "s"} shown
            </span>
            <span>
              <span className="small muted">Total </span>
              <span className="amount">{formatPaise(total)}</span>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
