// research4life.js — discover what a Research4Life account can actually reach.
//
// R4L (Hinari, AGORA, OARE, ARDI, GOALI) fronts publisher platforms with a WAM
// proxy: the target host is folded into a path segment on login.research4life.org
// with dots rewritten to underscores, behind a route prefix that varies by
// session and institution (tacsgr1, tacsgr2, …). Nothing about that prefix is
// stable, so it is never assumed — it is read back from a live proxied URL.
//
// The catalogue is DISCOVERED, not declared. Entitlements differ by country,
// institution and R4L programme band, and they change; a hardcoded list would be
// wrong for most accounts and silently stale for the rest. What is declared here
// is a matcher that recognises platforms we can already compile a strategy for,
// so discovery decides availability and the matcher decides executability.

import { targetFor } from "./searchStrategy.js";

const CATALOG_KEY = "medantir.r4l.catalog.v1";
export const R4L_PROXY_HOST = "login.research4life.org";
export const R4L_PORTAL_HOST = "portal.research4life.org";
export const R4L_DATABASES_PATH = "/content/databases";

export const encodeProxyHost = (host) => String(host || "").trim().toLowerCase().replace(/\./g, "_");
export const decodeProxyHost = (segment) => String(segment || "").trim().toLowerCase().replace(/_/g, ".");

/** Split a proxied URL into its parts. The route prefix can only be separated
 *  from the encoded host when the target host is known, because
 *  `tacsgr1portal_research4life_org` is otherwise ambiguous — `tacsgr1portal`
 *  is a syntactically valid label. Callers pass the host they expect. */
export function parseProxyUrl(value, knownHost = R4L_PORTAL_HOST) {
  let url;
  try { url = new URL(String(value)); } catch { return null; }
  if (url.hostname.toLowerCase() !== R4L_PROXY_HOST) return null;
  const segment = url.pathname.split("/").filter(Boolean)[0] || "";
  const encoded = encodeProxyHost(knownHost);
  if (!segment.toLowerCase().endsWith(encoded)) return { proxyHost: url.hostname, segment, prefix: null, targetHost: null };
  return {
    proxyHost: url.hostname,
    segment,
    prefix: segment.slice(0, segment.length - encoded.length),
    targetHost: knownHost,
    // pathname is "/<segment>/rest"; drop the leading slash and the segment, and
    // keep the conventional leading slash on what remains.
    targetPath: url.pathname.slice(segment.length + 1) || "/",
  };
}

// Name-specific hints are tested before host hints on purpose: a named reference
// work delivered on a publisher's platform is a reference work, and filing it
// under "publisher" because of its host makes a long catalogue harder to scan.
function collectionKind({ name, targetHost }) {
  for (const hint of COLLECTION_HINTS) {
    if (hint.name && hint.name.test(name)) return hint.kind;
  }
  for (const hint of COLLECTION_HINTS) {
    if (hint.host && targetHost && hint.host.test(targetHost)) return hint.kind;
  }
  return "other";
}

/** Build a proxied URL for an arbitrary target, reusing the prefix observed in a
 *  live session. Needed for deep links: discovery yields a platform's landing
 *  page, but a compiled strategy has to open its advanced-search path. */
export function buildProxyUrl(prefix, targetUrl) {
  if (!prefix) return null;
  let url;
  try { url = new URL(String(targetUrl)); } catch { return null; }
  const suffix = `${url.pathname}${url.search}${url.hash}`;
  return `https://${R4L_PROXY_HOST}/${prefix}${encodeProxyHost(url.hostname)}${suffix === "/" ? "/" : suffix}`;
}

