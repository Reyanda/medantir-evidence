// concordanceStats.js — the agreement mathematics, kept pure so it can be
// tested without a browser, a provider or a key.
//
// Observed agreement, Cohen's kappa for two raters, Fleiss' kappa for three or
// more, and scoring against a reference set. Chance-corrected agreement matters
// here because two models that both exclude almost everything will agree ~90%
// of the time while telling you nothing.

export const DECISIONS = ["include", "exclude", "uncertain"];

// --- agreement statistics --------------------------------------------------

/** Observed agreement plus Cohen's kappa for exactly two raters. */
export function cohensKappa(a = [], b = [], categories = DECISIONS) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x && y);
  const n = pairs.length;
  if (!n) return { n: 0, observed: 0, expected: 0, kappa: null, reason: "no overlapping decisions" };
  const agree = pairs.filter(([x, y]) => x === y).length;
  const observed = agree / n;
  const marginalA = {}, marginalB = {};
  for (const c of categories) { marginalA[c] = 0; marginalB[c] = 0; }
  for (const [x, y] of pairs) { marginalA[x] = (marginalA[x] || 0) + 1; marginalB[y] = (marginalB[y] || 0) + 1; }
  const expected = categories.reduce((sum, c) => sum + (marginalA[c] / n) * (marginalB[c] / n), 0);
  const kappa = expected === 1 ? null : (observed - expected) / (1 - expected);
  return { n, observed, expected, kappa, agree };
}

/** Fleiss' kappa for three or more raters over the same items. */
export function fleissKappa(matrix = [], categories = DECISIONS) {
  const rows = matrix.filter((row) => row && row.filter(Boolean).length > 1);
  const n = rows.length;
  if (!n) return { n: 0, kappa: null, reason: "no item has two or more decisions" };
  const raters = rows[0].filter(Boolean).length;
  if (rows.some((row) => row.filter(Boolean).length !== raters)) {
    return { n, kappa: null, reason: "unequal rater counts across items — Fleiss requires a fixed number" };
  }
  const counts = rows.map((row) => categories.map((c) => row.filter((v) => v === c).length));
  const pI = counts.map((row) => (row.reduce((s, v) => s + v * (v - 1), 0)) / (raters * (raters - 1)));
  const pBar = pI.reduce((s, v) => s + v, 0) / n;
  const pJ = categories.map((_, j) => counts.reduce((s, row) => s + row[j], 0) / (n * raters));
  const pE = pJ.reduce((s, v) => s + v * v, 0);
  const kappa = pE === 1 ? null : (pBar - pE) / (1 - pE);
  return { n, raters, pBar, pE, kappa };
}

export function interpretKappa(k) {
  if (k === null || k === undefined || Number.isNaN(k)) return "not computable";
  if (k < 0) return "worse than chance";
  if (k < 0.21) return "slight";
  if (k < 0.41) return "fair";
  if (k < 0.61) return "moderate";
  if (k < 0.81) return "substantial";
  return "almost perfect";
}

/** Decision per runner per record, plus the items they disagreed on. */
export function concordance(sandboxes, recordsById = new Map()) {
  const runnerIds = Object.keys(sandboxes);
  if (runnerIds.length < 2) return { ok: false, reason: "at least two runners are needed to compare", runnerIds };

  const byRecord = new Map();
  for (const runnerId of runnerIds) {
    for (const result of sandboxes[runnerId].results || []) {
      if (!result.ok) continue;
      const entry = byRecord.get(result.recordId) || {};
      entry[runnerId] = result;
      byRecord.set(result.recordId, entry);
    }
  }

  const items = [...byRecord.entries()].map(([recordId, votes]) => {
    const decisions = runnerIds.map((id) => votes[id]?.decision || null);
    const present = decisions.filter(Boolean);
    const unanimous = present.length > 1 && present.every((d) => d === present[0]);
    return {
      recordId,
      title: recordsById.get(recordId)?.title || recordId,
      decisions,
      votes,
      unanimous,
      split: present.length > 1 && !unanimous,
    };
  });

  const pairwise = [];
  for (let i = 0; i < runnerIds.length; i++) {
    for (let j = i + 1; j < runnerIds.length; j++) {
      const a = items.map((it) => it.decisions[i]);
      const b = items.map((it) => it.decisions[j]);
      pairwise.push({ a: runnerIds[i], b: runnerIds[j], ...cohensKappa(a, b) });
    }
  }

  const fleiss = runnerIds.length > 2 ? fleissKappa(items.map((it) => it.decisions)) : null;
  const disagreements = items.filter((it) => it.split);

  return {
    ok: true,
    runnerIds,
    items,
    pairwise,
    fleiss,
    disagreements,
    unanimousCount: items.filter((it) => it.unanimous).length,
    comparedCount: items.length,
  };
}

/**
 * Score each runner against a reference decision set — the operator's own
 * screening, or an imported gold standard from a published review. Sensitivity
 * is the number that matters in screening: a missed include is unrecoverable
 * later, a false include only costs full-text reading time.
 */
export function scoreAgainstReference(sandboxes, reference = new Map()) {
  return Object.entries(sandboxes).map(([runnerId, sandbox]) => {
    let tp = 0, fp = 0, tn = 0, fn = 0, compared = 0;
    const missed = [];
    const modelSaid = [], goldSaid = [];
    for (const result of sandbox.results || []) {
      if (!result.ok) continue;
      const gold = reference.get(result.recordId);
      if (!gold || gold === "uncertain") continue;
      compared += 1;
      modelSaid.push(result.decision === "include" ? "include" : "exclude");
      goldSaid.push(gold);
      const predictedInclude = result.decision === "include";
      const goldInclude = gold === "include";
      if (predictedInclude && goldInclude) tp += 1;
      else if (predictedInclude && !goldInclude) fp += 1;
      else if (!predictedInclude && goldInclude) { fn += 1; missed.push(result.recordId); }
      else tn += 1;
    }
    const k = cohensKappa(modelSaid, goldSaid, ["include", "exclude"]);
    return {
      runnerId,
      label: sandbox.runner?.label || runnerId,
      compared,
      tp, fp, tn, fn,
      missed,
      sensitivity: tp + fn ? tp / (tp + fn) : null,
      specificity: tn + fp ? tn / (tn + fp) : null,
      accuracy: compared ? (tp + tn) / compared : null,
      kappa: k.kappa,
      failed: sandbox.failed || 0,
      meanMs: sandbox.results?.length ? Math.round(sandbox.results.reduce((s, r) => s + (r.ms || 0), 0) / sandbox.results.length) : null,
    };
  }).sort((a, b) => (b.sensitivity ?? -1) - (a.sensitivity ?? -1) || (b.accuracy ?? -1) - (a.accuracy ?? -1));
}

/** The reference set an operator has actually built, taken from their own decisions. */
export function operatorReference(records = []) {
  const map = new Map();
  for (const r of records) {
    const decision = r.fulltext?.decision || (r.tiabBy === "operator" ? r.tiab : null);
    if (decision === "include" || decision === "exclude") map.set(r.id, decision);
  }
  return map;
}
