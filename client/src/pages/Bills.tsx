import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import { Card, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "@shared/schemas.ts";
import type { Bill, BillSummary, Category } from "@shared/types.ts";

export function Bills() {
  const navigate = useNavigate();
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expanded, setExpanded] = useState<Record<number, Bill>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const shop = searchParams.get("shop") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const paymentMethod = searchParams.get("paymentMethod") ?? "";

  function setFilter(key: string, value: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  const categoryIdByName = useMemo(() => new Map(categories.map((c) => [c.name, c.id])), [categories]);

  const load = useCallback(() => {
    setLoading(true);
    api
      .bills({
        from: from || undefined,
        to: to || undefined,
        shop: shop || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        paymentMethod: paymentMethod ? (paymentMethod as PaymentMethod) : undefined,
      })
      .then(setBills)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load bills"))
      .finally(() => setLoading(false));
  }, [from, to, shop, categoryId, paymentMethod]);

  useEffect(load, [load]);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

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
              <input id="from" type="date" value={from} onChange={(event) => setFilter("from", event.target.value)} />
            </div>
            <div>
              <label htmlFor="to">To</label>
              <input id="to" type="date" value={to} onChange={(event) => setFilter("to", event.target.value)} />
            </div>
            <div>
              <label htmlFor="shopFilter">Shop</label>
              <input
                id="shopFilter"
                value={shop}
                onChange={(event) => setFilter("shop", event.target.value)}
                placeholder="any shop"
              />
            </div>
            <div>
              <label htmlFor="categoryFilter">Category</label>
              <select
                id="categoryFilter"
                value={categoryId}
                onChange={(event) => setFilter("categoryId", event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="paymentFilter">Paid with</label>
              <select
                id="paymentFilter"
                value={paymentMethod}
                onChange={(event) => setFilter("paymentMethod", event.target.value)}
              >
                <option value="">Any</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div className="shrink">
              <button type="button" className="ghost" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
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
              {from || to || shop || categoryId || paymentMethod ? (
                "Try widening the filters."
              ) : (
                <Link to="/new">Add your first bill</Link>
              )}
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
                        <td className="mono small" data-label="Date">
                          <Link to={`/bills/${bill.id}/edit`}>{bill.billDate}</Link>
                        </td>
                        <td className="cell-title">
                          <Link to={`/bills?shop=${encodeURIComponent(bill.shop)}`}>
                            <strong>{bill.shop}</strong>
                          </Link>
                          {bill.note && <div className="small faint">{bill.note}</div>}
                        </td>
                        <td data-label="Paid with">
                          <Link to={`/bills?paymentMethod=${bill.paymentMethod}`} className="pill pill-link">
                            {bill.paymentMethod}
                          </Link>
                        </td>
                        <td className="num-cell" data-label="Items">
                          {bill.lineCount}
                        </td>
                        <td className="num-cell" data-label="Total">
                          {/* One wrapper so this cell is a single flex item on mobile —
                              mixing bare text with an element child would otherwise split
                              into two items and misbehave under justify-content:space-between. */}
                          <div>
                            {formatPaise(bill.computedTotalPaise)}
                            {mismatch && (
                              <div className="small" style={{ color: "var(--warn)" }}>
                                receipt said {formatPaise(bill.statedTotalPaise!)}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="cell-actions">
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
                          <td colSpan={6} className="detail-cell">
                            <div className="table-wrap">
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
                                      <td className="cell-title">
                                        {line.brand && <span className="faint">{line.brand} </span>}
                                        {line.itemName}
                                      </td>
                                      <td className="small muted" data-label="Category">
                                        {line.categoryName && categoryIdByName.get(line.categoryName) !== undefined ? (
                                          <Link
                                            to={`/items?categoryId=${categoryIdByName.get(line.categoryName)}`}
                                            className="pill pill-link"
                                          >
                                            {line.categoryName}
                                          </Link>
                                        ) : (
                                          (line.categoryName ?? "Uncategorised")
                                        )}
                                      </td>
                                      <td className="num-cell mono" data-label="Qty">
                                        {line.quantity} {line.unit}
                                      </td>
                                      <td className="num-cell mono" data-label="Price / unit">
                                        {formatPaise(line.unitPricePaise)}
                                      </td>
                                      <td className="num-cell mono" data-label="Line total">
                                        {formatPaise(line.lineTotalPaise)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
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
