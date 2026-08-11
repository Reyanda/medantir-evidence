// dedup.js — reversible, auditable deduplication for the Evidence Review Engine.
//
// Groups records into study clusters by exact identifiers (DOI → PMID → PMCID →
// trial-registration id), then fuzzy title+year for the remainder. It keeps ONE
// primary per cluster and FLAGS the rest as duplicates without deleting them, so
// every merge is reversible and every decision is auditable (each cluster records
// its method, primary, and members). Related reports of the same study are linked
// via a shared cluster, not silently discarded.

// Trial-registry identifiers across the major registries (ICTRP members).
const TRIAL_RE = /\b(NCT\d{8}|ISRCTN\d{8}|ACTRN\d{14}|EUCTR\d{4}-\d{6}-\d{2}|PACTR\d{12,}|ChiCTR[-\w]+|DRKS\d{8}|JPRN-[A-Za-z]+\d+)\b/i;

export function normTitle(t) {
  return (t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function trialId(r) {
  const m = `${r.title || ""} ${r.abstract || ""}`.match(TRIAL_RE);
  return m ? m[1].toUpperCase() : null;
}
// Character-level similarity (Levenshtein ratio) on normalised titles — robust to
// spelling variants (diarrhoea/diarrhea), punctuation, and minor edits that token
// overlap misses. Returns 1.0 for identical, →0 as strings diverge.
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}
function titleSim(a, b) {
  const s = normTitle(a), t = normTitle(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const max = Math.max(s.length, t.length);
  return 1 - levenshtein(s, t) / max;
}

// Exact-key signature, in priority order — the strongest available identifier wins.
export function exactKey(r) {
  if (r.doi) return `doi:${String(r.doi).toLowerCase()}`;
  if (r.pmid) return `pmid:${r.pmid}`;
  if (r.pmcid) return `pmcid:${r.pmcid}`;
  const tid = trialId(r);
  return tid ? `trial:${tid}` : null;
}

// Cluster records and annotate duplicates reversibly. Idempotent: re-running
// recomputes clusters from scratch (prior flags are ignored, not compounded).
export function deduplicate(records, { fuzzy = 0.9 } = {}) {
  const recs = (records || []).map((r, i) => ({ r, i }));
  const clusters = [];
  const byExact = new Map();
  const remaining = [];

  // pass 1 — exact identifier clustering
  for (const rec of recs) {
    const k = exactKey(rec.r);
    if (k) {
      if (!byExact.has(k)) { const c = { key: k, method: k.split(":")[0], members: [] }; byExact.set(k, c); clusters.push(c); }
      byExact.get(k).members.push(rec);
    } else remaining.push(rec);
  }

  // pass 2 — fuzzy title+year for records lacking any exact identifier
  for (const rec of remaining) {
    let best = null, bestScore = fuzzy;
    for (const c of clusters) {
      const p = c.members[0].r;
      if (p.year && rec.r.year && Math.abs(p.year - rec.r.year) > 1) continue;
      const s = titleSim(rec.r.title, p.title);
      if (s >= bestScore) { best = c; bestScore = s; }
    }
    if (best) best.members.push(rec);
    else clusters.push({ key: `title:${normTitle(rec.r.title).slice(0, 60)}`, method: "fuzzy-title", members: [rec] });
  }

  // annotate: first member = primary; the rest flagged dupOf (index in this array)
  const out = recs.map((rec) => ({ ...rec.r }));
  const auditClusters = [];
  for (const c of clusters) {
    const primaryIdx = c.members[0].i;
    for (const m of c.members) {
      out[m.i] = { ...out[m.i], dedupCluster: c.key, isDuplicate: m.i !== primaryIdx };
      if (m.i !== primaryIdx) out[m.i].dupOf = primaryIdx; else delete out[m.i].dupOf;
    }
    if (c.members.length > 1) {
      auditClusters.push({ key: c.key, method: c.method, primary: primaryIdx, members: c.members.map((m) => m.i), size: c.members.length });
    }
  }
  const duplicates = out.filter((r) => r.isDuplicate).length;
  return {
    records: out,
    dedup: {
      unique: out.length - duplicates,
      total: out.length,
      duplicates,
      clusters: auditClusters,
      method: "exact(doi>pmid>pmcid>trial)+fuzzy-title",
      fuzzy,
      overrides: 0,
    },
  };
}

// Reversible human override: mark a flagged record as NOT a duplicate (adjudication),
// recompute the unique count, and increment the audited override counter.
export function unmergeRecord(state, index) {
  const records = state.records.map((r, i) =>
    i === index ? { ...r, isDuplicate: false, dupOf: undefined, overridden: true } : r);
  const duplicates = records.filter((r) => r.isDuplicate).length;
  return {
    records,
    dedup: { ...state.dedup, unique: records.length - duplicates, duplicates, overrides: (state.dedup.overrides || 0) + 1 },
  };
}
