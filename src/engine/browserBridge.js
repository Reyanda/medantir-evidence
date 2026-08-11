// browserBridge.js — Browser assistant layer over Kimi WebBridge.
//
// Drives the operator's REAL browser (with their logged-in sessions to Ovid,
// Scopus, Web of Science, Google Scholar, …) via the Kimi daemon at
// 127.0.0.1:10086/command. This makes searches realistic — run against the actual
// databases the operator subscribes to, not just open APIs. Falls back cleanly to
// the in-app iframe browser when the daemon isn't running.

// Independent, deployed browser engine (server-side Playwright). Decoupled from
// any local machine. A local Kimi daemon can be used instead via localStorage
// override (medantir.bridge.url) for driving the operator's own logged-in browser.
import { activeProject } from "./projectstore.js";
import { currentVaultUserId } from "./secureVault.js";
import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";

const DEFAULT_BRIDGE = "https://bridge.actiora.com/command";

function bridgeUrl() {
  try { return localStorage.getItem("medantir.bridge.url") || DEFAULT_BRIDGE; } catch { return DEFAULT_BRIDGE; }
}

export function browseUrl() {
  return bridgeUrl();
}
export function bridgeSessionId() {
  const scope = `${currentVaultUserId()}::${activeProject() || "no-project"}`;
  let hash = 2166136261;
  for (let index = 0; index < scope.length; index++) hash = Math.imul(hash ^ scope.charCodeAt(index), 16777619);
  return `med_${(hash >>> 0).toString(36)}`;
}

export async function authorizedBridgeHeaders(extra = {}) {
  if (!cloudAuthEnabled()) return extra;
  return cloudAuthHeaders(activeProject(), extra);
}

// Saved-login session names, one per login-walled database. The bridge seeds a
// browser context from the saved state whose name matches the SESSION, so a
// database search MUST run under its sessionRef — running it under the generic
// per-project session meant the saved Ovid/Embase login was never replayed and
// every walled database reported "needs auth" forever. Mirrors the server-side
// recipe table in medantir-review/src/adapters/institutional.ts.
export const SESSION_REFS = {
  ovid_medline: "db/ovid/qmul",
  ovid_embase: "db/ovid/qmul",
  embase_com: "db/embase/elsevier",
  scopus: "db/scopus/qmul",
  wos: "db/wos/qmul",
  cinahl: "db/cinahl/research4life",
  psycinfo: "db/cinahl/research4life",
  cochrane: "db/cochrane/qmul",
};

// A saved login belongs to the PLATFORM, not to a database — which the legacy
// table already showed by mapping ovid_medline and ovid_embase to the same
// session. One Ovid sign-in covers every Ovid database, including ones detected
// at runtime that no legacy identifier names.
export const PLATFORM_SESSIONS = {
  ovid: "db/ovid/qmul",
  embase_com: "db/embase/elsevier",
  scopus: "db/scopus/qmul",
  wos: "db/wos/qmul",
  ebscohost: "db/cinahl/research4life",
  cochrane: "db/cochrane/qmul",
};

/** Accepts a legacy identifier, or a strategy/target carrying a platform.
 *  Platform wins: a discovered database must replay its gateway's session, or it
 *  signs in from scratch every run while a perfectly good login sits unused. */
export function sessionRefFor(source) {
  if (source && typeof source === "object") {
    return PLATFORM_SESSIONS[source.platform] || SESSION_REFS[source.id] || null;
  }
  return SESSION_REFS[source] || null;
}

export async function bridgeCommand(action, args = {}, { session } = {}) {
  try {
    const headers = await authorizedBridgeHeaders({ "Content-Type": "application/json" });
    const res = await fetch(bridgeUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({ action, args, session: session || bridgeSessionId() }),
    });
    if (!res.ok) return { ok: false, error: `kimi ${res.status}` };
    return { ok: true, ...(await res.json()) };
  } catch (e) {
    return { ok: false, offline: true, error: `medantir-bridge not reachable (${String(e.message || e)})` };
  }
}

// --- database search transport ----------------------------------------------
// Desktop first. The Electron shell logs into institutional databases in a real
// Chromium webview on the `persist:medantir-browser` partition, so running the
// search in that same partition reuses the operator's live session — including
// SSO and MFA — and no credential ever leaves the machine. The cloud bridge is
// the fallback for the web build, where a saved session is replayed instead.
function desktopDatabase() {
  if (typeof window === "undefined") return null;
  const runtime = window.__medantirDesktop__;
  return runtime?.isAvailable?.() && runtime.database ? runtime.database : null;
}

export function databaseSearchTransport() {
  return desktopDatabase() ? "desktop" : "bridge";
}

/** Uniform database-search call across both transports. Returns the bridge's
 *  db_search contract: { ok, records, ris, needsAuth, executedQuery, url, warnings }. */
export async function databaseSearch(action, args = {}, { session } = {}) {
  const desktop = desktopDatabase();
  if (!desktop) return bridgeCommand(action, args, { session });
  try {
    const result = await desktop.search(args);
    return { ok: true, ...result };
  } catch (cause) {
    return { ok: false, error: `desktop database search failed (${String(cause?.message || cause)})` };
  }
}