// Research4Life is an ACCESS POINT, not a platform: it proxies through to Ovid,
// EBSCOhost, Embase.com and the rest. So discovery resolves two things
// separately — the PLATFORM from the target host (which decides syntax) and the
// DATABASE from the link text (which decides controlled vocabulary). Any database
// sitting on a known platform host is therefore searchable immediately, even one
// nobody has ever named in this codebase.
const PLATFORM_HOSTS = [
  { platform: "ovid", host: /(^|\.)ovid\.com$/i, searchPath: "https://ovidsp.ovid.com/" },
  { platform: "ebscohost", host: /(^|\.)ebscohost\.com$|(^|\.)ebsco\.com$/i, searchPath: "https://search.ebscohost.com/" },
  { platform: "embase_com", host: /(^|\.)embase\.com$/i, searchPath: "https://www.embase.com/search/quick" },
  { platform: "scopus", host: /(^|\.)scopus\.com$/i, searchPath: "https://www.scopus.com/search/form.uri" },
  { platform: "wos", host: /(^|\.)webofscience\.com$|(^|\.)webofknowledge\.com$/i, searchPath: "https://www.webofscience.com/wos/woscc/advanced-search" },
  { platform: "cochrane", host: /(^|\.)cochranelibrary\.com$/i, searchPath: "https://www.cochranelibrary.com/advanced-search/search-manager" },
  { platform: "vhl", host: /(^|\.)bvsalud\.org$/i, searchPath: "https://pesquisa.bvsalud.org/portal/advanced/" },
  { platform: "pubmed", host: /(^|\.)ncbi\.nlm\.nih\.gov$/i, searchPath: "https://pubmed.ncbi.nlm.nih.gov/" },
  { platform: "livivo", host: /(^|\.)livivo\.de$/i, searchPath: "https://www.livivo.de/app" },
  { platform: "proquest", host: /(^|\.)proquest\.com$/i, searchPath: "https://www.proquest.com/" },
];

export function platformForHost(host) {
  return PLATFORM_HOSTS.find((entry) => host && entry.host.test(host)) || null;
}

// Retained only for the handful of platforms R4L labels in its own wording
// without a distinguishing host. Host matching wins wherever both apply.
const PLATFORM_MATCHERS = [
  { id: "embase_com", host: /(^|\.)embase\.com$/i, name: /\bembase\b/i, platform: "Embase.com", searchPath: "https://www.embase.com/search/quick", kind: "index" },
  { id: "scopus", host: /(^|\.)scopus\.com$/i, name: /\bscopus\b/i, platform: "Scopus", searchPath: "https://www.scopus.com/search/form.uri", kind: "index" },
  { id: "cinahl", host: /(^|\.)ebscohost\.com$|(^|\.)ebsco\.com$/i, name: /\bcinahl\b/i, platform: "EBSCOhost", searchPath: "https://search.ebscohost.com/", kind: "index" },
  { id: "psycinfo", host: null, name: /\bpsyc(info|articles)\b/i, platform: "EBSCOhost", searchPath: "https://search.ebscohost.com/", kind: "index" },
  { id: "ovid_medline", host: /(^|\.)ovid\.com$/i, name: /\bovid\b.*\bmedline\b|\bmedline\b.*\bovid\b/i, platform: "Ovid", searchPath: "https://ovidsp.ovid.com/", kind: "index" },
  { id: "ovid_embase", host: null, name: /\bovid\b.*\bembase\b/i, platform: "Ovid", searchPath: "https://ovidsp.ovid.com/", kind: "index" },
  { id: "cochrane", host: /(^|\.)cochranelibrary\.com$/i, name: /\bcochrane\b/i, platform: "Cochrane Library", searchPath: "https://www.cochranelibrary.com/advanced-search/search-manager", kind: "index" },
  { id: "wos", host: /(^|\.)webofscience\.com$|(^|\.)webofknowledge\.com$/i, name: /\bweb of (science|knowledge)\b/i, platform: "Web of Science", searchPath: "https://www.webofscience.com/wos/woscc/advanced-search", kind: "index" },
  { id: "lilacs", host: /(^|\.)bvsalud\.org$/i, name: /\blilacs\b|\bbvs\b/i, platform: "BVS / LILACS", searchPath: "https://pesquisa.bvsalud.org/portal/advanced/", kind: "index" },
  { id: "pubmed", host: /(^|\.)ncbi\.nlm\.nih\.gov$/i, name: /\bpubmed\b|\bmedline\b/i, platform: "PubMed", searchPath: "https://pubmed.ncbi.nlm.nih.gov/", kind: "index" },
];

