// searchRetrieval.js — paginated, rate-limit-aware retrieval from the keyless
// bibliographic APIs, carrying the provenance a PRISMA-S search log requires.
//
// Three properties distinguish this from a plain fetch-and-map:
//
//  1. HIT COUNT vs RETRIEVED. Every source reports how many records IT matched
//     (`meta.count`, `hitCount`, `total-results`, `total`). That number is what a
//     PRISMA flow means by "records identified"; it is not the same as how many
//     records we pulled down. Reporting only the latter silently understates the
//     search, so both are returned along with an explicit `truncated` flag.
//  2. PAGINATION. A systematic search routinely matches thousands of records.
//     Each source is paged to `maxRecords` (OpenAlex/Crossref cursors, Europe PMC
//     cursorMark, Semantic Scholar offset) instead of returning the first page.
//  3. FAILURE IS NOT EMPTINESS. An HTTP 429 or 500 is reported as `error` with the
//     status attached, never coerced to "zero results" — otherwise the search
//     troubleshooter advises broadening terms when the real cause was throttling.
//
// `fetchImpl` and `sleep` are injectable so every path is unit-testable offline.

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8000;
const DEFAULT_TIMEOUT_MS = 30_000;

// Page ceilings are the documented per-request maxima for each API.
export const PAGE_LIMITS = { openalex: 200, europepmc: 1000, crossref: 1000, semanticscholar: 100 };

// The polite pools of OpenAlex and Crossref want a reachable contact address.
// A fabricated one is worse than none: it can get the caller de-prioritised.
function contactEmail() {
  const configured = import.meta.env?.VITE_CONTACT_EMAIL;
  return typeof configured === "string" && configured.includes("@") ? configured.trim() : null;
}
function politeSuffix() {
  const email = contactEmail();
  return email ? `&mailto=${encodeURIComponent(email)}` : "";
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt, retryAfterHeader) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Single JSON request with timeout and retry on throttling/server errors.
 *  Always resolves — the caller decides what a failure means. */
