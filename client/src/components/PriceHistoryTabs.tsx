import { NavLink } from "react-router-dom";

/** Cross-links the three price-history views for one item: its own brand's trend, the
 * same name merged across every brand, and (when categorised) that category's spend
 * trend. These are route changes, not client-state toggles, so it's a NavLink bar
 * rather than the Segmented control — visually matching it via the shared .segmented
 * class (`.segmented a.on` added alongside `.segmented button.on`). */
export function PriceHistoryTabs({ itemId, categoryId }: { itemId: number | null; categoryId: number | null }) {
  if (itemId === null) return null;
  return (
    <div className="segmented" role="group">
      <NavLink to={`/items/${itemId}/price-history`} end className={({ isActive }) => (isActive ? "on" : "")}>
        By brand
      </NavLink>
      <NavLink
        to={`/items/${itemId}/price-history/all-brands`}
        className={({ isActive }) => (isActive ? "on" : "")}
      >
        All brands
      </NavLink>
      {categoryId !== null && (
        <NavLink
          to={`/categories/${categoryId}/spend-history?fromItem=${itemId}`}
          className={({ isActive }) => (isActive ? "on" : "")}
        >
          Category trend
        </NavLink>
      )}
    </div>
  );
}
