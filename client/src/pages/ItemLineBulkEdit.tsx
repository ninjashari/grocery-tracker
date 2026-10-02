import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiRequestError } from "../api.ts";
import { Card, Empty, ErrorBanner, Loading, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { UNITS, type Unit } from "@shared/units.ts";
import type { Item, ItemPurchase } from "@shared/types.ts";

type RowEdit = { quantity: string; unit: Unit };

export function ItemLineBulkEdit() {
  const { id } = useParams<{ id: string }>();

  const [item, setItem] = useState<Item | null>(null);
  const [purchases, setPurchases] = useState<ItemPurchase[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.item(id), api.itemBills(id)])
      .then(([loadedItem, loadedPurchases]) => {
        setItem(loadedItem);
        setPurchases(loadedPurchases);
        seedEdits(loadedPurchases);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load purchase history"))
      .finally(() => setLoading(false));
  }, [id]);

  function seedEdits(rows: ItemPurchase[]) {
    const seeded: Record<string, RowEdit> = {};
    for (const row of rows) seeded[row.lineId] = { quantity: String(row.quantity), unit: row.unit };
    setEdits(seeded);
  }

  function isDirty(row: ItemPurchase): boolean {
    const edit = edits[row.lineId];
    if (!edit) return false;
    return edit.quantity !== String(row.quantity) || edit.unit !== row.unit;
  }

  const dirtyCount = purchases.filter(isDirty).length;

  async function save() {
    if (!id) return;
    setError(null);
    setSavedMessage(null);

    const payload: { billId: string; lineId: string; quantity: number; unit: Unit }[] = [];
    for (const row of purchases) {
      if (!isDirty(row)) continue;
      const edit = edits[row.lineId]!;
      const quantity = Number(edit.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Enter a valid quantity for the ${row.billDate} line at ${row.shop}.`);
        return;
      }
      payload.push({ billId: row.billId, lineId: row.lineId, quantity, unit: edit.unit });
    }
    if (payload.length === 0) return;

    setSaving(true);
    try {
      const refreshed = await api.updateItemLines(id, payload);
      setPurchases(refreshed);
      seedEdits(refreshed);
      setSavedMessage(`Updated ${payload.length} ${payload.length === 1 ? "line" : "lines"}.`);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  const subtitle = item ? (item.brand ? `${item.brand} ${item.name}` : item.name) : undefined;

  return (
    <>
      <PageHead title="Edit quantity / unit" subtitle={subtitle ?? "Fix quantity or unit across every bill."}>
        <button type="button" className="primary" onClick={() => void save()} disabled={saving || dirtyCount === 0}>
          {saving ? "Saving…" : `Save changes${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
        </button>
      </PageHead>

      <ErrorBanner error={error} />
      {savedMessage && (
        <div className="banner ok" style={{ marginBottom: "1rem" }}>
          {savedMessage}
        </div>
      )}

      <Card>
        <div className="card-body tight table-wrap">
          {purchases.length === 0 ? (
            <Empty title="Never bought">This item hasn't appeared on any bill yet.</Empty>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Shop</th>
                  <th className="num-cell">Quantity</th>
                  <th className="num-cell">Unit</th>
                  <th className="num-cell">Line total</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((row) => {
                  const edit = edits[row.lineId] ?? { quantity: String(row.quantity), unit: row.unit };
                  const dirty = isDirty(row);
                  return (
                    <tr key={row.lineId} className={dirty ? "dirty" : undefined}>
                      <td className="mono small cell-title">{row.billDate}</td>
                      <td data-label="Shop">{row.shop}</td>
                      <td className="num-cell" data-label="Quantity">
                        <input
                          className="num"
                          inputMode="decimal"
                          value={edit.quantity}
                          onChange={(event) =>
                            setEdits((current) => ({
                              ...current,
                              [row.lineId]: { ...edit, quantity: event.target.value },
                            }))
                          }
                          aria-label={`Quantity for ${row.billDate} at ${row.shop}`}
                        />
                      </td>
                      <td className="num-cell" data-label="Unit">
                        <select
                          value={edit.unit}
                          onChange={(event) =>
                            setEdits((current) => ({
                              ...current,
                              [row.lineId]: { ...edit, unit: event.target.value as Unit },
                            }))
                          }
                          aria-label={`Unit for ${row.billDate} at ${row.shop}`}
                        >
                          {UNITS.map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="num-cell mono" data-label="Line total">
                        {formatPaise(row.lineTotalPaise)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  );
}
