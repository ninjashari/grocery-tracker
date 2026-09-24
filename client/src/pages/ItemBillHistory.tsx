import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.ts";
import { Card, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import type { Item, ItemPurchase } from "@shared/types.ts";

export function ItemBillHistory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<Item | null>(null);
  const [purchases, setPurchases] = useState<ItemPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.item(Number(id)), api.itemBills(Number(id))])
      .then(([loadedItem, loadedPurchases]) => {
        setItem(loadedItem);
        setPurchases(loadedPurchases);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load purchase history"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;

  const subtitle = item ? (item.brand ? `${item.brand} ${item.name}` : item.name) : undefined;

  return (
    <>
      <PageHead title="Purchase history" subtitle={subtitle ?? "Every bill this item appears on."} />

      <ErrorBanner error={error} />

      <Card>
        <div className="card-body tight table-wrap">
          {purchases.length === 0 ? (
            <Empty title="Never bought">This item hasn't appeared on any bill yet.</Empty>
          ) : (
            <table className="row-hover row-link">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Shop</th>
                  <th className="num-cell">Bought</th>
                  <th className="num-cell">Paid / unit</th>
                  <th className="num-cell">Line total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase, index) => (
                  <tr
                    key={`${purchase.billId}-${index}`}
                    onClick={() => navigate(`/bills/${purchase.billId}/edit`)}
                  >
                    <td className="mono small cell-title">{purchase.billDate}</td>
                    <td data-label="Shop">{purchase.shop}</td>
                    <td className="num-cell mono" data-label="Bought">
                      {purchase.quantity} {purchase.unit}
                    </td>
                    <td className="num-cell mono" data-label="Paid / unit">
                      {formatPaise(purchase.unitPricePaise)}/{purchase.unit}
                    </td>
                    <td className="num-cell mono" data-label="Line total">
                      {formatPaise(purchase.lineTotalPaise)}
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
