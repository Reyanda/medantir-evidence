// academic.js — Academic evidence engine + data-source vault.
//
// Keyless, CORS-verified scholarly APIs (OpenAlex, Europe PMC, Crossref) normalized
// to one paper shape and deduplicated by DOI. Proprietary sources (PubMed key,
// Research4Life / Scopus / Web of Science / GISAID logins) are registered with a
// credential vault so the operator can wire real institutional access. This is the
// substrate for closed-loop epidemiology: search → screen → extract → synthesize.

import { getSecret, hasSecret, putSecret } from "./secureVault.js";
import { fetchJson, isRetrievable, normalizeRecord, retrieveSource } from "./searchRetrieval.js";

const VAULT = "medantir.datasources.v1";

// Database registry — structured like the AI-provider registry: one entry per
// source with a monogram colour, controlled-vocabulary, platform, auth mode, and
// whether it has a LIVE connector (`auto`) or is copy-paste-only for SR strategies.
// The SR Strategy Builder and the Data Sources settings both read from this list.
export const DATA_SOURCES = [
  // live keyless connectors (auto-runnable)
  { id: "openalex", name: "OpenAlex", color: "#2563eb", kind: "keyless", auth: "none", controlled: "Concepts", platform: "API", note: "250M+ works, open metadata + citations." },
  { id: "europepmc", name: "Europe PMC", color: "#0ea5e9", kind: "keyless", auth: "none", controlled: "MeSH", platform: "API", note: "Biomedical literature + full-text OA." },
  { id: "crossref", name: "Crossref", color: "#f59e0b", kind: "keyless", auth: "none", controlled: "—", platform: "API", note: "DOI metadata authority." },
  { id: "semanticscholar", name: "Semantic Scholar", color: "#8b5cf6", kind: "keyless", auth: "none", controlled: "—", platform: "API", note: "220M+ papers; keyless graph search (rate-limited)." },
  // key-based
  { id: "pubmed", name: "PubMed (NCBI)", color: "#1d4ed8", kind: "key", auth: "apiKey", controlled: "MeSH", platform: "PubMed", note: "NCBI E-utilities (no browser CORS) — MEDLINE coverage is live via Europe PMC; direct PubMed routes through the Resource Shrimp proxy when running." },
  { id: "scopus", name: "Scopus", color: "#e11d48", kind: "key", auth: "apiKey", controlled: "—", platform: "Scopus", note: "Elsevier API key + institutional token." },
  { id: "wos", name: "Web of Science", color: "#7c3aed", kind: "key", auth: "apiKey", controlled: "—", platform: "Web of Science", note: "Clarivate API key." },
  // subscription platforms (copy-paste SR syntax; login/proxy)
  { id: "ovid_medline", name: "Ovid MEDLINE", color: "#0891b2", kind: "login", auth: "login", controlled: "MeSH", platform: "Ovid", note: "MEDLINE via Ovid syntax (.ti,ab. / exp)." },
  { id: "ovid_embase", name: "Embase (Ovid)", color: "#059669", kind: "login", auth: "login", controlled: "Emtree", platform: "Ovid", note: "Embase via Ovid; Emtree /exp." },
  { id: "embase_com", name: "Embase.com", color: "#10b981", kind: "login", auth: "login", controlled: "Emtree", platform: "Embase.com", note: "Elsevier Embase.com syntax (:ti,ab / /exp)." },
  { id: "cochrane", name: "Cochrane CENTRAL", color: "#dc2626", kind: "login", auth: "login", controlled: "MeSH", platform: "Cochrane", note: "CENTRAL trials register (:ti,ab,kw / MeSH descriptor)." },
  { id: "cinahl", name: "CINAHL (EBSCO)", color: "#16a34a", kind: "login", auth: "login", controlled: "CINAHL Headings", platform: "EBSCOhost", note: "Nursing/allied health via EBSCO (TI/AB / MH)." },
  { id: "psycinfo", name: "PsycINFO", color: "#9333ea", kind: "login", auth: "login", controlled: "Thesaurus", platform: "Ovid/EBSCO", note: "Psychology literature." },
  { id: "lilacs", name: "LILACS (VHL)", color: "#ca8a04", kind: "keyless", auth: "none", controlled: "DeCS", platform: "VHL", note: "Latin American & Caribbean health sciences." },
  { id: "clinicaltrials", name: "ClinicalTrials.gov", color: "#0d9488", kind: "keyless", auth: "none", controlled: "—", platform: "Registry", note: "Trial registry (for grey literature / ongoing studies)." },
  { id: "gim", name: "Global Index Medicus", color: "#65a30d", kind: "keyless", auth: "none", controlled: "MeSH", platform: "WHO", note: "WHO regional indexes (AIM/IMEMR/WPRIM/IMSEAR)." },
  { id: "livivo", name: "LIVIVO", color: "#007f86", kind: "browser", auth: "none", controlled: "MeSH · UMTHES · AGROVOC", platform: "ZB MED", note: "Free semantic life-sciences discovery. Compiled here and executed through a supervised browser/export route; no public search API is assumed." },
  // proprietary access / services
  { id: "research4life", name: "Research4Life", color: "#4f46e5", kind: "login", auth: "login", controlled: "—", platform: "HINARI", note: "HINARI/AGORA/OARE full-text (institutional login)." },
  { id: "gisaid", name: "GISAID", color: "#be123c", kind: "login", auth: "login", controlled: "—", platform: "GISAID", note: "Genomic surveillance (credentialed login)." },
  { id: "resource-shrimp", name: "Resource Shrimp", color: "#db2777", kind: "service", auth: "none", controlled: "—", platform: "Local", note: "Local OA full-text retrieval service (module)." },
];

