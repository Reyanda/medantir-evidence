import { useState, useCallback, useRef } from "react";

// Like useState(), but the value is mirrored to sessionStorage keyed by tab
// so it survives tab switches within the same browser session. Initial value
// comes from sessionStorage if present; otherwise falls back to `defaultValue`.
//
// Usage:
//   const [data, setData] = usePersistedState("finance", "btc-price", null);
//
// Clears on browser close (sessionStorage), NOT on page refresh.
// For truly persistent state use localStorage via the existing engine stores.

function read(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

function write(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded */ }
}

export default function usePersistedState(tabId, field, defaultValue) {
  const storageKey = `medantir.state.${tabId}.${field}`;

  const [value, setValue] = useState(() => {
    const stored = read(storageKey);
    return stored !== null ? stored : defaultValue;
  });

  // Keep a ref to the latest value so onBeforeUnload can flush without stale closure.
  const ref = useRef(value);
  ref.current = value;

  const persist = useCallback((next) => {
    const resolved = typeof next === "function" ? next(ref.current) : next;
    ref.current = resolved;
    write(storageKey, resolved);
    setValue(resolved);
    return resolved;
  }, [storageKey]);

  return [value, persist];
}
