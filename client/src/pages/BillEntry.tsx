import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiRequestError, type Shop } from "../api.ts";
import { Card, CardHead, ErrorBanner, Loading, Modal, PageHead } from "../components/ui.tsx";
import { ItemCombo, type ItemChoice } from "../components/ItemCombo.tsx";
import { formatPaise, lineTotalPaise, rupeesToPaise } from "@shared/money.ts";
import { UNITS, type Unit } from "@shared/units.ts";
import { PAYMENT_METHODS, type PaymentMethod } from "@shared/schemas.ts";
import type { Category, Item } from "@shared/types.ts";
import type { BillInput } from "@shared/schemas.ts";

type NewItemDraft = { brand: string; name: string; categoryId: number | null; defaultUnit: Unit };

type LineDraft = {
  key: string;
  /** Set once an existing item is picked. */
  itemId: number | null;
  /** Set once a new item is confirmed in the create dialog. */
  newItem: NewItemDraft | null;
  /** What is typed in the combo. Kept even after picking, so the field shows the choice. */
  search: string;
  quantity: string;
  unit: Unit;
  unitPrice: string;
};

let keyCounter = 0;
const emptyLine = (): LineDraft => ({
  key: `line-${keyCounter++}`,
  itemId: null,
  newItem: null,
  search: "",
  quantity: "",
  unit: "pcs",
  unitPrice: "",
});

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time.

const itemLabel = (item: Item) => (item.brand ? `${item.brand} ${item.name}` : item.name);

/** Splits "Amul Milk" into brand + name using a known brand list; falls back to no brand. */
function splitLabel(label: string, knownBrands: string[]): { brand: string; name: string } {
  const match = knownBrands.find(
    (brand) => brand && label.toLowerCase().startsWith(`${brand.toLowerCase()} `),
  );
  if (match) return { brand: match, name: label.slice(match.length).trim() };
  return { brand: "", name: label };
}

