import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, Link, useLocation } from "react-router-dom";
import { useAuth } from "./auth.tsx";
import { useTheme } from "./theme.ts";
import { Loading, ThemeToggle } from "./components/ui.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { BillEntry } from "./pages/BillEntry.tsx";
import { Bills } from "./pages/Bills.tsx";
import { Items } from "./pages/Items.tsx";
import { PriceHistory } from "./pages/PriceHistory.tsx";
import { ItemPriceHistoryAllBrands } from "./pages/ItemPriceHistoryAllBrands.tsx";
import { ItemBillHistory } from "./pages/ItemBillHistory.tsx";
import { CategorySpendHistory } from "./pages/CategorySpendHistory.tsx";
import { Reports } from "./pages/Reports.tsx";
import { DataPage } from "./pages/Data.tsx";
import { Settings } from "./pages/Settings.tsx";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/new", label: "New bill", end: false },
  { to: "/bills", label: "Bills", end: false },
  { to: "/items", label: "Items", end: false },
  { to: "/reports", label: "Reports", end: false },
  { to: "/data", label: "Import / Export", end: false },
  { to: "/settings", label: "Settings", end: false },
];

export function App() {
  const { user, loading, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const topbarRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // Close the drawer whenever the route changes — NavLink clicks navigate but don't
  // inherently dismiss it.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Close on a click/tap outside the topbar (mirrors ItemCombo.tsx's same pattern) and on Escape.
  useEffect(() => {
    if (!navOpen) return;
    const onDocumentDown = (event: MouseEvent) => {
      if (!topbarRef.current?.contains(event.target as Node)) setNavOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  if (loading) return <Loading label="Starting up…" />;

  if (!user) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} floating />
        <Login />
      </>
    );
  }

  return (
    <div className="shell">
      <header className="topbar" ref={topbarRef}>
        <Link to="/" className="brand">
          <span className="brand-mark">₹</span>
          Grocery Tracker
        </Link>

        <button
          type="button"
          className="ghost nav-toggle"
          aria-label={navOpen ? "Close menu" : "Open menu"}
          aria-expanded={navOpen}
          aria-controls="primary-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen ? "✕" : "☰"}
        </button>

        <nav id="primary-nav" className={navOpen ? "nav open" : "nav"}>
          {NAV.map((entry) => (
            <NavLink key={entry.to} to={entry.to} end={entry.end}>
              {entry.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <div className="who">
            <strong>{user.name}</strong>
            <span>{user.householdName}</span>
          </div>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <button type="button" className="ghost small" onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </header>

      <div className={navOpen ? "nav-scrim open" : "nav-scrim"} aria-hidden="true" />

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<BillEntry />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/bills/:id/edit" element={<BillEntry />} />
          <Route path="/items" element={<Items />} />
          <Route path="/items/:id/price-history" element={<PriceHistory />} />
          <Route path="/items/:id/price-history/all-brands" element={<ItemPriceHistoryAllBrands />} />
          <Route path="/items/:id/bills" element={<ItemBillHistory />} />
          <Route path="/categories/:id/spend-history" element={<CategorySpendHistory />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
