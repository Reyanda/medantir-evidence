// accessPoints.js — sign in to a GATEWAY, get its databases.
//
// The unit an operator authenticates against is an access point (Ovid,
// EBSCOhost, Research4Life, Elsevier, Clarivate), not a database. One login
// typically opens many databases, and which ones depends on the subscription —
// so they are DISCOVERED from the gateway after sign-in rather than listed here.
//
// Each access point declares the platform it lands on, which is what makes a
// discovered database compilable: the platform decides syntax, the database name
// decides controlled vocabulary. Research4Life is the exception that proves the
// rule — it is a proxy that fronts SEVERAL platforms, so its entries carry their
// own platform recovered from the proxied host.

import { targetFor } from "./searchStrategy.js";

const CATALOG_KEY = "medantir.gateways.v1";
const SELECTION_KEY = "medantir.gateways.selected.v1";

export const ACCESS_POINTS = [
  {
    id: "research4life", name: "Research4Life / Hinari", platform: null, multiPlatform: true,
    loginUrl: "https://login.research4life.org/tacsgr1portal_research4life_org/content/databases",
    discoverUrl: "https://login.research4life.org/tacsgr1portal_research4life_org/content/databases",
    note: "Proxy fronting Ovid, EBSCOhost, Embase.com and publisher collections",
  },
  {
    id: "ovid", name: "Ovid", platform: "ovid",
    loginUrl: "https://ovidsp.ovid.com", discoverUrl: "https://ovidsp.ovid.com",
    note: "MEDLINE, Embase, PsycINFO, Global Health, AMED, HMIC…",
  },
  {
    id: "ebscohost", name: "EBSCOhost", platform: "ebscohost",
    loginUrl: "https://search.ebscohost.com", discoverUrl: "https://search.ebscohost.com/Community.aspx",
    note: "CINAHL, MEDLINE, PsycINFO, Academic Search…",
  },
  {
    id: "elsevier", name: "Elsevier", platform: "scopus",
    loginUrl: "https://www.scopus.com", discoverUrl: "https://www.scopus.com/search/form.uri",
    note: "Scopus and Embase.com",
  },
  {
    id: "clarivate", name: "Clarivate", platform: "wos",
    loginUrl: "https://www.webofscience.com", discoverUrl: "https://www.webofscience.com/wos/woscc/advanced-search",
    note: "Web of Science Core Collection",
  },
  {
    id: "cochrane", name: "Cochrane Library", platform: "cochrane",
    loginUrl: "https://www.cochranelibrary.com", discoverUrl: "https://www.cochranelibrary.com/advanced-search/search-manager",
    note: "CENTRAL and Cochrane Reviews",
  },
  {
    id: "pubmed", name: "PubMed", platform: "pubmed", open: true,
    loginUrl: "https://pubmed.ncbi.nlm.nih.gov", discoverUrl: "https://pubmed.ncbi.nlm.nih.gov",
    note: "Open — no sign-in required",
  },
];

export const accessPoint = (id) => ACCESS_POINTS.find((entry) => entry.id === id) || null;

// --- catalogue --------------------------------------------------------------

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  return value;
}

export const loadGatewayCatalog = () => readJson(CATALOG_KEY, {});
export const saveGatewayCatalog = (catalog) => writeJson(CATALOG_KEY, catalog);

/** Turn whatever a gateway's picker exposed — links AND labelled checkboxes,
 *  since Ovid and EBSCOhost use the latter — into compile targets. */
// A database picker is full of controls that look like options: "Select All",
// "Clear Selections", "Continue", sort orders, page sizes. Admitting them turns
// the checklist into noise, so they are matched as phrases rather than as single
// words — "Select All" is two words and slipped straight through a word list.
const PICKER_CONTROLS = [
  /^(select|clear|deselect|check|uncheck)\b/i,
  /^(all|none|search|help|home|continue|submit|cancel|reset|back|next|previous|close|save|apply|go)$/i,
  /^(log ?out|sign ?out|log ?in|sign ?in|my account)\b/i,
  /^(sort|display|show|results? per page|page \d+)\b/i,
  /^\d+$/,
];
const isPickerControl = (label) => PICKER_CONTROLS.some((pattern) => pattern.test(label));