export function BillEntry() {
  const params = useParams();
  const navigate = useNavigate();
  const editingId = params["id"] ? Number(params["id"]) : null;

  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  const [billDate, setBillDate] = useState(today());
  const [shop, setShop] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Cash");
  const [statedTotal, setStatedTotal] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [creatingFor, setCreatingFor] = useState<{ key: string; label: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const itemRefs = useRef(new Map<string, HTMLInputElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const registerItemRef = useCallback((key: string, node: HTMLInputElement | null) => {
    if (node) itemRefs.current.set(key, node);
    else itemRefs.current.delete(key);
  }, []);

  // Focus after the row has been committed. Scheduling the focus straight from the click
  // handler races React's render, and the new input isn't in the DOM yet.
  useEffect(() => {
    if (focusKey === null) return;
    itemRefs.current.get(focusKey)?.focus();
    setFocusKey(null);
  }, [focusKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.items(), api.categories(), api.shops()])
      .then(([loadedItems, loadedCategories, loadedShops]) => {
        if (cancelled) return;
        setItems(loadedItems);
        setCategories(loadedCategories);
        setShops(loadedShops);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load data"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Editing loads the existing bill into the same form the create flow uses.
  useEffect(() => {
    if (editingId === null) return;
    let cancelled = false;
    api
      .bill(editingId)
      .then((bill) => {
        if (cancelled) return;
        setBillDate(bill.billDate);
        setShop(bill.shop);
        setPaymentMethod(bill.paymentMethod);
        setStatedTotal(bill.statedTotalPaise === null ? "" : (bill.statedTotalPaise / 100).toFixed(2));
        setNote(bill.note);
        setLines(
          bill.lines.map((line) => ({
            key: `line-${keyCounter++}`,
            itemId: line.itemId,
            newItem: null,
            search: line.brand ? `${line.brand} ${line.itemName}` : line.itemName,
            quantity: String(line.quantity),
            unit: line.unit,
            unitPrice: (line.unitPricePaise / 100).toFixed(2),
          })),
        );
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not load that bill"));
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const knownBrands = useMemo(
    () => [...new Set(items.map((item) => item.brand).filter(Boolean))].sort((a, b) => b.length - a.length),
    [items],
  );

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const addLine = useCallback(() => {
    const line = emptyLine();
    setLines((current) => [...current, line]);
    setFocusKey(line.key);
  }, []);

  function removeLine(key: string) {
    setLines((current) => (current.length === 1 ? [emptyLine()] : current.filter((line) => line.key !== key)));
  }

  function pick(key: string, choice: ItemChoice) {
    if (choice.kind === "existing") {
      const { item } = choice;
      update(key, {
        itemId: item.id,
        newItem: null,
        search: itemLabel(item),
        unit: item.lastUnit ?? item.defaultUnit,
        // Prefilling last paid price is what makes a repeat shop mostly Enter, Enter, Enter.
        unitPrice: item.lastUnitPricePaise !== null ? (item.lastUnitPricePaise / 100).toFixed(2) : "",
      });
    } else {
      setCreatingFor({ key, label: choice.label });
    }
  }

  function confirmNewItem(draft: NewItemDraft) {
    if (!creatingFor) return;
    update(creatingFor.key, {
      itemId: null,
      newItem: draft,
      search: draft.brand ? `${draft.brand} ${draft.name}` : draft.name,
      unit: draft.defaultUnit,
    });
    setCreatingFor(null);
  }

  const computed = useMemo(() => {
    let total = 0;
    let ready = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const price = rupeesToPaise(line.unitPrice);
      const hasItem = line.itemId !== null || line.newItem !== null;
      if (hasItem && Number.isFinite(quantity) && quantity > 0 && price !== null) {
        total += lineTotalPaise(quantity, price);
        ready += 1;
      }
    }
    return { total, ready };
  }, [lines]);

  const statedPaise = rupeesToPaise(statedTotal);
  const difference = statedPaise === null ? null : computed.total - statedPaise;

  function buildPayload(): BillInput | null {
    const payloadLines: BillInput["lines"] = [];

    for (const line of lines) {
      const quantity = Number(line.quantity);
      const unitPricePaise = rupeesToPaise(line.unitPrice);
      const hasItem = line.itemId !== null || line.newItem !== null;

      // Blank trailing rows are normal in a grid; skip them rather than erroring.
      if (!hasItem && line.search.trim() === "" && line.quantity === "" && line.unitPrice === "") continue;

      if (!hasItem) {
        setError(`Pick or create an item for "${line.search || "the empty row"}"`);
        return null;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Enter a quantity greater than zero for "${line.search}"`);
        return null;
      }
      if (unitPricePaise === null || unitPricePaise < 0) {
        setError(`Enter a unit price for "${line.search}"`);
        return null;
      }

      payloadLines.push(
        line.itemId !== null
          ? { itemId: line.itemId, quantity, unit: line.unit, unitPricePaise }
          : { newItem: line.newItem!, quantity, unit: line.unit, unitPricePaise },
      );
    }

    if (payloadLines.length === 0) {
      setError("Add at least one line before saving");
      return null;
    }
    if (shop.trim() === "") {
      setError("Enter the shop name");
      return null;
    }

    return {
      billDate,
      shop: shop.trim(),
      paymentMethod,
      statedTotalPaise: statedPaise,
      note: note.trim(),
      lines: payloadLines,
    };
  }

  async function save() {
    setError(null);
    setSavedMessage(null);
    const payload = buildPayload();
    if (!payload) return;

    setSaving(true);
    try {
      if (editingId !== null) {
        await api.updateBill(editingId, payload);
        navigate("/bills");
        return;
      }

      const bill = await api.createBill(payload);
      setSavedMessage(`Saved ${formatPaise(bill.computedTotalPaise)} at ${bill.shop}.`);
      // Keep date, shop and payment method: several bills from one trip is the common case.
      setLines([emptyLine()]);
      setStatedTotal("");
      setNote("");
      const [refreshedItems, refreshedShops] = await Promise.all([api.items(), api.shops()]);
      setItems(refreshedItems);
      setShops(refreshedShops);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : "Could not save the bill");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHead
        title={editingId !== null ? "Edit bill" : "New bill"}
        subtitle="Enter what the receipt says. Line totals are worked out for you."
      >
        {editingId !== null && (
          <button type="button" className="ghost" onClick={() => navigate("/bills")}>
            Cancel
          </button>
        )}
        <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : editingId !== null ? "Save changes" : "Save bill"}
        </button>
      </PageHead>

      <ErrorBanner error={error} />
      {savedMessage && (
        <div className="banner ok" style={{ marginBottom: "1rem" }}>
          {savedMessage}
        </div>
      )}

      <Card>
        <div className="card-body">
          <div className="form-row">
            <div>
              <label htmlFor="billDate">Date</label>
              <input
                id="billDate"
                type="date"
                value={billDate}
                onChange={(event) => setBillDate(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="shop">Shop</label>
              <input
                id="shop"
                list="shop-options"
                value={shop}
                onChange={(event) => setShop(event.target.value)}
                placeholder="e.g. DMart"
              />
              <datalist id="shop-options">
                {shops.map((entry) => (
                  <option key={entry.shop} value={entry.shop} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="payment">Paid with</label>
              <select
                id="payment"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="statedTotal">Bill total (as printed)</label>
              <input
                id="statedTotal"
                className="num"
                inputMode="decimal"
                value={statedTotal}
                onChange={(event) => setStatedTotal(event.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Items">
          <span className="small faint">Enter on an empty item field adds a row</span>
        </CardHead>

        <div className="card-body tight table-wrap">
          <table className="lines-table">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-qty num-cell">Qty</th>
                <th className="col-unit">Unit</th>
                <th className="col-price num-cell">Price / unit</th>
                <th className="col-total num-cell">Line total</th>
                <th className="col-x" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const quantity = Number(line.quantity);
                const price = rupeesToPaise(line.unitPrice);
                const total =
                  Number.isFinite(quantity) && quantity > 0 && price !== null
                    ? lineTotalPaise(quantity, price)
                    : null;

                return (
                  <tr key={line.key}>
                    <td>
                      <ItemCombo
                        ref={(node) => registerItemRef(line.key, node)}
                        items={items}
                        value={line.search}
                        onValueChange={(value) =>
                          // Typing after a pick clears the link, so a stale item can't be saved.
                          update(line.key, { search: value, itemId: null, newItem: null })
                        }
                        onPick={(choice) => pick(line.key, choice)}
                        onEnterEmpty={index === lines.length - 1 ? addLine : undefined}
                      />
                    </td>
                    <td>
                      <input
                        className="num"
                        inputMode="decimal"
                        value={line.quantity}
                        onChange={(event) => update(line.key, { quantity: event.target.value })}
                        aria-label="Quantity"
                      />
                    </td>
                    <td>
                      <select
                        value={line.unit}
                        onChange={(event) => update(line.key, { unit: event.target.value as Unit })}
                        aria-label="Unit"
                      >
                        {UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="num"
                        inputMode="decimal"
                        value={line.unitPrice}
                        onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                        aria-label="Price per unit"
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && index === lines.length - 1) {
                            event.preventDefault();
                            addLine();
                          }
                        }}
                      />
                    </td>
                    <td className="num-cell mono">{total === null ? <span className="faint">—</span> : formatPaise(total)}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => removeLine(line.key)}
                        aria-label="Remove line"
                        title="Remove line"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card-body" style={{ paddingTop: 0 }}>
          <button type="button" className="small" onClick={addLine}>
            + Add line
          </button>
        </div>

        <div className="totals-bar">
          <span className="small muted">
            {computed.ready} line{computed.ready === 1 ? "" : "s"} entered
          </span>
          <span>
            <span className="small muted">Sum of lines </span>
            <span className="amount">{formatPaise(computed.total)}</span>
          </span>
        </div>
      </Card>

      {/* Warns, never blocks: real receipts have discounts and rounding. */}
      {difference !== null && difference !== 0 && (
        <div className="banner warn" style={{ marginTop: "1rem" }}>
          Sum of lines is {formatPaise(Math.abs(difference))} {difference > 0 ? "more" : "less"} than the printed
          total of {formatPaise(statedPaise!)}. You can still save.
        </div>
      )}
      {difference === 0 && (
        <div className="banner ok" style={{ marginTop: "1rem" }}>
          Matches the printed total.
        </div>
      )}

      <Card>
        <div className="card-body">
          <label htmlFor="note">Note</label>
          <input
            id="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="optional — e.g. monthly stock-up"
          />
        </div>
      </Card>

      {creatingFor && (
        <NewItemDialog
          label={creatingFor.label}
          categories={categories}
          knownBrands={knownBrands}
          onCancel={() => setCreatingFor(null)}
          onConfirm={confirmNewItem}
        />
      )}
    </>
  );
}

function NewItemDialog({
  label,
  categories,
  knownBrands,
  onCancel,
  onConfirm,
}: {
  label: string;
  categories: Category[];
  knownBrands: string[];
  onCancel: () => void;
  onConfirm: (draft: NewItemDraft) => void;
}) {
  const guess = useMemo(() => splitLabel(label, knownBrands), [label, knownBrands]);
  const [brand, setBrand] = useState(guess.brand);
  const [name, setName] = useState(guess.name);
  const [categoryId, setCategoryId] = useState<string>("");
  const [defaultUnit, setDefaultUnit] = useState<Unit>("pcs");

  return (
    <Modal title="Add a new item" onClose={onCancel}>
      <div className="field">
        <label htmlFor="new-brand">Brand</label>
        <input
          id="new-brand"
          list="brand-options"
          value={brand}
          onChange={(event) => setBrand(event.target.value)}
          placeholder="optional"
        />
        <datalist id="brand-options">
          {knownBrands.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </div>

      <div className="field">
        <label htmlFor="new-name">Item name</label>
        <input id="new-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </div>

      <div className="form-row" style={{ marginBottom: "1rem" }}>
        <div>
          <label htmlFor="new-category">Category</label>
          <select id="new-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="new-unit">Usual unit</label>
          <select
            id="new-unit"
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
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={name.trim() === ""}
          onClick={() =>
            onConfirm({
              brand: brand.trim(),
              name: name.trim(),
              categoryId: categoryId === "" ? null : Number(categoryId),
              defaultUnit,
            })
          }
        >
          Add item
        </button>
      </div>

      <p className="small faint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
        The item is created when you save the bill.
      </p>
    </Modal>
  );
}
