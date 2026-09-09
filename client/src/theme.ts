import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "grocery-tracker:theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Tracks the active theme, defaulting to the OS preference until the user picks one
 * explicitly. The choice is stamped on <html data-theme> (styles.css keys off that) and
 * persisted, so a manual pick survives reloads and overrides the OS setting either way.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? (systemPrefersDark() ? "dark" : "light"));

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS setting live, but only until the user has made an explicit choice.
  useEffect(() => {
    if (readStoredTheme() !== null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setTheme(event.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return [theme, toggle];
}