// Everything else is still worth cataloguing, just not auto-executable. Sorting
// these into publisher collections vs. reference works is what makes a list of
// several hundred entries usable rather than a wall of links.
const COLLECTION_HINTS = [
  { kind: "publisher", host: /(^|\.)(sciencedirect|springer|link\.springer|wiley|onlinelibrary\.wiley|tandfonline|sagepub|oup\.com|academic\.oup|nature|bmj|thelancet|jstor|cambridge|karger|thieme)\.?/i },
  { kind: "reference", name: /\b(encyclopa?edia|dictionary|handbook|atlas|textbook|clinicalkey|uptodate|bmj best practice)\b/i },
  { kind: "trials", name: /\b(trial|ictrp|clinicaltrials)\b/i },
];

const KIND_ORDER = { index: 0, trials: 1, publisher: 2, reference: 3, other: 4 };

function classify({ name, targetHost }) {
  // Platform first, from the host — this is what makes an unnamed database usable.
  const byHost = platformForHost(targetHost);
  if (byHost) {
    const target = targetFor({ platform: byHost.platform, database: name });
    return {
      platform: byHost.platform,
      platformName: target?.platformName || byHost.platform,
      database: name,
      vocabulary: target?.vocabulary || null,
      freeTextOnly: !target?.vocabulary,
      searchPath: byHost.searchPath,
      canonicalId: legacyIdFor(byHost.platform, name),
      kind: "index",
    };
  }
  // Fall back to name matching for platforms R4L labels without a distinct host.
  for (const matcher of PLATFORM_MATCHERS) {
    if (matcher.name && matcher.name.test(name) && (!matcher.host || !targetHost)) {
      const target = targetFor({ platform: matcher.platformId || matcher.id, database: name });
      return {
        platform: target?.platform || null,
        platformName: matcher.platform,
        database: name,
        vocabulary: target?.vocabulary || null,
        freeTextOnly: !target?.vocabulary,
        searchPath: matcher.searchPath,
        canonicalId: matcher.id,
        kind: matcher.kind,
      };
    }
  }
  return { platform: null, platformName: null, database: name, vocabulary: null, freeTextOnly: true, canonicalId: null, searchPath: null, kind: collectionKind({ name, targetHost }) };
}

// Keep the historic identifier where a discovered pair corresponds to one, so
// saved reviews, recipes and PRISMA-S rows stay stable across the change.
const LEGACY_BY_PAIR = [
  { platform: "ovid", match: /\bmedline\b/i, id: "ovid_medline" },
  { platform: "ovid", match: /\bembase\b/i, id: "ovid_embase" },
  { platform: "ovid", match: /\bpsyc/i, id: "psycinfo" },
  { platform: "embase_com", match: /./, id: "embase_com" },
  { platform: "scopus", match: /./, id: "scopus" },
  { platform: "wos", match: /./, id: "wos" },
  { platform: "cochrane", match: /./, id: "cochrane" },
  { platform: "ebscohost", match: /\bcinahl\b/i, id: "cinahl" },
  { platform: "ebscohost", match: /\bpsyc/i, id: "psycinfo" },
  { platform: "vhl", match: /\blilacs\b/i, id: "lilacs" },
  { platform: "pubmed", match: /./, id: "pubmed" },
];

function legacyIdFor(platform, name) {
  return LEGACY_BY_PAIR.find((entry) => entry.platform === platform && entry.match.test(String(name || "")))?.id || null;
}

/** Normalise the anchors harvested from the R4L databases page into a catalogue.
 *  Input is whatever the authenticated browser could see: [{ text, href }]. */