// Platforms bundle many databases under ONE credential (EBSCOhost, Ovid, Elsevier,
// Clarivate, Research4Life…). Configuring a platform unlocks all its bundled
// databases for search-strategy targeting — mirroring how institutions actually buy
// access. `bundles` lists DATA_SOURCES ids the platform provides.
export const PLATFORMS = [
  { id: "ebscohost", name: "EBSCOhost", color: "#16a34a", auth: "login",
    bundles: ["cinahl", "psycinfo"], note: "Bundles CINAHL, MEDLINE, PsycINFO, Academic/Business Source & more under one login." },
  { id: "ovid", name: "Ovid (Wolters Kluwer)", color: "#0891b2", auth: "login",
    bundles: ["ovid_medline", "ovid_embase", "psycinfo"], note: "Bundles MEDLINE, Embase, PsycINFO, and more." },
  { id: "elsevier", name: "Elsevier", color: "#e11d48", auth: "apiKey",
    bundles: ["scopus", "embase_com"], note: "Scopus + Embase.com under Elsevier API/credentials." },
  { id: "clarivate", name: "Clarivate", color: "#7c3aed", auth: "apiKey",
    bundles: ["wos"], note: "Web of Science Core Collection." },
  { id: "research4life", name: "Research4Life", color: "#4f46e5", auth: "login",
    bundles: ["research4life"], note: "HINARI/AGORA/OARE/ARDI/GOALI — full-text access to publisher journals (not a search index)." },
  { id: "proquest", name: "ProQuest", color: "#0369a1", auth: "login",
    bundles: [], note: "Dissertations & Theses + many bundled databases." },
];

const PLAT_VAULT = "medantir.platforms.v1";

export function loadDataSources() {
  try {
    const stored = JSON.parse(localStorage.getItem(VAULT) || "{}");
    return Object.fromEntries(Object.entries(stored).map(([id, config]) => [id, { ...config, key: undefined, username: undefined, password: undefined, token: undefined, hasCredentials: config.hasCredentials || hasSecret(`datasource/${id}/credentials`) }]));
  } catch {
    return {};
  }
}

