// media.js — Media connectors + ingest + domain aggregation.
//
// GDELT DOC 2.0 is loaded only after the user explicitly requests it. A failed or
// throttled live call remains unavailable; synthetic fallback items are never
// presented as findings.
//
// Every item becomes a MediaSignal scored by the in-browser lexicon (always) and,
// when method="ai" and a provider is enabled, additionally by the model. Both scores
// are retained so the AI↔lexicon divergence view can surface where they disagree.

import { analyzeSentiment, classifyDomain, THREAT_DOMAINS } from "./sentiment.js";
import { aiSentiment, activeProvider } from "./providers.js";

const GDELT_QUERIES = {
  health: "(outbreak OR epidemic OR pandemic OR cholera OR measles OR vaccine) sourcelang:english",
  defence: "(conflict OR airstrike OR offensive OR ceasefire OR insurgency) sourcelang:english",
  climate: "(drought OR flooding OR wildfire OR cyclone OR heatwave) sourcelang:english",
  energy: "(blackout OR pipeline OR fuel shortage OR power grid OR refinery) sourcelang:english",
  economy: "(inflation OR recession OR sanctions OR currency crisis OR debt default) sourcelang:english",
  cyber: "(cyberattack OR ransomware OR data breach OR hacked) sourcelang:english",
  food: "(famine OR malnutrition OR food shortage OR harvest failure) sourcelang:english",
  migration: "(refugees OR displacement OR asylum OR border crossing) sourcelang:english",
};

const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_SPACING_MS = 5200; // stay just outside GDELT's ~1/5s throttle

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch a domain's latest articles. Returns { items, code } — code is the HTTP
// status (429 = throttled, 0 = network/CORS/offline) so the caller can decide.
export async function fetchGDELT(slug, maxRecords = 8) {
  const query = GDELT_QUERIES[slug];
  if (!query) return { items: [], code: 0 };
  const url =
    `${GDELT_BASE}?query=${encodeURIComponent(query)}` +
    `&mode=artlist&maxrecords=${maxRecords}&sort=datedesc&format=json`;
  try {
    const res = await fetch(url);
    if (res.status === 429) return { items: [], code: 429 };
    if (!res.ok) return { items: [], code: res.status };
    const data = await res.json();
    const items = (data.articles || []).map((a) => ({
      headline: a.title,
      outlet: a.domain,
      country: a.sourcecountry,
      url: a.url,
      lang: a.language || "English",
      publishedAt: formatSeen(a.seendate),
      _domainHint: slug,
    }));
    return { items, code: 200 };
  } catch {
    return { items: [], code: 0 }; // CORS / offline
  }
}

function formatSeen(seen) {
  if (!seen || seen.length < 8) return "";
  return `${seen.slice(0, 4)}-${seen.slice(4, 6)}-${seen.slice(6, 8)}`;
}

// --- Source (outlet) resolution -----------------------------------------
function outletSource(store, outletName) {
  if (!outletName) return null;
  const existing = store.all("Source").find((s) => s.name === outletName);
  if (existing) return existing;
  return store.create(
    "Source",
    { name: outletName, sourceType: "News Outlet", bias: 0.15, credibility: 0.7, trust: "trusted" },
    { origin: "feed:media", transform: "outlet-resolve", confidence: 0.7 }
  );
}

function regionFromCountry(store, country) {
  if (!country) return null;
  return store.all("Region").find((r) => (r.name || "").includes(country)) || null;
}

function linkSignal(store, signal, domainSlug, item) {
  const domain = store.all("ThreatDomain").find((d) => d.slug === domainSlug);
  if (domain) store.link(signal.id, "signalInDomain", domain.id);
  const src = outletSource(store, item.outlet);
  if (src) store.link(signal.id, "signalFromSource", src.id);
  const region = regionFromCountry(store, item.country);
  if (region) store.link(signal.id, "signalMentions", region.id);
}

// Ingest one item. Lexicon always runs; AI runs additionally when requested and a
// provider is ready. Both scores are stored; `sentiment` (primary) prefers AI.
export async function ingestSignal(store, item, { method = "lexicon" } = {}) {
  const text = `${item.headline}. ${item.snippet || ""}`.trim();
  const lex = analyzeSentiment(text);
  const cls = classifyDomain(text);

  let domainSlug = item._domainHint || cls.domain;
  let aiScore = null;
  let usedMethod = "lexicon";

  if (method === "ai" && activeProvider()) {
    const ai = await aiSentiment(text);
    if (ai) {
      aiScore = ai.compound;
      usedMethod = ai.method;
      if (ai.domain && THREAT_DOMAINS.some((d) => d.slug === ai.domain)) domainSlug = ai.domain;
    }
  }

  const primary = aiScore != null ? aiScore : lex.compound;
  const divergence = aiScore != null ? Number(Math.abs(aiScore - lex.compound).toFixed(3)) : 0;

  const signal = store.create(
    "MediaSignal",
    {
      headline: item.headline,
      snippet: item.snippet || "",
      outlet: item.outlet || "",
      url: item.url || "",
      lang: item.lang || "en",
      country: item.country || "",
      publishedAt: item.publishedAt || "",
      sentiment: Number(primary.toFixed(3)),
      lexSentiment: lex.compound,
      aiSentiment: aiScore != null ? Number(aiScore.toFixed(3)) : undefined,
      divergence,
      intensity: lex.intensity,
      method: usedMethod,
    },
      { origin: item.url ? "feed:gdelt" : "feed:user", transform: usedMethod, confidence: 0.8 }
  );

  linkSignal(store, signal, domainSlug, item);
  return signal;
}

