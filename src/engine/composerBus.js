// composerBus.js — a tiny event bus so any surface can hand context to the Composer.
//
// Click "ask agent" on a news item, map event, monitor, or project and it opens the
// Composer dock pre-filled and runs. Decouples every clickable card from the dock.

const subs = new Set();
const EVENT = "medantir:composer-request";

// Send a prompt to the Composer. `autofill` (default true) also auto-sends it.
export function askComposer(prompt, { autofill = true } = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { prompt, options: { autofill } } }));
    return;
  }
  for (const fn of subs) fn(prompt, { autofill });
}

export function onAskComposer(fn) {
  if (typeof window !== "undefined") {
    const listener = (event) => fn(event.detail?.prompt || "", event.detail?.options || {});
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }
  subs.add(fn);
  return () => subs.delete(fn);
}
