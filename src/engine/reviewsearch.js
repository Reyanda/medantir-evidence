// reviewsearch.js — the search-execution stage of the Evidence Review Engine.
//
// Runs the strategy against each selected source (API connectors today; the
// browser-use agent for login-walled databases lands next), capturing per-source
// provenance — the executed query, date, and result count — and merging records
// into the review's master library with source tags + a dedup key. A source that
// errors or returns nothing is flagged (the seed of the Search Troubleshooting
// Agent), never silently dropped.
//
// `searchFn` is injectable so the logic is unit-testable without live network.

import { deduplicate } from "./dedup.js";
import { mapWithConcurrency } from "./searchRetrieval.js";
import { sessionRefFor } from "./browserBridge.js";
import { resolveAccessUrl } from "./research4life.js";
import { TARGETS } from "./searchStrategy.js";

// Sources run in parallel, but bounded: the keyless polite pools start returning
// 429s under an unbounded fan-out, and a throttled source is a search gap.
const SOURCE_CONCURRENCY = 4;
const OPEN_API_ATTEMPTS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A search response is not provenance-complete merely because records arrived:
 * PRISMA identification needs the database's own hit count. Retry transient
 * errors and incomplete count metadata, but never substitute retrieved count for
 * database hits. If all attempts remain incomplete, the caller receives the last
 * result and the existing fail-closed provenance checks can stop the workflow.
 */
async function executeOpenApiWithRetry(searchApi, strategy, n) {
  let lastResult;
  let lastError;
  for (let attempt = 1; attempt <= OPEN_API_ATTEMPTS; attempt += 1) {
    try {
      const candidate = await searchApi(strategy, n);
      lastResult = candidate;
      if (Array.isArray(candidate)) return candidate;
      const complete = !candidate?.error && Number.isFinite(candidate?.hitCount);
      if (complete) {
        if (attempt === 1) return candidate;
        return {
          ...candidate,
          warnings: [
            ...(candidate?.warnings || []),
            `Open-API search provenance recovered on attempt ${attempt}/${OPEN_API_ATTEMPTS}.`,
          ],
        };
      }
      lastError = candidate?.error
        ? new Error(String(candidate.error))
        : new Error(`${strategy.id} returned records without a finite database hit count`);
    } catch (caught) {
      lastError = caught instanceof Error ? caught : new Error(String(caught));
    }
    if (attempt < OPEN_API_ATTEMPTS) await sleep(250 * attempt);
  }
  if (lastResult !== undefined) {
    if (Array.isArray(lastResult)) return lastResult;
    return {
      ...lastResult,
      warnings: [
        ...(lastResult?.warnings || []),
        `Open-API provenance remained incomplete after ${OPEN_API_ATTEMPTS} attempts; database hit count was not fabricated.`,
      ],
    };
  }
  throw lastError || new Error(`${strategy.id} open-API search failed without a result`);
}

// Cross-source merge uses the same clustering as the review's dedup stage
// (DOI → PMID → PMCID → trial id, then fuzzy title+year) rather than a bare
// 80-character title prefix, which both over-merged long similar titles and
// missed identifier matches. Duplicates collapse into one record here and carry
// the union of their source tags, which is what a "unique records" count means.
function mergeAcrossSources(rows) {
  const flat = rows.flatMap(({ db, records }) => (records || []).map((record) => ({ ...record, source: record.source || db })));
  const { records: clustered } = deduplicate(flat);
  const primaries = new Map();
  for (const record of clustered) {
    if (record.isDuplicate) continue;
    const { isDuplicate: _flag, dupOf: _dupOf, dedupCluster: _cluster, ...rest } = record;
    primaries.set(record.dedupCluster, {
      id: rest.doi ? `doi:${rest.doi}` : `t:${(rest.title || "").toLowerCase().slice(0, 80)}`,
      ...rest,
      sources: [rest.source],
      tiab: null,
    });
  }
  for (const record of clustered) {
    if (!record.isDuplicate) continue;
    const primary = primaries.get(record.dedupCluster);
    if (primary && !primary.sources.includes(record.source)) primary.sources.push(record.source);
  }
  return [...primaries.values()];
}