export async function fetchJson(url, {
  headers,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  attempts = MAX_ATTEMPTS,
  signal,
  fetchImpl,
  sleep = defaultSleep,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return { ok: false, status: 0, data: null, error: "no fetch implementation available" };

  let last = { ok: false, status: 0, data: null, error: "request was not attempted" };
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await doFetch(url, { headers, signal: signal || controller?.signal });
      const status = Number(response?.status ?? 0);
      if (response?.ok) {
        const data = await response.json().catch(() => null);
        if (data == null) { last = { ok: false, status, data: null, error: `HTTP ${status}: response body was not valid JSON` }; break; }
        return { ok: true, status, data, error: null };
      }
      const retryAfter = response?.headers?.get?.("retry-after");
      const retryable = status === 429 || (status >= 500 && status < 600);
      last = {
        ok: false,
        status,
        data: null,
        error: status === 429 ? "HTTP 429: rate limited by the source" : `HTTP ${status}`,
        retryAfter: retryAfter || null,
      };
      if (!retryable || attempt === attempts - 1) break;
      await sleep(backoffDelay(attempt, retryAfter));
    } catch (cause) {
      const aborted = cause?.name === "AbortError";
      last = { ok: false, status: 0, data: null, error: aborted ? `request timed out after ${timeoutMs}ms` : String(cause?.message || cause) };
      if (aborted || attempt === attempts - 1) break;
      await sleep(backoffDelay(attempt));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return last;
}

const cleanDoi = (value) => (value ? String(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase() : null);

/** Shared normalised record shape. `pmid`/`pmcid` matter: dedup clusters on
 *  DOI → PMID → PMCID before falling back to fuzzy titles. */
export function normalizeRecord({ title, year, doi, authors, cites, source, url, abstract, pmid, pmcid, isOA }) {
  const cleaned = cleanDoi(doi);
  return {
    title: title || "(untitled)",
    year: year || null,
    doi: cleaned,
    authors: authors || [],
    cites: cites ?? null,
    source,
    url: url || (cleaned ? `https://doi.org/${cleaned}` : null),
    abstract: abstract || "",
    pmid: pmid ? String(pmid) : null,
    pmcid: pmcid || null,
    isOA: !!isOA,
  };
}

function invertAbstract(inverted) {
  if (!inverted) return "";
  const words = [];
  for (const [word, positions] of Object.entries(inverted)) for (const position of positions) words[position] = word;
  return words.join(" ").slice(0, 600);
}

function outcome({ source, records, hitCount, pages, warnings, failure }) {
  const retrieved = records.length;
  const known = Number.isFinite(hitCount) ? hitCount : null;
  const truncated = known != null && known > retrieved;
  const notes = [...warnings];
  if (truncated) notes.push(`Retrieved ${retrieved} of ${known} matching records — retrieval was capped, so this is a subset of the source's result set.`);
  return {
    source,
    records,
    hitCount: known,
    retrieved,
    truncated,
    pages,
    // A source that errors mid-pagination has partial results: neither a clean
    // success nor an empty set. Collapsing that into "ok" would hide the gap.
    status: failure ? (retrieved ? "partial" : "error") : retrieved ? "ok" : "empty",
    error: failure || null,
    warnings: notes,
  };
}

// --- OpenAlex ---------------------------------------------------------------
// `filter` (e.g. title_and_abstract.search:…) honours AND/OR/NOT; the bare
// `search` parameter is relevance free text and ignores Boolean operators, so
// callers compiling a strategy must pass `filter`.
export async function retrieveOpenAlex(query, { maxRecords = 1000, filter = null, ...options } = {}) {
  const pageSize = Math.min(PAGE_LIMITS.openalex, maxRecords);
  const selector = filter ? `filter=${encodeURIComponent(filter)}` : `search=${encodeURIComponent(query)}`;
  const records = [];
  const warnings = [];
  let cursor = "*";
  let hitCount = null;
  let pages = 0;
  let failure = null;

  while (cursor && records.length < maxRecords) {
    const url = `https://api.openalex.org/works?${selector}&per-page=${pageSize}&cursor=${encodeURIComponent(cursor)}${politeSuffix()}`;
    const response = await fetchJson(url, options);
    if (!response.ok) { failure = response.error; break; }
    pages += 1;
    hitCount = Number(response.data?.meta?.count ?? hitCount);
    for (const work of response.data?.results || []) {
      records.push(normalizeRecord({
        title: work.title,
        year: work.publication_year,
        doi: work.doi,
        authors: (work.authorships || []).slice(0, 5).map((a) => a.author?.display_name).filter(Boolean),
        cites: work.cited_by_count,
        source: "OpenAlex",
        abstract: invertAbstract(work.abstract_inverted_index),
        pmid: work.ids?.pmid ? String(work.ids.pmid).replace(/^https?:\/\/.*\//, "") : null,
        pmcid: work.ids?.pmcid ? String(work.ids.pmcid).replace(/^https?:\/\/.*\//, "") : null,
        isOA: work.open_access?.is_oa,
      }));
    }
    cursor = response.data?.meta?.next_cursor || null;
    if (!(response.data?.results || []).length) break;
  }
  if (!filter && query) warnings.push("OpenAlex ran as relevance free text: the bare search parameter does not honour AND/OR/NOT.");
  return outcome({ source: "openalex", records, hitCount, pages, warnings, failure });
}

// --- Europe PMC -------------------------------------------------------------
// Boolean-capable with field tags (TITLE_ABS:, MESH:, AUTH:) — the closest
// keyless match to a MEDLINE-style strategy. Paged with cursorMark.
export async function retrieveEuropePmc(query, { maxRecords = 1000, ...options } = {}) {
  const pageSize = Math.min(PAGE_LIMITS.europepmc, maxRecords);
  const records = [];
  let cursorMark = "*";
  let hitCount = null;
  let pages = 0;
  let failure = null;

  while (cursorMark && records.length < maxRecords) {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${pageSize}&cursorMark=${encodeURIComponent(cursorMark)}`;
    const response = await fetchJson(url, options);
    if (!response.ok) { failure = response.error; break; }
    pages += 1;
    hitCount = Number(response.data?.hitCount ?? hitCount);
    const page = response.data?.resultList?.result || [];
    for (const result of page) {
      records.push(normalizeRecord({
        title: result.title,
        year: result.pubYear ? Number(result.pubYear) : null,
        doi: result.doi,
        authors: result.authorString ? result.authorString.split(", ").slice(0, 5) : [],
        cites: result.citedByCount,
        source: "Europe PMC",
        url: result.doi ? null : `https://europepmc.org/article/${result.source}/${result.id}`,
        abstract: result.abstractText || "",
        pmid: result.pmid || null,
        pmcid: result.pmcid || null,
        isOA: result.isOpenAccess === "Y" || result.inEPMC === "Y",
      }));
    }
    const next = response.data?.nextCursorMark || null;
    cursorMark = next && next !== cursorMark && page.length ? next : null;
  }
  return outcome({ source: "europepmc", records, hitCount, pages, warnings: [], failure });
}

