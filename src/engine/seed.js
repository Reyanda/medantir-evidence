// seed.js — Schema/reference scaffolding only. No findings, claims, media, budgets,
// projects, analyses, or user inputs are created on first boot.

import { THREAT_DOMAINS } from "./sentiment.js";

export function seed(store) {
  const prov = (feed) => ({ origin: `feed:${feed}`, transform: "ingest", confidence: 1 });

  // -- threat domains (Health, Defence, Climate, Energy, …) ---------------
  for (const d of THREAT_DOMAINS) {
    store.create(
      "ThreatDomain",
      { name: d.name, slug: d.slug, sentimentIndex: 0, prevIndex: 0, signalCount: 0, threatLevel: "stable" },
      prov("threatDomains")
    );
  }
  return store;
}
