import { useEffect, useState } from "react";

/** Like useState, but the value survives reloads and revisits — read from localStorage on
 * mount (synchronously, via lazy init, so there's no flash of the default value first) and
 * written back on every change. */
export function usePersistedState<T>(storageKey: string, initial: T): readonly [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (saved === null) return initial;
    try {
      return JSON.parse(saved) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  }, [storageKey, value]);

  return [value, setValue] as const;
}