export function parseDatabaseLinks(links = [], { prefix = null } = {}) {
  const seen = new Map();
  for (const link of links) {
    const name = String(link?.text || "").replace(/\s+/g, " ").trim();
    const href = String(link?.href || "").trim();
    if (!name || name.length < 2 || !/^https?:/i.test(href)) continue;

    // The href is already a proxied URL. Recover the target host from its
    // segment by stripping the observed prefix — no guessing required.
    let targetHost = null;
    try {
      const url = new URL(href);
      if (url.hostname.toLowerCase() === R4L_PROXY_HOST) {
        const segment = url.pathname.split("/").filter(Boolean)[0] || "";
        const encoded = prefix && segment.startsWith(prefix) ? segment.slice(prefix.length) : segment;
        targetHost = decodeProxyHost(encoded) || null;
      } else {
        targetHost = url.hostname.toLowerCase();
      }
    } catch { /* unparseable href → keep the name only */ }

    const classified = classify({ name, targetHost });

    // A database proxies to an EXTERNAL publisher. Portal navigation ("Home",
    // "Journals", "Log out from institution") points back at research4life.org,
    // and admitting it produced a catalogue of 85 entries with 0 databases in it.
    // A recognised platform name still qualifies, in case a link is not proxied.
    const external = targetHost && !/(^|\.)research4life\.org$/i.test(targetHost) && !/(^|\.)login\.research4life\.org$/i.test(targetHost);
    if (!external && !classified.platform) continue;

    const key = classified.platform ? `${classified.platform}::${name.toLowerCase()}` : `${name.toLowerCase()}::${targetHost || href}`;
    if (seen.has(key)) continue;
    seen.set(key, { name, url: href, targetHost, ...classified });
  }
  return sortDatabases([...seen.values()]);
}

/** Executable indexes first, then trials, publisher collections, reference works.
 *  Alphabetical inside each band so a long catalogue stays navigable. */
export function sortDatabases(entries = []) {
  return [...entries].sort((a, b) => {
    const order = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
    if (order) return order;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

/** Run discovery against the operator's live R4L session.
 *
 *  The operator signs in themselves — no credential passes through this code.
 *  We navigate the already-authenticated session to the databases page, read the
 *  anchors, and derive the catalogue plus the session's route prefix from what is
 *  actually there. `linksFn` is injectable so the parsing path is testable offline. */
export async function discoverR4lDatabases({ portalUrl, linksFn } = {}) {
  const fetchLinks = linksFn || (await import("./browserBridge.js")).databaseLinks;
  const target = portalUrl || `https://${R4L_PROXY_HOST}/${DEFAULT_PORTAL_SEGMENT}${R4L_DATABASES_PATH}`;
  const result = await fetchLinks({ url: target });

  if (!result?.ok) return { ok: false, error: result?.error || "Discovery could not reach the databases page." };
  if (result.needsAuth || result.signInGate) {
    return {
      ok: false,
      needsAuth: true,
      landedUrl: result.url,
      error: result.warnings?.[0] || "Not signed in to Research4Life. Sign in via the Browser tab, then run detection again.",
    };
  }

  // The landed URL carries the session's own route prefix. Reading it here is why
  // nothing about `tacsgr1` needs to be hardcoded.
  const parsed = parseProxyUrl(result.url || target, R4L_PORTAL_HOST);
  const prefix = parsed?.prefix || null;
  const databases = parseDatabaseLinks(result.links || [], { prefix });
  const executable = databases.filter((entry) => entry.canonicalId);

  if (!databases.length) {
    // Distinguish "signed out" from "layout changed": claiming the latter when the
    // former is true sends the operator to debug a parser instead of signing in.
    const total = (result.links || []).length;
    const signedIn = (result.links || []).some((link) => /log ?out/i.test(link.text || ""));
    const looksLikeGate = !signedIn && (/\/(login|signin|auth)/i.test(String(result.url || "")) || total < 5);

    // Keep the route prefix even with an empty catalogue. The prefix is what makes
    // proxied access possible at all, and discarding it because the LIST failed
    // meant a signed-in R4L session could not be used — searches kept going to the
    // publisher's direct URL, where the operator has no cookie and hits a wall.
    if (signedIn && prefix) {
      saveR4lCatalog({
        prefix, proxyHost: R4L_PROXY_HOST, landedUrl: result.url, detectedAt: new Date().toISOString(),
        databases: [], counts: { total: 0, executable: 0 }, sessionOnly: true,
        warnings: ["The database list could not be read, but the Research4Life session and its route prefix were captured — searches will still be proxied through it."],
      });
    }

    return {
      ok: false,
      needsAuth: looksLikeGate,
      prefix,
      landedUrl: result.url,
      error: looksLikeGate
        ? `Research4Life returned no database list at ${result.url || "the portal"} — the session looks signed out. Sign in on the portal, then run detection again.`
        // Signed in, page rendered, but no entry proxies to an external publisher:
        // the list is behind a filter or loads on demand rather than in the markup.
        : `Signed in, and the page returned ${total} links, but none point to an external publisher — the database list is filtered or loads on demand. Open the portal, set the list to show all databases, then run detection again.`,
    };
  }

  const catalog = {
    prefix,
    proxyHost: R4L_PROXY_HOST,
    landedUrl: result.url || target,
    detectedAt: new Date().toISOString(),
    databases,
    counts: { total: databases.length, executable: executable.length },
    warnings: [
      ...(result.warnings || []),
      ...(prefix ? [] : ["The session route prefix could not be read, so deep search links fall back to each database's landing page."]),
    ],
  };
  saveR4lCatalog(catalog);
  return { ok: true, ...catalog };
}

// The portal segment for a first visit. Only the ENCODED HOST is meaningful here;
// R4L redirects to the session's own prefixed form, which is what we then read.
const DEFAULT_PORTAL_SEGMENT = `tacsgr1${encodeProxyHost(R4L_PORTAL_HOST)}`;

// --- catalogue persistence --------------------------------------------------

export function loadR4lCatalog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CATALOG_KEY) || "null");
    if (parsed && Array.isArray(parsed.databases)) return parsed;
  } catch { /* corrupt or unavailable storage */ }
  return null;
}

