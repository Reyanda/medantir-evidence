// ontology.js — The semantic layer.
//
// Everything the engine reasons over is a typed object with declared properties
// and typed links to other objects. This is the single most important file in the
// system: it is the difference between "a pile of data an LLM greps" and "a model
// an engine reasons over". Prose describes concepts; this file *makes them real*.

// ---------------------------------------------------------------------------
// Object types. Each carries a stable `key`, an icon hint, a colour token used by
// the UI, the property schema, and the link types it can participate in.
// ---------------------------------------------------------------------------

export const OBJECT_TYPES = {
  Claim: {
    key: "Claim",
    label: "Claim",
    plural: "Claims",
    icon: "GitMerge",
    color: "#3b82f6",
    title: (o) => o.statement,
    props: {
      statement: { type: "text", required: true },
      author: { type: "string" },
      date: { type: "string" },
      category: { type: "string" },
      status: { type: "enum", values: ["unverified", "verified", "refuted", "escalated"], default: "unverified" },
      // confidence is engine-owned: it is DERIVED by the verifyClaim action from
      // evidence + source credibility. It is never authored directly.
      confidence: { type: "number", derived: true, range: [0, 100] },
    },
  },

  Source: {
    key: "Source",
    label: "Source",
    plural: "Sources",
    icon: "Database",
    color: "#8b5cf6",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      sourceType: { type: "string" },
      // bias ∈ [0,1] (0 = neutral), credibility ∈ [0,1]. These drive evidence weight.
      bias: { type: "number", range: [0, 1] },
      credibility: { type: "number", range: [0, 1] },
      trust: { type: "enum", values: ["trusted", "watch", "quarantined"], default: "trusted" },
    },
  },

  EvidenceVector: {
    key: "EvidenceVector",
    label: "Evidence Stream",
    plural: "Evidence Streams",
    icon: "Activity",
    color: "#10b981",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      score: { type: "number", range: [0, 100] },
      status: { type: "string" },
      detail: { type: "text" },
    },
  },

  Pathogen: {
    key: "Pathogen",
    label: "Pathogen",
    plural: "Pathogens",
    icon: "Bug",
    color: "#ef4444",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      confirmed: { type: "boolean", default: false },
    },
  },

  Region: {
    key: "Region",
    label: "Region",
    plural: "Regions",
    icon: "MapPin",
    color: "#f59e0b",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      threatLevel: { type: "enum", values: ["green", "yellow", "orange", "red"], default: "green" },
    },
  },

  Actor: {
    key: "Actor",
    label: "Actor",
    plural: "Actors",
    icon: "Users",
    color: "#06b6d4",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      actorType: { type: "string" },
      healthState: { type: "string" },
      capitalFlow: { type: "number", range: [0, 100] },
      powerIndex: { type: "number", range: [0, 100] },
      trustLevel: { type: "number", range: [0, 100] },
    },
  },

  System: {
    key: "System",
    label: "Data System",
    plural: "Data Systems",
    icon: "Server",
    color: "#64748b",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      systemType: { type: "string" },
      status: { type: "enum", values: ["Connected", "Offline", "Degraded"], default: "Connected" },
      protocol: { type: "string" },
      latency: { type: "string" },
      host: { type: "string" },
    },
  },

  ResearchCategory: {
    key: "ResearchCategory",
    label: "Research Category",
    plural: "Research Portfolio",
    icon: "BarChart3",
    color: "#a855f7",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      shortName: { type: "string" },
      fundingShare: { type: "number" },
      budget: { type: "number" },
      allocated: { type: "number", default: 0, derived: true },
    },
  },

  Alert: {
    key: "Alert",
    label: "Alert",
    plural: "Alerts",
    icon: "Siren",
    color: "#f43f5e",
    title: (o) => o.headline,
    props: {
      headline: { type: "string", required: true },
      severity: { type: "enum", values: ["info", "elevated", "critical"], default: "info" },
      raisedBy: { type: "string" },
      open: { type: "boolean", default: true },
    },
  },

  // A global-security threat domain (Health, Defence, Climate, …). Its sentiment
  // index and signal volume are DERIVED by aggregating linked MediaSignals — never
  // authored directly. This is the object the "media mood" of the world rolls up into.
  ThreatDomain: {
    key: "ThreatDomain",
    label: "Threat Domain",
    plural: "Threat Domains",
    icon: "ShieldAlert",
    color: "#f97316",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      slug: { type: "string" },
      // sentimentIndex ∈ [-100, 100]: aggregate media tone. Negative = alarm/deterioration.
      sentimentIndex: { type: "number", derived: true, range: [-100, 100] },
      prevIndex: { type: "number", derived: true, range: [-100, 100] },
      signalCount: { type: "number", derived: true, default: 0 },
      threatLevel: { type: "enum", values: ["stable", "watch", "elevated", "critical"], default: "stable", derived: true },
    },
  },

  // A node in the global power network (merged from MapIt): a corporation, fund,
  // family, state, or institution, with ownership edges to others. Turns the flat
  // MapIt database into a queryable ontology graph the engine can reason over.
  PowerNode: {
    key: "PowerNode",
    label: "Power Node",
    plural: "Power Network",
    icon: "Network",
    color: "#eab308",
    title: (o) => o.name,
    props: {
      name: { type: "string", required: true },
      entityType: { type: "string" },
      country: { type: "string" },
      hq: { type: "string" },
      ceo: { type: "string" },
      founder: { type: "string" },
      marketCap: { type: "number" }, // $B
      domain: { type: "string" },
      influence: { type: "number", derived: true }, // weighted in-degree of ownership
    },
  },

  // One piece of media (a news article / report) tagged to a threat domain, with
  // per-item sentiment computed by the analyzer. The raw sensory input of the engine.
  MediaSignal: {
    key: "MediaSignal",
    label: "Media Signal",
    plural: "Media Signals",
    icon: "Newspaper",
    color: "#0ea5e9",
    title: (o) => o.headline,
    props: {
      headline: { type: "string", required: true },
      snippet: { type: "text" },
      outlet: { type: "string" },
      url: { type: "string" },
      lang: { type: "string", default: "en" },
      country: { type: "string" },
      publishedAt: { type: "string" },
      // sentiment ∈ [-1, 1] compound (primary, prefers AI when present); intensity ∈ [0,1];
      // lexSentiment / aiSentiment retained separately so the two analysts can be compared.
      sentiment: { type: "number", derived: true, range: [-1, 1] },
      lexSentiment: { type: "number", derived: true, range: [-1, 1] },
      aiSentiment: { type: "number", derived: true, range: [-1, 1] },
      divergence: { type: "number", derived: true, range: [0, 2] },
      intensity: { type: "number", derived: true, range: [0, 1] },
      method: { type: "string", derived: true },
    },
  },
};

