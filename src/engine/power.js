// power.js — Ingest the MapIt power network into the ontology.
//
// Flattened MapIt export (src/data/powerNetwork.json: 366 nodes, 255 ownership
// edges) → typed PowerNode objects + `owns` links. Influence is computed as the
// stake-weighted in-degree (how much of a node is held by others in the graph),
// turning MapIt's flat file into a queryable, rankable ontology layer.

import powerNet from "../data/powerNetwork.json";

const REFERENCE_NODE_SIGNATURES = new Set(
  powerNet.nodes.map((node) => `${node.name}\u0000${node.type}\u0000${node.country || ""}`)
);

export function isReferencePowerNode(node) {
  return REFERENCE_NODE_SIGNATURES.has(`${node?.name || ""}\u0000${node?.entityType || ""}\u0000${node?.country || ""}`);
}

export function ingestPower(store) {
  if (store.all("PowerNode").length) return; // already ingested
  const byId = new Map();

  for (const n of powerNet.nodes) {
    const node = store.create(
      "PowerNode",
      {
        name: n.name,
        entityType: n.type,
        country: n.country,
        hq: n.hq,
        ceo: n.ceo,
        founder: n.founder,
        marketCap: n.marketCap || 0,
        domain: n.domain,
        influence: 0,
      },
      { origin: "feed:mapit", transform: "ingest", confidence: 1 },
      );
    byId.set(n.id, node.id);
  }

  // ownership edges + accumulate influence on the owner (holder gains influence)
  const influence = {};
  for (const e of powerNet.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    store.link(from, "owns", to, { origin: "feed:mapit", weight: e.weight });
    influence[from] = (influence[from] || 0) + (e.weight || 0);
  }
  for (const [id, w] of Object.entries(influence)) {
    store.set(id, { influence: Number(w.toFixed(1)) }, { origin: "feed:mapit", transform: "influence-degree" });
  }
}

export function powerMeta() {
  return powerNet.meta;
}