export function saveR4lCatalog(catalog) {
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch { /* storage unavailable */ }
  return catalog;
}

export function clearR4lCatalog() {
  try { localStorage.removeItem(CATALOG_KEY); } catch { /* storage unavailable */ }
}

/** Databases the compiler can execute, given what discovery actually found. */
/** Databases the compiler can execute: anything sitting on a platform whose
 *  syntax we can render — not merely the ones that happen to have a legacy id. */
export function executableFromCatalog(catalog = loadR4lCatalog()) {
  return (catalog?.databases || []).filter((entry) => entry.platform);
}

/** The URL a compiled strategy should open for a database.
 *
 *  When R4L discovery has run and that database was found, the direct publisher
 *  URL is rewritten through the operator's proxy session — otherwise the search
 *  would land on a paywall while a perfectly good entitlement sat unused. */
export function resolveAccessUrl(source, directUrl, catalog = loadR4lCatalog()) {
  if (!catalog?.prefix) return { url: directUrl, route: "direct" };
  // Match on PLATFORM where the caller supplies one: a database detected behind
  // the proxy has no legacy identifier, and matching only on that sent it to the
  // publisher's direct URL — guaranteed paywall while an entitlement sat unused.
  const databaseId = typeof source === "object" ? source?.id : source;
  const platform = typeof source === "object" ? source?.platform : null;
  const name = typeof source === "object" ? source?.name : null;
  const entry = (catalog.databases || []).find((item) =>
    (databaseId && item.canonicalId === databaseId)
    || (platform && item.platform === platform && (!name || String(item.name || "").toLowerCase() === String(name).toLowerCase()))
    || (platform && item.platform === platform));
  if (entry) {
    const deep = buildProxyUrl(catalog.prefix, entry.searchPath || directUrl);
    return deep
      ? { url: deep, route: "research4life", via: R4L_PROXY_HOST }
      : { url: entry.url || directUrl, route: "research4life", via: R4L_PROXY_HOST };
  }

  // Not in the catalogue, but an R4L session exists. When the operator reached a
  // publisher THROUGH the proxy, their cookie is on login.research4life.org and
  // the publisher's own domain has no session — so the direct URL is guaranteed
  // to show a wall. Proxying a database we know the syntax for is the route that
  // can actually work; an unentitled one fails loudly at R4L rather than silently.
  const known = PLATFORM_MATCHERS.find((matcher) => matcher.id === databaseId)
    || (platform && PLATFORM_HOSTS.find((entryHost) => entryHost.platform === platform));
  const proxied = known && buildProxyUrl(catalog.prefix, known.searchPath || directUrl);
  return proxied
    ? { url: proxied, route: "research4life", via: R4L_PROXY_HOST, unlisted: true }
    : { url: directUrl, route: "direct" };
}