// ---------------------------------------------------------------------------
// Link types. Directed, typed edges between object types. A real ontology's power
// is in the links: it is how the decision engine walks from a Claim to the Sources
// that support it and the Region it threatens.
// ---------------------------------------------------------------------------

export const LINK_TYPES = {
  cites:        { from: "Claim",  to: "Source",         inverse: "citedBy",     label: "cites" },
  hasEvidence:  { from: "Claim",  to: "EvidenceVector", inverse: "evidenceFor", label: "has evidence" },
  about:        { from: "Claim",  to: "Pathogen",       inverse: "subjectOf",   label: "about pathogen" },
  locatedIn:    { from: "Claim",  to: "Region",         inverse: "hasClaims",   label: "located in" },
  operatesIn:   { from: "Actor",  to: "Region",         inverse: "hasActors",   label: "operates in" },
  raisedFor:    { from: "Alert",  to: "Claim",          inverse: "alerts",      label: "raised for" },
  threatens:    { from: "Alert",  to: "Region",         inverse: "threatenedBy",label: "threatens" },
  fundedBy:     { from: "Claim",  to: "ResearchCategory", inverse: "funds",     label: "funded by" },
  signalInDomain:   { from: "MediaSignal", to: "ThreatDomain", inverse: "hasSignals",   label: "in domain" },
  signalFromSource: { from: "MediaSignal", to: "Source",       inverse: "publishedSignals", label: "published by" },
  signalMentions:   { from: "MediaSignal", to: "Region",       inverse: "mentionedBy",  label: "mentions region" },
  domainOfClaim:    { from: "Claim",       to: "ThreatDomain", inverse: "domainClaims", label: "threat domain" },
  owns:             { from: "PowerNode",   to: "PowerNode",    inverse: "ownedBy",     label: "owns stake in" },
};

export const OBJECT_TYPE_LIST = Object.values(OBJECT_TYPES);

export function typeOf(kind) {
  return OBJECT_TYPES[kind] || null;
}

export function titleFor(obj) {
  const t = OBJECT_TYPES[obj?.kind];
  if (!t) return obj?.id || "unknown";
  try {
    return t.title(obj) || obj.id;
  } catch {
    return obj.id;
  }
}
