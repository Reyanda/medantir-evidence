const EVENT = "medantir:open-project-surface";
const KEY = "medantir.project.initial-view";

export function openProjectSurface(view = "integrations") {
  try { sessionStorage.setItem(KEY, view); } catch { /* storage unavailable */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: { view } }));
}

export function consumeProjectSurface(fallback = "overview") {
  try {
    const value = sessionStorage.getItem(KEY);
    if (value) sessionStorage.removeItem(KEY);
    return value || fallback;
  } catch { return fallback; }
}

export function onOpenProjectSurface(listener) {
  if (typeof window === "undefined") return () => {};
  const handler = (event) => listener(event.detail?.view || "integrations");
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
