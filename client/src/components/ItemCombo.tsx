import { useEffect, useId, useMemo, useRef, useState, forwardRef } from "react";
import type { Item } from "@shared/types.ts";
import { formatPaise } from "@shared/money.ts";

export type ItemChoice =
  | { kind: "existing"; item: Item }
  | { kind: "new"; label: string };

/**
 * Item picker for bill entry. Searches brand + name, and when nothing matches it offers to
 * create the item inline — entry should never have to stop and go to the catalog first.
 */
export const ItemCombo = forwardRef<HTMLInputElement, {
  items: Item[];
  value: string;
  onValueChange: (value: string) => void;
  onPick: (choice: ItemChoice) => void;
  placeholder?: string;
  onEnterEmpty?: () => void;
}>(function ItemCombo({ items, value, onValueChange, onPick, placeholder, onEnterEmpty }, ref) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    const scored = items.filter((item) => `${item.brand} ${item.name}`.toLowerCase().includes(query));
    return scored.slice(0, 8);
  }, [items, value]);

  const trimmed = value.trim();
  const exact = matches.some((item) => `${item.brand} ${item.name}`.trim().toLowerCase() === trimmed.toLowerCase());
  const showCreate = trimmed.length > 0 && !exact;
  const optionCount = matches.length + (showCreate ? 1 : 0);

  useEffect(() => {
    setHighlight(0);
  }, [value]);

  // Close when focus or a click lands outside the combo.
  useEffect(() => {
    if (!open) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentDown);
    return () => document.removeEventListener("mousedown", onDocumentDown);
  }, [open]);

  function choose(index: number) {
    if (index < matches.length) {
      const item = matches[index]!;
      onPick({ kind: "existing", item });
    } else if (showCreate) {
      onPick({ kind: "new", label: trimmed });
    }
    setOpen(false);
  }

  return (
    <div className="combo" ref={wrapRef}>
      <input
        ref={ref}
        value={value}
        placeholder={placeholder ?? "Search or add an item"}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={(event) => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setHighlight((current) => (optionCount === 0 ? 0 : (current + 1) % optionCount));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((current) => (optionCount === 0 ? 0 : (current - 1 + optionCount) % optionCount));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (trimmed === "") onEnterEmpty?.();
            else if (optionCount > 0) choose(Math.min(highlight, optionCount - 1));
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && optionCount > 0 && (
        <div className="combo-menu" id={listId} role="listbox">
          {matches.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              className={`combo-option${index === highlight ? " active" : ""}`}
              onMouseEnter={() => setHighlight(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>
                {item.brand && <span className="faint">{item.brand} </span>}
                {item.name}
              </span>
              <span className="opt-sub">
                {item.lastUnitPricePaise !== null
                  ? `${formatPaise(item.lastUnitPricePaise)} / ${item.lastUnit}`
                  : item.categoryName ?? "new"}
              </span>
            </button>
          ))}

          {showCreate && (
            <button
              type="button"
              role="option"
              aria-selected={highlight === matches.length}
              className={`combo-option create${highlight === matches.length ? " active" : ""}`}
              onMouseEnter={() => setHighlight(matches.length)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(matches.length)}
            >
              <span>
                Create “<strong>{trimmed}</strong>”
              </span>
              <span className="opt-sub">new item</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
