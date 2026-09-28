import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Like useSearchParams, but filters survive navigating away and back, and reloads.
 *
 * On first mount, an empty URL is hydrated from the last-saved filters in localStorage
 * (a URL that already carries params — e.g. a shared link, or a cross-page link like
 * /items?categoryId=... — wins instead, so an explicit link is never silently overridden).
 * Every change after that is mirrored back into localStorage, including clearing it when
 * the filters are cleared.
 */
export function usePersistedSearchParams(storageKey: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [hydrated, setHydrated] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if ([...searchParams.keys()].length === 0) {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const restored = new URLSearchParams(saved);
        if ([...restored.keys()].length > 0) setSearchParams(restored, { replace: true });
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const text = searchParams.toString();
    if (text) window.localStorage.setItem(storageKey, text);
    else window.localStorage.removeItem(storageKey);
  }, [hydrated, searchParams, storageKey]);

  return [searchParams, setSearchParams] as const;
}
