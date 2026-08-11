// browserBus.js — Shared browser context for the right pane and composer.
//
// The Browser tab pushes navigation events here; the RightPane and Composer
// read them to show page context and enable "chat about this page" workflows.
// This is the foundation for DIA-style browser-agent interaction.

const listeners = new Set();
const paneListeners = new Set();
let _state = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, requestedUrl: "", previewHtml: "", previewPath: "", previewProjectId: "" };
let _pane = (() => {
  try { return localStorage.getItem("medantir.right-pane.tab") || "agents"; } catch { return "agents"; }
})();

/** Get the current browser context snapshot. */
export function getBrowserContext() {
  return { ..._state };
}

/** Push a navigation update from the Browser tab. */
export function updateBrowserContext(patch) {
  _state = { ..._state, ...patch };
  for (const fn of listeners) fn(_state);
}

/** Subscribe to browser context changes. Returns an unsubscribe function. */
export function onBrowserContext(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestBrowserUrl(url) {
  updateBrowserContext({ requestedUrl: url, previewHtml: "", previewPath: "", previewProjectId: "" });
  selectRightPaneTab("browser");
}

export function openProjectPreview(projectId, path, html) {
  updateBrowserContext({
    url: `project://${projectId}/${String(path || "preview.html").replace(/^\/+/, "")}`,
    title: path || "Project preview",
    requestedUrl: "",
    previewHtml: String(html || ""),
    previewPath: path || "preview.html",
    previewProjectId: projectId,
    loading: false,
  });
  selectRightPaneTab("browser");
}

export function getRightPaneTab() {
  return ["browser", "terminal", "git", "agents", "plots", "office"].includes(_pane) ? _pane : "agents";
}

export function selectRightPaneTab(tab) {
  _pane = ["browser", "terminal", "git", "agents", "plots", "office"].includes(tab) ? tab : "agents";
  try { localStorage.setItem("medantir.right-pane.tab", _pane); } catch { /* storage unavailable */ }
  for (const listener of paneListeners) listener(_pane);
}

export function onRightPaneTab(listener) {
  paneListeners.add(listener);
  return () => paneListeners.delete(listener);
}