export function databasesFromDiscovery({ gatewayId, links = [], options = [] }) {
  const gateway = accessPoint(gatewayId);
  if (!gateway?.platform) return [];
  const seen = new Map();
  const names = [
    ...options.map((option) => option.text),
    ...links.map((link) => link.text),
  ];

  for (const raw of names) {
    const name = String(raw || "").replace(/\s+/g, " ").trim();
    // Picker labels carry counts and date ranges; the database name is the head.
    const clean = name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+\d{4}\s+to\s+.*$/i, "").trim();
    if (clean.length < 3 || clean.length > 120) continue;
    if (isPickerControl(clean)) continue;

    const target = targetFor({ platform: gateway.platform, database: clean });
    if (!target) continue;
    const key = `${gateway.platform}::${clean.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      id: key,
      name: clean,
      gateway: gateway.id,
      platform: gateway.platform,
      platformName: target.platformName,
      vocabulary: target.vocabulary,
      freeTextOnly: !target.vocabulary,
      legacyId: target.id,
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** Record what a gateway exposed. Kept per gateway so one failing discovery
 *  never wipes another gateway's catalogue. */
export function recordGatewayDatabases(gatewayId, databases, meta = {}) {
  const catalog = loadGatewayCatalog();
  catalog[gatewayId] = { databases, detectedAt: new Date().toISOString(), ...meta };
  return saveGatewayCatalog(catalog);
}

export function gatewayDatabases(gatewayId) {
  return loadGatewayCatalog()[gatewayId]?.databases || [];
}

/** Every database known across every gateway, ready for the checklist. */
export function allKnownDatabases() {
  const catalog = loadGatewayCatalog();
  return Object.entries(catalog).flatMap(([gatewayId, entry]) =>
    (entry.databases || []).map((database) => ({ ...database, gateway: database.gateway || gatewayId })));
}

// --- selection --------------------------------------------------------------
// Which databases the operator wants searched. This replaces preselecting a
// hardcoded provider list: the strategy is compiled for exactly what is ticked.

export const loadSelection = () => readJson(SELECTION_KEY, []);
export const saveSelection = (ids) => writeJson(SELECTION_KEY, [...new Set(ids)]);

export function toggleSelection(id) {
  const current = loadSelection();
  return saveSelection(current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
}

/** Compile targets for the ticked databases, in the shape buildStrategy accepts. */
export function selectedTargets() {
  const selected = new Set(loadSelection());
  return allKnownDatabases()
    .filter((database) => selected.has(database.id))
    .map((database) => ({ platform: database.platform, database: database.name, gateway: database.gateway }));
}

/** Discover a gateway's databases from the operator's live session.
 *
 *  Research4Life is delegated to its own module: it is a proxy fronting several
 *  platforms, so its entries carry a platform recovered per-link rather than the
 *  single platform a direct gateway lands on. */
export async function discoverGateway(gatewayId, { url, linksFn } = {}) {
  const gateway = accessPoint(gatewayId);
  if (!gateway) return { ok: false, error: `Unknown access point '${gatewayId}'.` };

  if (gateway.multiPlatform) {
    const { discoverR4lDatabases } = await import("./research4life.js");
    const result = await discoverR4lDatabases({ portalUrl: url, linksFn });
    if (result.ok) {
      recordGatewayDatabases(gatewayId, (result.databases || []).filter((entry) => entry.platform).map((entry) => ({
        id: `${entry.platform}::${entry.name.toLowerCase()}`,
        name: entry.name,
        gateway: gatewayId,
        platform: entry.platform,
        platformName: entry.platformName,
        vocabulary: entry.vocabulary,
        freeTextOnly: entry.freeTextOnly,
        legacyId: entry.canonicalId || null,
      })), { prefix: result.prefix, landedUrl: result.landedUrl });
    }
    return result;
  }

  const fetchLinks = linksFn || (await import("./browserBridge.js")).databaseLinks;
  const result = await fetchLinks({ url: url || gateway.discoverUrl });
  if (!result?.ok) return { ok: false, error: result?.error || "Discovery could not reach this gateway." };
  if (result.needsAuth || result.signInGate) {
    return { ok: false, needsAuth: true, error: result.warnings?.[0] || `Not signed in to ${gateway.name}. Sign in, then detect again.` };
  }

  const databases = databasesFromDiscovery({ gatewayId, links: result.links, options: result.options });
  if (!databases.length) {
    return { ok: false, landedUrl: result.url, error: `Signed in to ${gateway.name}, but no database list was on that page. Open its database selector, then detect again.` };
  }
  recordGatewayDatabases(gatewayId, databases, { landedUrl: result.url });
  return { ok: true, gateway: gatewayId, databases, counts: { total: databases.length, executable: databases.length } };
}