/** Read the anchors from a page in the authenticated session. Used to enumerate
 *  a Research4Life account's entitlements after the operator has signed in. */
export async function databaseLinks({ url, linkSelector } = {}) {
  const desktop = desktopDatabase();
  if (!desktop?.links) {
    return { ok: false, error: "Entitlement discovery needs the desktop shell, which owns the authenticated browser session." };
  }
  try {
    return { ok: true, ...(await desktop.links({ url, linkSelector })) };
  } catch (cause) {
    return { ok: false, error: String(cause?.message || cause) };
  }
}

/** Whether a database currently has a usable authenticated session, without
 *  running a search. Drives the per-database status in the Browser tab. */
export async function databaseSessionStatus(recipe) {
  const desktop = desktopDatabase();
  if (desktop) {
    try {
      return { ok: true, ...(await desktop.status(recipe)) };
    } catch (cause) {
      return { ok: false, error: String(cause?.message || cause) };
    }
  }
  const states = await bridgeCommand("list_states");
  if (!states.ok) return { ok: false, error: states.error };
  const ref = sessionRefFor(recipe?.database);
  return { ok: true, authenticated: Boolean(ref && (states.states || []).includes(ref)), sessionRef: ref, transport: "bridge" };
}

/** Proxy URL for rendering any site in the in-app iframe. The bridge fetches
 *  the page with headless Chromium, strips frame-blocking headers, and injects
 *  a <base> tag so relative URLs resolve. */
export function proxyUrl(targetUrl) {
  // The authenticated cloud bridge deliberately has no HTML proxy endpoint.
  // BrowserTab uses its screenshot transport; Desktop uses a local webview.
  return cloudAuthEnabled() ? "about:blank" : `${bridgeUrl().replace(/\/command\/?$/, "")}/proxy?url=${encodeURIComponent(targetUrl)}`;
}

export async function bridgeAvailable() {
  const r = await bridgeCommand("list_tabs", {});
  return r.ok;
}
export const navigate = (url, newTab = true, group_title = "Medantir") => bridgeCommand("navigate", { url, newTab, group_title });
export const snapshot = () => bridgeCommand("snapshot", {}); // accessibility tree text
export const clickEl = (selector) => bridgeCommand("click", { selector });
export const fillEl = (selector, value) => bridgeCommand("fill", { selector, value });
export const savePdf = (paper_format = "A4") => bridgeCommand("save_as_pdf", { paper_format });
export const capturePerceptualSnapshot = ({ includeRaster = true } = {}) => bridgeCommand("perceptual_snapshot", { includeRaster });

// --- real search databases (browser-driven; use the operator's access) --------
// query goes through the database's own web search URL — Kimi opens it in the real
// browser session so subscription/proxy logins apply.
export const SEARCH_ENGINES = [
  { id: "gscholar", name: "Google Scholar", url: (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}` },
  { id: "pubmed_web", name: "PubMed (web)", url: (q) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}` },
  { id: "lilacs", name: "LILACS / BVS", url: (q) => `https://pesquisa.bvsalud.org/portal/?q=${encodeURIComponent(q)}` },
  { id: "epistemonikos", name: "Epistemonikos (LOVE)", url: (q) => `https://www.epistemonikos.org/en/search?q=${encodeURIComponent(q)}` },
  { id: "cochrane_web", name: "Cochrane Library", url: (q) => `https://www.cochranelibrary.com/en/search?q=${encodeURIComponent(q)}` },
  { id: "ovid", name: "Ovid (MEDLINE/Embase)", url: () => `https://ovidsp.ovid.com/` , note: "opens Ovid — paste the compiled strategy (uses your institutional login)" },
  { id: "scopus", name: "Scopus", url: (q) => `https://www.scopus.com/results/results.uri?st1=${encodeURIComponent(q)}` },
  { id: "wos", name: "Web of Science", url: () => `https://www.webofscience.com/wos/woscc/basic-search`, note: "opens WoS — paste TS=(…) (uses your login)" },
  { id: "who_gim", name: "Global Index Medicus", url: (q) => `https://www.globalindexmedicus.net/?q=${encodeURIComponent(q)}` },
  { id: "livivo", name: "LIVIVO", url: () => "https://www.livivo.de/app", note: "opens LIVIVO — paste the compiled semantic strategy; supervised browser/export route" },
  { id: "trip", name: "TRIP Database", url: (q) => `https://www.tripdatabase.com/search?criteria=${encodeURIComponent(q)}` },
];

// Run a search in the real browser and read back the results page (text).
export async function searchViaBrowser(engineId, query) {
  const e = SEARCH_ENGINES.find((x) => x.id === engineId);
  if (!e) return { ok: false, error: `unknown engine ${engineId}` };
  const nav = await navigate(e.url(query));
  if (!nav.ok) return nav;
  const snap = await snapshot();
  return { ok: snap.ok, engine: e.name, url: nav.url, text: snap.ok ? JSON.stringify(snap.tree).slice(0, 6000) : null, error: snap.error };
}