// Recompute a domain's aggregate sentiment index from its linked signals.
export function recomputeDomainIndex(store, domainId) {
  const domain = store.get(domainId);
  if (!domain) return null;
  const signals = store.linkedInverse(domainId, "signalInDomain");
  const n = signals.length;
  const mean = n ? signals.reduce((a, s) => a + (s.sentiment || 0), 0) / n : 0;
  const index = Math.round(mean * 100);
  const threatLevel = index <= -50 ? "critical" : index <= -20 ? "elevated" : index < 5 ? "watch" : "stable";
  store.set(
    domainId,
    { prevIndex: domain.sentimentIndex ?? 0, sentimentIndex: index, signalCount: n, threatLevel },
    { origin: "action:recomputeDomainIndex", transform: "mean-sentiment", confidence: 1 }
  );
  return { index, n, threatLevel };
}

export function recomputeAllDomains(store) {
  for (const d of store.all("ThreatDomain")) recomputeDomainIndex(store, d.id);
}

// Pull a batch of media across domains and ingest. Sequential + throttled to respect
// GDELT's rate limit; each domain streams into the store as it lands (onProgress).
// Any domain GDELT cannot serve remains empty and is reported as unavailable.
export async function pullMedia(store, { useLive = true, method = "lexicon", perDomain = 6, onProgress } = {}) {
  let live = 0;
  let unavailable = 0;
  let throttled = 0;
  const total = THREAT_DOMAINS.length;

  for (let i = 0; i < total; i++) {
    const d = THREAT_DOMAINS[i];
    let items = [];
    let via = "unavailable";

    if (useLive) {
      let res = await fetchGDELT(d.slug, perDomain);
      if (res.code === 429) {
        throttled++;
        onProgress?.({ index: i, total, domain: d.slug, phase: "backoff" });
        await sleep(GDELT_SPACING_MS);
        res = await fetchGDELT(d.slug, perDomain); // single backoff retry
      }
      if (res.items.length) {
        items = res.items;
        via = "gdelt";
        live += items.length;
      }
    }

    if (!items.length) {
      unavailable++;
    }

    for (const it of items) await ingestSignal(store, { ...it, _domainHint: d.slug }, { method });

    // aggregate + surface this domain immediately so the board fills in live
    recomputeDomainIndex(store, store.all("ThreatDomain").find((x) => x.slug === d.slug)?.id);
    onProgress?.({ index: i + 1, total, domain: d.slug, via, count: items.length, phase: "done" });

    // throttle before the next live call (skip after the final domain)
    if (useLive && via === "gdelt" && i < total - 1) await sleep(GDELT_SPACING_MS);
  }

  deriveClaims(store); // fresh live signals → source-attributed media claims for the engines
  store.persist();
  return { live, fallback: 0, unavailable, throttled, source: live ? "gdelt" : "unavailable" };
}

// Derive source-attributed claims from the most alarming live media signals. Each becomes a
// Claim citing its outlet as a Source, with an evidence stream from the signal's
// sentiment, classified into its threat domain — so the decision & causal engines
// act on genuine events, not demo scenarios.
export function deriveClaims(store, { max = 12 } = {}) {
  const existing = new Set(store.all("Claim").map((c) => c.statement));
  const signals = store
    .all("MediaSignal")
    .filter((s) => (s.sentiment ?? 0) < -0.1 && !existing.has(s.headline)) // alarming + not already a claim
    .sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0))
    .slice(0, max);

  const categories = store.all("ResearchCategory");
  const regionCache = new Map();
  const regionOf = (name) => {
    if (!name) return null;
    if (!regionCache.has(name)) regionCache.set(name, store.create("Region", { name }, { origin: "feed:media", transform: "derive" }));
    return regionCache.get(name);
  };

  signals.forEach((sig, i) => {
    const claim = store.create(
      "Claim",
      { statement: sig.headline, author: sig.outlet, date: sig.publishedAt, category: "media-derived", status: "unverified" },
      { origin: "derive:media", transform: "signal→claim", confidence: 0.7 }
    );
    // cite the outlet source that already backs this signal
    const src = store.linked(sig.id, "signalFromSource")[0];
    if (src) store.link(claim.id, "cites", src.id);
    // evidence stream from the signal's own sentiment/intensity
    const vec = store.create(
      "EvidenceVector",
      { name: "Media sentiment signal", score: Math.round(((1 - (sig.sentiment ?? 0)) / 2) * 100), status: sig.method, detail: sig.snippet || sig.headline },
      { origin: "derive:media" }
    );
    store.link(claim.id, "hasEvidence", vec.id);
    // domain + region + portfolio links
    const dom = store.linked(sig.id, "signalInDomain")[0];
    if (dom) store.link(claim.id, "domainOfClaim", dom.id);
    const region = regionOf(sig.country);
    if (region) store.link(claim.id, "locatedIn", region.id);
    const cat = categories[i % (categories.length || 1)];
    if (cat) store.link(claim.id, "fundedBy", cat.id);
  });
  return signals.length;
}
