import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.ts";
import { PriceHistoryTabs } from "../components/PriceHistoryTabs.tsx";
import { SpendByMonthChart } from "../components/SpendByMonthChart.tsx";
import { Card, CardHead, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import type { Category, SpendReport } from "@shared/types.ts";

/** A category's total spend, month by month — mixing incompatible units like kg/L/pcs
 * rules out a per-unit price trend, so this reports spend rather than price. Reached
 * either directly, or via PriceHistoryTabs' "Category trend" tab carrying `?fromItem=`
 * back to the item that linked here. */
export function CategorySpendHistory() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const fromItem = searchParams.get("fromItem");

  const [category, setCategory] = useState<Category | null>(null);
  const [spend, setSpend] = useState<SpendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.categories(), api.spend({ groupBy: "month", categoryId: Number(id) })])
      .then(([categories, loadedSpend]) => {
        setCategory(categories.find((entry) => entry.id === Number(id)) ?? null);
        setSpend(loadedSpend);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load category spend"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;

  return (
    <>
      <PageHead
        title="Category spend"
        subtitle={category ? `${category.name} · total spend over time` : "Total spend over time."}
      />

      <ErrorBanner error={error} />

      {fromItem && <PriceHistoryTabs itemId={Number(fromItem)} categoryId={id ? Number(id) : null} />}

      <Card>
        <CardHead title="Spend by month" />
        <div className="card-body">
          {spend && <SpendByMonthChart buckets={spend.buckets} totalPaise={spend.totalPaise} />}
        </div>
      </Card>
    </>
  );
}
