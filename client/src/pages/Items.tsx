import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../api.ts";
import { Card, Empty, ErrorBanner, Loading, Modal, PageHead } from "../components/ui.tsx";
import { formatPaise } from "@shared/money.ts";
import { UNITS, type Unit } from "@shared/units.ts";
import type { Category, Item } from "@shared/types.ts";

export function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.items({
        q: query || undefined,
        categoryId: categoryId ? Number(categoryId) : undefined,
        includeArchived,
      }),
      api.categories(),
    ])
      .then(([loadedItems, loadedCategories]) => {
        setItems(loadedItems);
        setCategories(loadedCategories);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load items"))
      .finally(() => setLoading(false));
  }, [query, categoryId, includeArchived]);

  useEffect(load, [load]);

  async function remove(item: Item) {
    const confirmed = window.confirm(
      item.purchaseCount > 0
        ? `"${item.name}" appears on ${item.purchaseCount} bill line(s). It will be archived — hidden from pickers but kept in your reports. Continue?`
        : `Delete "${item.name}"? It has never been bought, so it will be removed completely.`,
    );
    if (!confirmed) return;
    try {
      await api.deleteItem(item.id);
      load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not delete that item");
    }
  }

  async function unarchive(item: Item) {
    try {
      await api.updateItem(item.id, { archived: false });
      load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not restore that item");
    }
  }

  return (
    <>
      <PageHead title="Items" subtitle="Your grocery catalog. Prices here come from your bills.">
        <button type="button" className="primary" onClick={() => setEditing("new")}>
          Add item
        </button>
      </PageHead>

      <ErrorBanner error={error} />

      <Card>
        <div className="card-body">
          <div className="form-row">
            <div>
              <label htmlFor="search">Search</label>
              <input
                id="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="brand or name"
              />
            </div>
            <div>
              <label htmlFor="categoryFilter">Category</label>
              <select
                id="categoryFilter"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="shrink">
              <label htmlFor="archived">Archived</label>
              <label className="small muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  id="archived"
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                />
                show archived
              </label>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-body tight table-wrap">
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <Empty title="No items yet">
              Items are created automatically as you enter bills, or{" "}
              <button type="button" className="ghost small" onClick={() => setEditing("new")}>
                add one now
              </button>
              .
            </Empty>
          ) : (
            <table className="row-hover">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th className="num-cell">Last price</th>
                  <th className="num-cell">Bought</th>
                  <th style={{ width: 190 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} style={item.archived ? { opacity: 0.6 } : undefined}>
                    <td>
                      <strong>{item.name}</strong>
                      {item.brand && <span className="faint"> · {item.brand}</span>}
                      {item.archived && <span className="pill" style={{ marginLeft: 8 }}>archived</span>}
                    </td>
                    <td className="small muted">{item.categoryName ?? "Uncategorised"}</td>
                    <td className="small muted">{item.defaultUnit}</td>
                    <td className="num-cell mono">
                      {item.lastUnitPricePaise === null ? (
                        <span className="faint">—</span>
                      ) : (
                        <>
                          {formatPaise(item.lastUnitPricePaise)}
                          <span className="faint">/{item.lastUnit}</span>
                          <div className="small faint">{item.lastPurchasedOn}</div>
                        </>
                      )}
                    </td>
                    <td className="num-cell">{item.purchaseCount}</td>
                    <td>
                      <div className="button-row">
                        {item.purchaseCount > 1 && (
                          <Link to={`/reports?itemId=${item.id}`} className="small">
                            Price history
                          </Link>
                        )}
                        <button type="button" className="ghost small" onClick={() => setEditing(item)}>
                          Edit
                        </button>
                        {item.archived ? (
                          <button type="button" className="ghost small" onClick={() => void unarchive(item)}>
                            Restore
                          </button>
                        ) : (
                          <button type="button" className="danger small" onClick={() => void remove(item)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {editing && (
        <ItemDialog
          item={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function ItemDialog({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: Item | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState(item?.categoryId ? String(item.categoryId) : "");
  const [defaultUnit, setDefaultUnit] = useState<Unit>(item?.defaultUnit ?? "pcs");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const payload = {
      brand: brand.trim(),
      name: name.trim(),
      categoryId: categoryId === "" ? null : Number(categoryId),
      defaultUnit,
    };
    try {
      if (item) await api.updateItem(item.id, payload);
      else await api.createItem(payload);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not save the item");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? "Edit item" : "Add item"} onClose={onClose}>
      <ErrorBanner error={error} />

      <div className="field">
        <label htmlFor="item-brand">Brand</label>
        <input
          id="item-brand"
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          placeholder="optional"
        />
      </div>

      <div className="field">
        <label htmlFor="item-name">Item name</label>
        <input id="item-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>

      <div className="form-row" style={{ marginBottom: "1rem" }}>
        <div>
          <label htmlFor="item-category">Category</label>
          <select id="item-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="item-unit">Usual unit</label>
          <select
            id="item-unit"
            value={defaultUnit}
            onChange={(event) => setDefaultUnit(event.target.value as Unit)}
          >
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="button-row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || name.trim() === ""} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