// RIS export of the merged record library — the portable bibliographic artifact a
// reviewer imports into a screening tool, and the provenance of what the search
// actually returned. TY=JOUR is a safe default; DO/AB/PY/AU map straight across.
export function toRis(records) {
  const esc = (v) => String(v == null ? "" : v).replace(/\r?\n/g, " ").trim();
  return (records || []).map((r) => {
    const lines = ["TY  - JOUR"];
    if (r.title) lines.push(`TI  - ${esc(r.title)}`);
    for (const a of r.authors || []) lines.push(`AU  - ${esc(a)}`);
    if (r.year) lines.push(`PY  - ${esc(r.year)}`);
    if (r.journal || r.venue) lines.push(`JO  - ${esc(r.journal || r.venue)}`);
    if (r.doi) lines.push(`DO  - ${esc(r.doi)}`);
    if (r.abstract) lines.push(`AB  - ${esc(r.abstract)}`);
    for (const s of r.sources || []) lines.push(`DB  - ${esc(s)}`);
    lines.push("ER  - ");
    return lines.join("\n");
  }).join("\n\n") + (records && records.length ? "\n" : "");
}

// Minimal RIS parser for native database exports captured by the browser bridge.
// Mirrors medantir-review's parseRis: full metadata beats title-only scrapes.
export function parseRis(ris, source) {
  const out = [];
  for (const entry of String(ris || "").split(/^ER\s+-.*$/m)) {
    const tag = (t) => [...entry.matchAll(new RegExp(`^${t}\\s+-\\s+(.*)$`, "gm"))].map((m) => m[1].trim()).filter(Boolean);
    const first = (t) => tag(t)[0];
    const title = first("TI") || first("T1") || "";
    if (!title) continue;
    const doi = (first("DO") || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() || undefined;
    const yr = first("PY") || first("Y1") || "";
    out.push({
      id: doi || `${source}:${title.slice(0, 60).toLowerCase().replace(/\s+/g, "-")}`,
      title,
      abstract: first("AB") || first("N2") || "",
      authors: [...tag("AU"), ...tag("A1")].slice(0, 10),
      year: yr ? Number(yr.slice(0, 4)) || 0 : 0,
      journal: first("JO") || first("JF") || first("T2") || undefined,
      doi,
      source,
    });
  }
  return out;
}

// Search Troubleshooting Agent (rule seed): map each flagged source to a likely
// cause and a concrete next action. A human gate resolves these before the stage
// can complete — a source that returned nothing is a signal, not a silent zero.
const TROUBLESHOOT = {
  empty: { cause: "Zero results", actions: ["Broaden terms / add synonyms", "Check field tags & truncation (*)", "Remove over-restrictive filters", "Confirm the concept exists in this database"] },
  error: { cause: "Source error", actions: ["Retry (transient rate-limit?)", "Check API/CORS availability", "Verify auth/login for walled sources", "Inspect query syntax for this platform"] },
};
export function troubleshoot(searches) {
  return (searches || [])
    .filter((s) => s.status !== "ok")
    .map((s) => ({ db: s.db, status: s.status, error: s.error || null, ...(TROUBLESHOOT[s.status] || { cause: s.status, actions: [] }) }));
}

/** Run one query across API sources, paginating each and recording per-source
 *  provenance: the database's own hit count, how many records were retrieved,
 *  whether retrieval was truncated, and the real reason a source produced nothing.
 *
 *  `searchFn` stays injectable. A legacy fn returning a bare array still works —
 *  it just cannot report a hit count, and the log says so. */
export async function executeSearches(query, sources, { n = 100, date = "", searchFn } = {}) {
  // The default adapter keeps the historic searchFn(query, { sources }) contract
  // while routing to the paginated, provenance-carrying source runner.
  const search = searchFn || (async (text, { source, n: limit }) => {
    const { searchSource } = await import("./academic.js");
    return searchSource(source, text, { n: limit });
  });

  const rows = await mapWithConcurrency(sources, SOURCE_CONCURRENCY, async (src) => {
    let result;
    let error = null;
    try {
      result = await search(query, { sources: [src], source: src, n });
    } catch (cause) {
      error = String(cause?.message || cause);
    }
    // Legacy array-returning searchFn vs the provenance-carrying shape.
    const legacy = Array.isArray(result);
    const records = legacy ? result : result?.records || [];
    const hitCount = legacy ? null : (Number.isFinite(result?.hitCount) ? result.hitCount : null);
    const sourceError = error || result?.error || null;
    const warnings = [...(legacy ? [] : result?.warnings || [])];
    if (legacy) warnings.push("This source reported no result count, so 'records identified' is what was retrieved rather than what the database matched.");
    return {
      db: src,
      query,
      date,
      count: records.length,
      hitCount,
      retrieved: records.length,
      truncated: Boolean(result?.truncated),
      pages: legacy ? 1 : result?.pages ?? 1,
      // A source that failed is never reported as an empty result set: the
      // troubleshooter would otherwise tell the operator to broaden their terms
      // when the real cause was a 429 or an outage.
      status: sourceError ? (records.length ? "partial" : "error") : result?.status || (records.length ? "ok" : "empty"),
      error: sourceError,
      warnings,
      records,
    };
  });

  const records = mergeAcrossSources(rows);
  const searches = rows.map(({ records: _records, ...row }) => row);
  const reportedHits = searches.reduce((sum, row) => sum + (Number.isFinite(row.hitCount) ? row.hitCount : row.count), 0);
  return {
    searches,
    records,
    summary: {
      sources: sources.length,
      // What the databases matched, and what we actually pulled down. Conflating
      // these overstates the search in the PRISMA flow.
      totalHits: reportedHits,
      retrievedRecords: searches.reduce((sum, row) => sum + row.count, 0),
      uniqueRecords: records.length,
      truncated: searches.some((row) => row.truncated),
      flagged: searches.filter((row) => row.status !== "ok").map((row) => ({ db: row.db, status: row.status, error: row.error })),
    },
  };
}

// How to DRIVE a search page: its URL, the query box, the export control, the
// result rows. That is a property of the PLATFORM, not of the database — Ovid is
// driven the same way whether you are searching MEDLINE, Embase or Global Health.
// Keying these on the fused database identifier is why a detected database
// compiled correctly and then failed at execution with "no recipe registered".
const PLATFORM_RECIPES = {
  pubmed: { platform: "PubMed", vendor: "NLM", searchUrl: "https://pubmed.ncbi.nlm.nih.gov/", selectors: { queryInput: "#id_term", submit: "button.search-btn", resultRow: "article.full-docsum" }, exportFormat: "nbib" },
  ovid: { platform: "Ovid", vendor: "Wolters Kluwer", searchUrl: "https://ovidsp.ovid.com/", selectors: { queryInput: "textarea, input[type='search'], input[type='text']", resultRow: ".result-item, .titles-row" }, exportFormat: "ris" },
  ebscohost: { platform: "EBSCOhost", vendor: "EBSCO", searchUrl: "https://search.ebscohost.com/", selectors: { queryInput: "textarea, input[type='search'], input[type='text']", exportButton: 'button[aria-label="Export"]', resultRow: ".result-list-li, article" }, exportFormat: "ris" },
  embase_com: { platform: "Embase.com", vendor: "Elsevier", searchUrl: "https://www.embase.com/search/quick", selectors: { queryInput: "textarea, input[type='search']", resultRow: ".result-item, article" }, exportFormat: "ris" },
  cochrane: { platform: "Cochrane Library", vendor: "Wiley", searchUrl: "https://www.cochranelibrary.com/advanced-search/search-manager", selectors: { queryInput: "textarea, input[type='search']", resultRow: ".search-results-item, article" }, exportFormat: "ris" },
  scopus: { platform: "Scopus", vendor: "Elsevier", searchUrl: "https://www.scopus.com/search/form.uri", selectors: { queryInput: "textarea, input[type='search']", exportButton: 'button[data-testid="export-button"]', resultRow: "tr.searchArea, .result-item" }, exportFormat: "ris" },
  wos: { platform: "Web of Science", vendor: "Clarivate", searchUrl: "https://www.webofscience.com/wos/woscc/advanced-search", selectors: { queryInput: "textarea, input[type='search']", exportButton: 'button[aria-label="Export"]', resultRow: "app-record, .search-results-item" }, exportFormat: "ris" },
  vhl: { platform: "BVS / LILACS", vendor: "BIREME", searchUrl: "https://pesquisa.bvsalud.org/portal/advanced/", selectors: { queryInput: "textarea, input[type='search'], input[name='q']", resultRow: ".item, article" }, exportFormat: "ris" },
  livivo: { platform: "LIVIVO", vendor: "ZB MED", searchUrl: "https://www.livivo.de/app", selectors: { queryInput: "input[type='search'], textarea", resultRow: ".result-item, article" }, exportFormat: "ris" },
};

// Per-database overrides, for the cases where one platform's databases genuinely
// need different handling (a distinct entry URL or database parameter).
const DATABASE_RECIPE_OVERRIDES = {
  psycinfo: { platform: "PsycINFO", vendor: "APA / institutional platform" },
};

/** Resolve the recipe for a strategy: platform first, then any per-database
 *  override. Works for a legacy identifier and for a discovered target alike. */
export function recipeFor(strategy) {
  // A strategy persisted in a saved review predates the platform field, and so
  // does any hand-built one, so fall back to deriving the platform from the
  // legacy identifier rather than reporting a database as having no route.
  const platform = strategy?.platform || TARGETS[strategy?.id]?.platform || null;
  const base = PLATFORM_RECIPES[platform] || null;
  const override = DATABASE_RECIPE_OVERRIDES[strategy?.id] || null;
  if (!base && !override) return null;
  return { ...base, ...override, selectors: { ...(base?.selectors || {}), ...(override?.selectors || {}) } };
}

export function prismaSRows(searches = []) {
  return searches.map((search) => ({
    database: search.db,
    platform: search.platform,
    vendor: search.vendor,
    searchedAt: search.searchedAt,
    executedQuery: search.query,
    // How faithfully the executed query reproduced the written strategy. A PRISMA-S
    // log that omits this implies every line ran exactly as compiled.
    booleanFidelity: search.fidelity || "",
    // PRISMA-S expects the access route to be reportable: a search run through an
    // institutional proxy is not the same search as one run on the open web.
    accessRoute: search.accessRoute || "",
    accessVia: search.accessVia || "",
    limits: (search.limits || []).join("; "),
    databaseHits: Number.isFinite(search.hitCount) ? search.hitCount : "",
    recordsRetrieved: search.count,
    status: search.status,
    warning: (search.warnings || []).join("; "),
  }));
}

export function toCsv(rows = []) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${columns.map(cell).join(",")}\n${rows.map((row) => columns.map((column) => cell(row[column])).join(",")).join("\n")}\n`;
}

/** Execute database-specific compiled strategies through source-native APIs or
 * the existing isolated browser bridge. Every source produces an audit row;
 * authentication walls and selector drift are never converted to silent zeroes. */
export async function executeCompiledStrategies(strategies, {
  n = 100,
  apiSearch,
  browserSearch,
  onProgress = () => {},
  limits = [],
} = {}) {
  const searchApi = apiSearch || (async (strategy, limit) => {
    const { searchSource } = await import("./academic.js");
    // The compiled API plan, not the display line: OpenAlex needs a filter
    // expression, Crossref needs the excluded concepts stripped out.
    const plan = strategy.execution || {};
    return searchSource(strategy.id, plan.query || strategy.combined, { n: limit, filter: plan.filter || null });
  });
  const searchBrowser = browserSearch || (await import("./browserBridge.js")).databaseSearch;

  const rows = await mapWithConcurrency(strategies || [], SOURCE_CONCURRENCY, async (strategy) => {
    const startedAt = new Date().toISOString();
    onProgress({ db: strategy.id, status: "running", searchedAt: startedAt });
    let records = [];
    let result;
    let error = null;
    let nativeRis = null;
    let access = null;
    const recipe = recipeFor(strategy);
    const planNotes = strategy.execution?.notes || [];
    try {
      if (strategy.auto) {
        result = await executeOpenApiWithRetry(searchApi, strategy, n);
        records = Array.isArray(result) ? result : result?.records || [];
        if (result?.error) throw new Error(result.error);
        result = Array.isArray(result)
          ? { platform: strategy.name, vendor: "Source API", warnings: [] }
          : { ...result, platform: strategy.name, vendor: "Source API" };
      } else if (recipe) {
        // Route through the operator's Research4Life session when discovery found
        // this database there; otherwise open the publisher directly. Searching a
        // direct URL while a live R4L entitlement exists just hits a paywall.
        access = resolveAccessUrl(strategy, recipe.searchUrl);
        result = await searchBrowser("db_search", { ...recipe, searchUrl: access.url, database: strategy.id, query: strategy.combined }, { session: sessionRefFor(strategy) });
        if (!result.ok || result.error) throw new Error(result.error || "Browser search failed");
        // Prefer the database's native citation export (full metadata) over
        // scraped result rows; the verbatim export is kept for provenance.
        if (typeof result.ris === "string" && result.ris.trim()) {
          records = parseRis(result.ris, strategy.id);
          nativeRis = result.ris.trim();
        } else {
          records = result.records || [];
        }
      } else {
        throw new Error("No executable connector recipe is registered for this database");
      }
    } catch (caught) {
      error = String(caught?.message || caught);
    }
    const warnings = [...planNotes, ...(result?.warnings || [])];
    const status = error
      ? (records.length ? "partial" : "error")
      : result?.needsAuth ? "needs-auth"
      : warnings.length && !records.length ? "attention"
      : records.length ? "ok" : "empty";
    const row = {
      db: strategy.id,
      name: strategy.name,
      platform: result?.platform || recipe?.platform || strategy.name,
      vendor: result?.vendor || recipe?.vendor || "Source API",
      query: result?.executedQuery || strategy.execution?.filter || strategy.execution?.query || strategy.combined,
      searchedAt: startedAt,
      count: records.length ? records.length : Number(result?.resultCount ?? 0),
      hitCount: Number.isFinite(result?.hitCount) ? result.hitCount : null,
      truncated: Boolean(result?.truncated),
      fidelity: strategy.fidelity || (strategy.auto ? "full" : "manual"),
      status,
      needsAuth: Boolean(result?.needsAuth),
      url: result?.url || access?.url || recipe?.searchUrl || "",
      accessRoute: access?.route || (strategy.auto ? "api" : "direct"),
      accessVia: access?.via || null,
      exportFormat: result?.exportFormat || recipe?.exportFormat || "json",
      exportUsed: Boolean(result?.exportUsed),
      limits,
      warnings,
      error,
      records,
      nativeRis,
    };
    onProgress(row);
    return row;
  });

  const records = mergeAcrossSources(rows);
  const searches = rows.map(({ records: _records, nativeRis: _ris, ...row }) => row);
  // Verbatim native exports, one chunk per bridge source that produced one —
  // the unmodified provenance of what each database actually returned.
  const nativeRis = rows.map((row) => row.nativeRis).filter(Boolean).join("\n");
  return {
    searches,
    records,
    nativeRis,
    prismaS: prismaSRows(searches),
    summary: {
      sources: searches.length,
      totalHits: searches.reduce((sum, search) => sum + (Number.isFinite(search.hitCount) ? search.hitCount : search.count), 0),
      retrievedRecords: searches.reduce((sum, search) => sum + search.count, 0),
      uniqueRecords: records.length,
      truncated: searches.some((search) => search.truncated),
      completed: searches.filter((search) => search.status === "ok").length,
      flagged: searches.filter((search) => search.status !== "ok"),
    },
  };
}
