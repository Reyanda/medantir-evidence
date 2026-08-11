// index.js — Engine bootstrap + singleton + React binding.
//
// One engine per browser session. First boot creates schema/reference scaffolding
// only. Data, signals, findings, claims, and analyses appear after an explicit user
// action; existing project work remains in the project store.

import { useSyncExternalStore } from "react";
import { OntologyStore } from "./store.js";
import { seed } from "./seed.js";
import { execute } from "./actions.js";
import { recommendForTarget, recommendGlobal } from "./decision.js";
import { pullMedia, recomputeAllDomains } from "./media.js";
import { ingestPower, isReferencePowerNode } from "./power.js";
import { MEDIA_CORPUS } from "../data/mediaCorpus.js";
import { PACT_CATEGORIES } from "../data/mockPactData.js";

const CLEAN_START_MIGRATION = "medantir.clean-start.v1";

const PACT_SIGNATURES = new Set(
  PACT_CATEGORIES.map((item) => `${item.name}\u0000${item.shortName}\u0000${item.fundingShare}\u0000${item.budget}`)
);

function isLegacyResearchCategory(item) {
  const signature = `${item.name || ""}\u0000${item.shortName || ""}\u0000${item.fundingShare ?? ""}\u0000${item.budget ?? ""}`;
  return PACT_SIGNATURES.has(signature);
}

function genesis(store) {
  seed(store);
  store.persist();
}

function cleanLegacyPreloads(store) {
  try { if (localStorage.getItem(CLEAN_START_MIGRATION)) return; } catch { /* continue in memory */ }
  const headlines = new Set(MEDIA_CORPUS.map((item) => item.headline));
  const roots = new Set([
    ...store.all("MediaSignal").filter((item) => headlines.has(item.headline) && !item.url).map((item) => item.id),
    ...store.all("Claim").filter((item) => headlines.has(item.statement)).map((item) => item.id),
    ...store.all("PowerNode").filter(isReferencePowerNode).map((item) => item.id),
    ...store.all("ResearchCategory").filter(isLegacyResearchCategory).map((item) => item.id),
  ]);
  const candidates = new Set(store.links.filter((link) => roots.has(link.from)).map((link) => link.to));
  for (const id of candidates) {
    const object = store.get(id);
    if (!["EvidenceVector", "Source", "Region"].includes(object?.kind)) continue;
    const shared = store.links.some((link) => (link.from === id || link.to === id) && !roots.has(link.from) && !roots.has(link.to));
    if (!shared) roots.add(id);
  }
  store.removeMany(roots);
  store.audit = store.audit.filter((entry) => entry.actor !== "genesis");
  for (const domain of store.all("ThreatDomain")) {
    store.set(domain.id, { sentimentIndex: 0, prevIndex: 0, signalCount: 0, threatLevel: "stable" }, { origin: "migration:clean-start", transform: "reset-preload" });
  }
  store.persist();
  try { localStorage.setItem(CLEAN_START_MIGRATION, String(Date.now())); } catch { /* storage optional */ }
}

function boot() {
  const store = new OntologyStore();
  const restored = store.restore();
  if (!restored) genesis(store);
  cleanLegacyPreloads(store);
  return store;
}

export const engine = boot();

// Convenience API surface used by the UI.
export const api = {
  store: engine,
  execute: (actionId, targetId, params, actor) => execute(engine, actionId, targetId, params, actor),
  recommendForTarget: (targetId) => recommendForTarget(engine, targetId),
  recommendGlobal: (opts) => recommendGlobal(engine, opts),
  // Pull fresh live media from GDELT and re-aggregate domain sentiment.
  pullMedia: (opts) => pullMedia(engine, opts),
  loadPower: () => {
    if (!engine.all("PowerNode").length) ingestPower(engine);
    engine.persist();
    return engine.all("PowerNode").length;
  },
  recomputeDomains: () => {
    recomputeAllDomains(engine);
    engine.persist();
  },
  reseed: () => {
    engine.reset();
    genesis(engine);
  },
};

// --- React binding -------------------------------------------------------
// A single external-store subscription. Any component calling useEngine() re-renders
// on any ontology mutation, keeping the UI a pure projection of engine state.
let _version = 0;
engine.subscribe(() => {
  _version += 1;
});

function subscribe(cb) {
  return engine.subscribe(cb);
}
function getSnapshot() {
  return _version;
}

export function useEngine() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return api;
}
