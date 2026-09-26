import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromItem = searchParams.get("fromItem");

  const [categories, setCategories] = useState<Category[]>([]);
  const [spend, setSpend] = useState<SpendReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Populates the category picker.
  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .spend({ groupBy: "month", categoryId: Number(id) })
      .then(setSpend)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load category spend"))
      .finally(() => setLoading(false));
  }, [id]);

  const category = categories.find((entry) => entry.id === Number(id)) ?? null;

  if (loading && !spend) return <Loading />;

  return (
    <>
      <PageHead
        title="Category spend"
        subtitle={category ? `${category.name} · total spend over time` : "Total spend over time."}
      />

      <ErrorBanner error={error} />

      {fromItem && <PriceHistoryTabs itemId={Number(fromItem)} categoryId={id ? Number(id) : null} />}

      <Card>
        <CardHead title="Pick a category">
          <div style={{ minWidth: 260 }}>
            <select
              value={id ?? ""}
              aria-label="Category"
              onChange={(event) => {
                if (!event.target.value) return;
                const qs = fromItem ? `?fromItem=${fromItem}` : "";
                navigate(`/categories/${event.target.value}/spend-history${qs}`);
              }}
            >
              <option value="">Pick a category…</option>
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
        </CardHead>
        <div className="card-body">
          {spend && <SpendByMonthChart buckets={spend.buckets} totalPaise={spend.totalPaise} />}
        </div>
      </Card>
    </>
  );
}
