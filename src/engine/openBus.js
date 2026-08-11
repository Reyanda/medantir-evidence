// openBus.js — route every link into the app's own browser engine, never an
// external tab. Subscribers: the in-app Browser tab (loads the URL) and App
// (switches to the Browser view). If the Kimi WebBridge daemon is running, the
// real browser (with the operator's logins) is driven in parallel for auth sites.

import { navigate } from "./browserBridge.js";

const subs = new Set();
export function onOpenInApp(fn) { subs.add(fn); return () => subs.delete(fn); }

export function openInApp(url, { real = false } = {}) {
  if (!url) return;
  for (const fn of subs) fn(url);
  if (real) navigate(url).catch(() => {});
}