// --- Crossref ---------------------------------------------------------------
// A DOI metadata authority, not a Boolean search engine: `query` is relevance
// free text. Useful for completeness checks and DOI enrichment, and labelled as
// such so it is never mistaken for a database search line.
export async function retrieveCrossref(query, { maxRecords = 1000, ...options } = {}) {
  const pageSize = Math.min(PAGE_LIMITS.crossref, maxRecords);
  const records = [];
  let cursor = "*";
  let hitCount = null;
  let pages = 0;
  let failure = null;

  while (cursor && records.length < maxRecords) {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${pageSize}&cursor=${encodeURIComponent(cursor)}${politeSuffix()}`;
    const response = await fetchJson(url, options);
    if (!response.ok) { failure = response.error; break; }
    pages += 1;
    hitCount = Number(response.data?.message?.["total-results"] ?? hitCount);
    const items = response.data?.message?.items || [];
    for (const item of items) {
      records.push(normalizeRecord({
        title: Array.isArray(item.title) ? item.title[0] : item.title,
        year: item.issued?.["date-parts"]?.[0]?.[0],
        doi: item.DOI,
        authors: (item.author || []).slice(0, 5).map((a) => [a.given, a.family].filter(Boolean).join(" ")),
        cites: item["is-referenced-by-count"],
        source: "Crossref",
        abstract: item.abstract || "",
      }));
    }
    const next = response.data?.message?.["next-cursor"] || null;
    cursor = next && next !== cursor && items.length ? next : null;
  }
  return outcome({
    source: "crossref",
    records,
    hitCount,
    pages,
    warnings: ["Crossref has no Boolean query language: this line ran as relevance-ranked free text and is supplementary to the database searches."],
    failure,
  });
}

// --- Semantic Scholar -------------------------------------------------------
// Offset paging, hard-capped by the API at offset+limit ≤ 10000. Keyless access
// is aggressively throttled, which is exactly why 429 must surface as an error.
export async function retrieveSemanticScholar(query, { maxRecords = 1000, ...options } = {}) {
  const pageSize = Math.min(PAGE_LIMITS.semanticscholar, maxRecords);
  const fields = "title,year,externalIds,abstract,authors,citationCount,isOpenAccess";
  const records = [];
  const warnings = [];
  let hitCount = null;
  let pages = 0;
  let failure = null;

  for (let offset = 0; offset < maxRecords; offset += pageSize) {
    if (offset + pageSize > 10_000) { warnings.push("Semantic Scholar caps paging at 10,000 records; retrieval stopped at that ceiling."); break; }
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${pageSize}&fields=${fields}`;
    const response = await fetchJson(url, options);
    if (!response.ok) { failure = response.error; break; }
    pages += 1;
    hitCount = Number(response.data?.total ?? hitCount);
    const page = response.data?.data || [];
    for (const paper of page) {
      records.push(normalizeRecord({
        title: paper.title,
        year: paper.year,
        doi: paper.externalIds?.DOI,
        authors: (paper.authors || []).slice(0, 5).map((a) => a.name).filter(Boolean),
        cites: paper.citationCount,
        source: "Semantic Scholar",
        abstract: paper.abstract || "",
        pmid: paper.externalIds?.PubMed || null,
        pmcid: paper.externalIds?.PubMedCentral || null,
        isOA: paper.isOpenAccess,
      }));
    }
    if (page.length < pageSize) break;
  }
  return outcome({ source: "semanticscholar", records, hitCount, pages, warnings, failure });
}

export const RETRIEVERS = {
  openalex: retrieveOpenAlex,
  europepmc: retrieveEuropePmc,
  crossref: retrieveCrossref,
  semanticscholar: retrieveSemanticScholar,
};

export function isRetrievable(sourceId) {
  return Object.hasOwn(RETRIEVERS, sourceId);
}

/** Retrieve one source with full provenance. Unknown sources are reported, not
 *  silently skipped — a source the operator selected and never ran is a gap. */
export async function retrieveSource(sourceId, query, options = {}) {
  const retriever = RETRIEVERS[sourceId];
  if (!retriever) {
    return { source: sourceId, records: [], hitCount: null, retrieved: 0, truncated: false, pages: 0, status: "error", error: `no paginated retriever is registered for '${sourceId}'`, warnings: [] };
  }
  return retriever(query, options);
}

/** Bounded-concurrency map. Sources run in parallel, but never so many at once
 *  that the polite-pool rate limits start returning 429s. */
export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