export function loadPlatforms() {
  try {
    const stored = JSON.parse(localStorage.getItem(PLAT_VAULT) || "{}");
    return Object.fromEntries(Object.entries(stored).map(([id, config]) => [id, { ...config, key: undefined, username: undefined, password: undefined, token: undefined, hasCredentials: config.hasCredentials || hasSecret(`platform/${id}/credentials`) }]));
  } catch {
    return {};
  }
}
export async function setPlatform(id, patch) {
  const { key, username, password, token, ...settings } = patch || {};
  const supplied = Object.fromEntries(Object.entries({ key, username, password, token }).filter(([, value]) => value));
  if (Object.keys(supplied).length) {
    const previous = await getSecret(`platform/${id}/credentials`) || {};
    const result = await putSecret(`platform/${id}/credentials`, { ...previous, ...supplied });
    if (!result.ok) return result;
  }
  const v = loadPlatforms();
  v[id] = { ...(v[id] || {}), ...settings, hasCredentials: hasSecret(`platform/${id}/credentials`) };
  try {
    localStorage.setItem(PLAT_VAULT, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  return v[id];
}
export function platformEnabled(id) {
  const p = PLATFORMS.find((x) => x.id === id);
  if (!p) return false;
  const cfg = loadPlatforms()[id] || {};
  return !!(cfg.enabled && (cfg.accessConfirmed || cfg.hasCredentials || hasSecret(`platform/${id}/credentials`)));
}
// Platforms that bundle a given database id and are currently configured.
export function platformsFor(dbId) {
  return PLATFORMS.filter((p) => p.bundles.includes(dbId));
}
export async function setDataSource(id, patch) {
  const { key, username, password, token, ...settings } = patch || {};
  const supplied = Object.fromEntries(Object.entries({ key, username, password, token }).filter(([, value]) => value));
  if (Object.keys(supplied).length) {
    const previous = await getSecret(`datasource/${id}/credentials`) || {};
    const result = await putSecret(`datasource/${id}/credentials`, { ...previous, ...supplied });
    if (!result.ok) return result;
  }
  const v = loadDataSources();
  v[id] = { ...(v[id] || {}), ...settings, hasCredentials: hasSecret(`datasource/${id}/credentials`) };
  try {
    localStorage.setItem(VAULT, JSON.stringify(v));
  } catch {
    /* ignore */
  }
  return v[id];
}
export function sourceEnabled(id) {
  const src = DATA_SOURCES.find((s) => s.id === id);
  if (!src) return false;
  if (["keyless", "browser"].includes(src.kind)) return loadDataSources()[id]?.enabled !== false;
  if (src.kind === "service") return loadDataSources()[id]?.enabled === true;
  const cfg = loadDataSources()[id] || {};
  if (cfg.enabled && (cfg.accessConfirmed || cfg.hasCredentials || hasSecret(`datasource/${id}/credentials`))) return true;
  // unlocked if a bundling platform is configured (EBSCOhost → CINAHL, etc.)
  return platformsFor(id).some((p) => platformEnabled(p.id));
}

// --- normalized paper shape ---------------------------------------------
// Shared with searchRetrieval.js so every source — built-in or user-defined —
// produces the same record, including the pmid/pmcid that dedup clusters on.
const norm = normalizeRecord;

// Null-on-failure JSON fetch, retained for the user-defined custom-source path
// whose contract is an array of records. It routes through fetchJson so custom
// sources get the same timeout and 429/5xx backoff as the built-in connectors.
async function getJSON(url, headers) {
  const response = await fetchJson(url, { headers });
  return response.ok ? response.data : null;
}

// The four keyless connectors delegate to searchRetrieval.js, which paginates,
// captures the source's own hit count, and reports HTTP failures as failures.
// These wrappers keep the historic array return for existing callers; use
// `searchSource()` when you need the provenance (hit count, truncation, errors).
export async function searchOpenAlex(query, n = 10, options = {}) {
  return (await retrieveSource("openalex", query, { maxRecords: n, ...options })).records;
}

export async function searchEuropePMC(query, n = 10, options = {}) {
  return (await retrieveSource("europepmc", query, { maxRecords: n, ...options })).records;
}

// Retrieve OA full text from Europe PMC by PMCID and reduce it to plain text.
// Keyless, CORS-open. Returns "" when the article has no fetchable full text.
export async function fetchEpmcFullText(pmcid) {
  if (!pmcid) return "";
  try {
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`);
    if (!res.ok) return "";
    const xml = await res.text();
    // keep the article body (results/methods matter for effect estimates)
    const body = (xml.match(/<body[\s\S]*?<\/body>/i) || [xml])[0];
    return body
      .replace(/<xref[\s\S]*?<\/xref>/gi, "")
      .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, " [TABLE] ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#\d+;|&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export async function searchCrossref(query, n = 10, options = {}) {
  return (await retrieveSource("crossref", query, { maxRecords: n, ...options })).records;
}

// Semantic Scholar — keyless, CORS-open graph search (rate-limited without a key).
export async function searchSemanticScholar(query, n = 10, options = {}) {
  return (await retrieveSource("semanticscholar", query, { maxRecords: n, ...options })).records;
}

/** Run one source and return full PRISMA-S provenance:
 *  { source, records, hitCount, retrieved, truncated, pages, status, error, warnings }.
 *  Built-in sources paginate; user-defined API sources return a single page. */
export async function searchSource(sourceId, query, { n = 100, ...options } = {}) {
  if (isRetrievable(sourceId)) return retrieveSource(sourceId, query, { maxRecords: n, ...options });
  const custom = loadCustomSources().find((s) => s.id === sourceId);
  if (!custom) {
    return { source: sourceId, records: [], hitCount: null, retrieved: 0, truncated: false, pages: 0, status: "error", error: `unknown source '${sourceId}'`, warnings: [] };
  }
  const records = await searchCustom(custom, query, n);
  return {
    source: sourceId,
    records,
    hitCount: null,
    retrieved: records.length,
    truncated: false,
    pages: 1,
    status: records.length ? "ok" : "empty",
    error: null,
    warnings: ["User-defined API source: no hit count is reported and results are a single page."],
  };
}

const SEARCHERS = {
  openalex: searchOpenAlex,
  europepmc: searchEuropePMC,
  crossref: searchCrossref,
  semanticscholar: searchSemanticScholar,
};

// ---------------------------------------------------------------------------
// Custom, user-defined API sources — the operator adds ANY JSON search API
// (Semantic Scholar, CORE, DOAJ, BASE, an institutional endpoint…) with a URL
// template (`${query}`/`${n}`) and dot-path field mappings. These become
// first-class, selectable sources in search and the closed-loop SR pipeline —
// so data sources are no longer limited to the built-in set.
const CUSTOM_VAULT = "medantir.customsources.v1";

export function loadCustomSources() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_VAULT) || "[]");
  } catch {
    return [];
  }
}
function saveCustomSources(list) {
  try {
    localStorage.setItem(CUSTOM_VAULT, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
export function addCustomSource(src) {
  const list = loadCustomSources();
  const id = src.id || `custom_${Date.now()}`;
  const entry = { enabled: true, executionKind: "api", ...src, id, kind: "custom", name: src.name || id };
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  saveCustomSources(list);
  return entry;
}
export function removeCustomSource(id) {
  saveCustomSources(loadCustomSources().filter((s) => s.id !== id));
}
export function setCustomSourceEnabled(id, enabled) {
  const list = loadCustomSources();
  const s = list.find((x) => x.id === id);
  if (s) { s.enabled = enabled; saveCustomSources(list); }
}
export function updateCustomSource(id, patch) {
  const list = loadCustomSources();
  const index = list.findIndex((source) => source.id === id);
  if (index < 0) return null;
  list[index] = { ...list[index], ...patch, id };
  saveCustomSources(list);
  return list[index];
}

// dot-path getter: "message.items.0.title"
function dot(obj, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Query a user-defined JSON API and normalise its records to the paper shape.
export async function searchCustom(src, query, n = 10) {
  if ((src.executionKind || "api") !== "api" || !src.endpoint) return [];
  const url = (src.endpoint || "")
    .replace(/\$\{query\}|\{query\}|%s/g, encodeURIComponent(query))
    .replace(/\$\{n\}|\{n\}/g, String(n));
  const headers = src.apiKey ? { [src.authHeader || "Authorization"]: src.apiKey } : undefined;
  const d = await getJSON(url, headers);
  if (!d) return [];
  const m = src.map || {};
  const list = m.list ? dot(d, m.list) : Array.isArray(d) ? d : d.results || d.data || d.items || d.message?.items;
  if (!Array.isArray(list)) return [];
  return list.slice(0, n).map((it) => {
    const a = dot(it, m.authors || "authors");
    return norm({
      title: dot(it, m.title || "title"),
      year: Number(dot(it, m.year || "year")) || null,
      doi: dot(it, m.doi || "doi"),
      authors: Array.isArray(a) ? a.map((x) => (typeof x === "string" ? x : x?.name || x?.display_name)).filter(Boolean).slice(0, 5) : [],
      cites: Number(dot(it, m.cites || "cites")) || null,
      source: src.name,
      abstract: dot(it, m.abstract || "abstract") || "",
    });
  });
}

// Full-text sourcing routes through the Resource Shrimp sandbox (/api/download).
// It resolves + downloads OA full text by DOI/arXiv/title into the local library.
export async function fetchFullText({ doi, title }) {
  const { callModule } = await import("./modules.js");
  return callModule("resource-shrimp", "/api/download", { method: "POST", body: { doi, title } });
}

// Parse any PDF (by URL) to markdown/text via the live medantir-parse service
// (LiteParse). Used for full-text extraction of non-EPMC / uploaded PDFs.
// Returns { ok, markdown, chars } or an error.
export async function parsePdfUrl(url, { ocr = false } = {}) {
  const { callModule } = await import("./modules.js");
  const r = await callModule("liteparse", "/parse", { method: "POST", body: { url, ocr }, apiBase: "" });
  return r.ok ? r.data : { ok: false, error: r.error || `parse failed (${r.status || "?"})` };
}

// Parse an uploaded PDF (base64, no data: prefix) to markdown via LiteParse.
export async function parsePdfBase64(base64, { ocr = false } = {}) {
  const { callModule } = await import("./modules.js");
  const r = await callModule("liteparse", "/parse", { method: "POST", body: { base64, ocr }, apiBase: "" });
  return r.ok ? r.data : { ok: false, error: r.error || `parse failed (${r.status || "?"})` };
}

// Source ids that have a live connector wired (vs. registered-but-pending in the
// vault). The UI offers these for per-search selection.
export const SEARCHABLE_SOURCES = Object.keys(SEARCHERS);
export function isSearchable(id) {
  return SEARCHABLE_SOURCES.includes(id);
}

export function dataSourceStatus(id) {
  const source = DATA_SOURCES.find((item) => item.id === id);
  if (!source) return { state: "unknown", label: "Unknown source", runnable: false };
  const enabled = sourceEnabled(id);
  if (isSearchable(id)) return enabled
    ? { state: "ready", label: "Live query API", runnable: true }
    : { state: "disabled", label: "Live API disabled", runnable: true };
  if (source.kind === "browser") return { state: enabled ? "supervised" : "disabled", label: enabled ? "Supervised browser" : "Browser route disabled", runnable: false };
  if (source.kind === "service") return { state: enabled ? "local-service" : "setup-required", label: enabled ? "Local service enabled · not tested" : "Local service setup required", runnable: false };
  if (["key", "login"].includes(source.kind)) return enabled
    ? { state: "configured", label: "Access recorded · not API-tested", runnable: false }
    : { state: "access-required", label: "Institutional access required", runnable: false };
  return { state: enabled ? "strategy-only" : "disabled", label: enabled ? "Strategy/export only" : "Source disabled", runnable: false };
}

export function platformStatus(id) {
  const platform = PLATFORMS.find((item) => item.id === id);
  if (!platform) return { state: "unknown", label: "Unknown platform" };
  return platformEnabled(id)
    ? { state: "configured", label: "Access recorded · not API-tested" }
    : { state: "access-required", label: "Institutional access required" };
}

export async function testDataSource(id) {
  if (!isSearchable(id)) {
    const status = dataSourceStatus(id);
    return { ok: false, state: status.state, error: `${status.label}; this record has no live query adapter.` };
  }
  if (!sourceEnabled(id)) return { ok: false, state: "disabled", error: "Enable the source before testing." };
  try {
    const records = await SEARCHERS[id]("public health", 1);
    if (!records.length) return { ok: false, state: "unavailable", error: "The query adapter returned no record; the API may be unavailable or rate-limited." };
    return { ok: true, state: "ready", count: records.length, sample: records[0].title };
  } catch (error) {
    return { ok: false, state: "unavailable", error: String(error.message || error) };
  }
}
// Sources the operator can actually query now: built-in live connectors +
// enabled user-defined custom API sources.
export function selectableSources() {
  const builtin = DATA_SOURCES.filter((s) => isSearchable(s.id) && sourceEnabled(s.id)).map((s) => s.id);
  const custom = loadCustomSources().filter((s) => s.enabled !== false && (s.executionKind || "api") === "api").map((s) => s.id);
  return [...builtin, ...custom];
}

// All databases shown in Quick Search — keyless are always on; login/key/browser
// databases are shown with their auth status so users can toggle what to search.
export function allSearchableSources() {
  return DATA_SOURCES.map((s) => ({
    id: s.id, name: s.name, color: s.color, kind: s.kind, auth: s.auth,
    platform: s.platform, controlled: s.controlled, note: s.note,
    searchable: isSearchable(s.id),
    enabled: sourceEnabled(s.id),
    needsLogin: s.kind === 'login',
    needsKey: s.kind === 'key',
    isBrowser: s.kind === 'browser',
    isService: s.kind === 'service',
  }));
}

// {id,name,kind} for every runnable source (built-in + custom) — for pickers.
export function runnableSources() {
  const builtin = DATA_SOURCES.filter((s) => isSearchable(s.id)).map((s) => ({ id: s.id, name: s.name, kind: "builtin", color: s.color }));
  const custom = loadCustomSources().filter((s) => (s.executionKind || "api") === "api").map((s) => ({ id: s.id, name: s.name, kind: "custom", executionKind: "api", color: "#64748b" }));
  return [...builtin, ...custom];
}

// Merged multi-source search, deduped by DOI (else title). Ranked by citations.
// Dispatches to built-in searchers AND user-defined custom API sources.
export async function searchAcademic(query, { sources, n = 10 } = {}) {
  const custom = Object.fromEntries(loadCustomSources().map((s) => [s.id, s]));
  const requested = sources && sources.length ? sources : selectableSources();
  const active = requested.filter((s) => (SEARCHERS[s] && sourceEnabled(s)) || custom[s]);
  const batches = await Promise.all(
    active.map((s) => (SEARCHERS[s] ? SEARCHERS[s](query, n) : searchCustom(custom[s], query, n)))
  );
  const seen = new Map();
  for (const batch of batches) {
    for (const p of batch) {
      const key = p.doi || p.title.toLowerCase().slice(0, 80);
      if (!seen.has(key)) seen.set(key, { ...p, sources: [p.source] });
      else {
        const ex = seen.get(key);
        if (!ex.sources.includes(p.source)) ex.sources.push(p.source);
        ex.cites = Math.max(ex.cites || 0, p.cites || 0);
        if (!ex.abstract && p.abstract) ex.abstract = p.abstract;
      }
    }
  }
  return [...seen.values()].sort((a, b) => (b.cites || 0) - (a.cites || 0));
}
