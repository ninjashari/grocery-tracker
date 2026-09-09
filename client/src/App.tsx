import { NavLink, Navigate, Route, Routes, Link } from "react-router-dom";
import { useAuth } from "./auth.tsx";
import { useTheme } from "./theme.ts";
import { Loading, ThemeToggle } from "./components/ui.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { BillEntry } from "./pages/BillEntry.tsx";
import { Bills } from "./pages/Bills.tsx";
import { Items } from "./pages/Items.tsx";
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
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">₹</span>
          Grocery Tracker
        </Link>

        <nav className="nav">
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

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<BillEntry />} />
          <Route path="/bills" element={<Bills />} />
          <Route path="/bills/:id/edit" element={<BillEntry />} />
          <Route path="/items" element={<Items />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
