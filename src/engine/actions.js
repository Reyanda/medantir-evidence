// actions.js — The typed Action layer.
//
// In a narration system, "the best action" is whatever the model decides to type.
// Here, every mutation to the world is a REGISTERED, TYPED, VALIDATED, LOGGED
// Action with declared preconditions and effects. Nothing mutates the ontology
// except through an action. This is what makes "find the best action" auditable:
// the space of possible actions is finite, inspectable, and each one leaves a
// tamper-evident record of who did what, to which object, and why.

import { titleFor } from "./ontology.js";
import { CONFIG } from "./config.js";

// Weighted evidence → confidence. Real math, not a setTimeout pretending to think.
// Each cited Source contributes credibility discounted by its bias, blended with
// the mean of the claim's evidence-stream scores. This is the "causal triangulation"
// the UI has only ever mocked — now it is a pure function of ontology state.
export function computeConfidence(store, claim) {
  const sources = store.linked(claim.id, "cites").filter((s) => s.trust !== "quarantined");
  const vectors = store.linked(claim.id, "hasEvidence");

  const srcWeight = sources.length
    ? sources.reduce((a, s) => a + s.credibility * (1 - s.bias), 0) / sources.length
    : 0;
  const vecWeight = vectors.length
    ? vectors.reduce((a, v) => a + (v.score || 0) / 100, 0) / vectors.length
    : 0;

  // Agreement bonus: consensus across many independent trusted sources.
  const c = CONFIG.confidence;
  const agreementBonus = Math.min(c.agreementCap, sources.length * c.agreementPerSource);

  const raw = c.sourceWeight * srcWeight + c.vectorWeight * vecWeight + agreementBonus;
  return {
    confidence: Math.round(Math.min(1, raw) * 100),
    factors: { srcWeight, vecWeight, agreementBonus, nSources: sources.length, nVectors: vectors.length },
  };
}

// ---------------------------------------------------------------------------
// The registry. Each action declares:
//   target   — object kind it acts on (or null for store-level)
//   describe — human sentence for the given target/params
//   cost/risk/impact — 0..1 hints the decision engine scores over
//   check    — (store, target, params) => { ok, reason }
//   apply    — (store, target, params) => effectsSummary   (mutates via store.set)
// ---------------------------------------------------------------------------

export const ACTIONS = {
  verifyClaim: {
    id: "verifyClaim",
    label: "Verify claim",
    target: "Claim",
    cost: 0.1,
    risk: 0.05,
    impact: 0.5,
    describe: (t) => `Re-run causal triangulation on "${titleFor(t).slice(0, 60)}…"`,
    check: (store, claim) => {
      const n = store.linked(claim.id, "cites").length + store.linked(claim.id, "hasEvidence").length;
      return n > 0
        ? { ok: true }
        : { ok: false, reason: "No cited sources or evidence streams to triangulate." };
    },
    apply: (store, claim) => {
      const { confidence, factors } = computeConfidence(store, claim);
      const status =
        confidence >= CONFIG.confidence.verifyThreshold
          ? "verified"
          : confidence <= CONFIG.confidence.refuteThreshold
          ? "refuted"
          : "unverified";
      store.set(
        claim.id,
        { confidence, status },
        { origin: "action:verifyClaim", transform: "weighted-triangulation", confidence: confidence / 100 }
      );
      return { confidence, status, factors };
    },
  },

  escalateAlert: {
    id: "escalateAlert",
    label: "Escalate alert",
    target: "Claim",
    cost: 0.2,
    risk: 0.35,
    impact: 0.85,
    describe: (t) => `Raise a field alert for "${titleFor(t).slice(0, 50)}…"`,
    check: (store, claim) => {
      const gate = CONFIG.thresholds.escalateConfidence;
      if ((claim.confidence ?? 0) < gate)
        return { ok: false, reason: `Confidence ${claim.confidence ?? 0}% below escalation threshold (${gate}%).` };
      if (claim.status === "escalated") return { ok: false, reason: "Already escalated." };
      return { ok: true };
    },
    apply: (store, claim) => {
      const regions = store.linked(claim.id, "locatedIn");
      const severity = claim.confidence >= CONFIG.thresholds.criticalConfidence ? "critical" : "elevated";
      const alert = store.create(
        "Alert",
        { headline: `Escalation: ${titleFor(claim).slice(0, 70)}`, severity, raisedBy: "DecisionEngine" },
        { origin: "action:escalateAlert", confidence: claim.confidence / 100 }
      );
      store.link(alert.id, "raisedFor", claim.id);
      for (const r of regions) {
        store.link(alert.id, "threatens", r.id);
        store.set(r.id, { threatLevel: severity === "critical" ? "red" : "orange" }, { origin: "action:escalateAlert" });
      }
      store.set(claim.id, { status: "escalated" }, { origin: "action:escalateAlert" });
      return { alertId: alert.id, severity, regions: regions.map((r) => r.name) };
    },
  },

  quarantineSource: {
    id: "quarantineSource",
    label: "Quarantine source",
    target: "Source",
    cost: 0.15,
    risk: 0.25,
    impact: 0.6,
    describe: (t) => `Quarantine low-trust source "${titleFor(t)}" and re-triangulate affected claims`,
    check: (store, src) =>
      src.trust === "quarantined"
        ? { ok: false, reason: "Source already quarantined." }
        : src.credibility >= 0.7
        ? { ok: false, reason: `Credibility ${(src.credibility * 100) | 0}% too high to quarantine.` }
        : { ok: true },
    apply: (store, src) => {
      store.set(src.id, { trust: "quarantined" }, { origin: "action:quarantineSource" });
      // Cascade: every claim that cited this source loses it and is re-triangulated.
      const affected = store.linkedInverse(src.id, "cites");
      for (const claim of affected) {
        const { confidence, status } = computeConfidence(store, claim);
        store.set(claim.id, { confidence, status }, { origin: "action:quarantineSource:cascade" });
      }
      return { source: src.name, reTriangulated: affected.map((c) => c.id) };
    },
  },

  allocateResources: {
    id: "allocateResources",
    label: "Allocate resources",
    target: "ResearchCategory",
    cost: 0.3,
    risk: 0.2,
    impact: 0.7,
    describe: (t, p) => `Commit $${((p?.amount ?? 0) / 1e6).toFixed(1)}M to ${t.shortName || t.name}`,
    check: (store, cat, params) => {
      const amount = params?.amount ?? cat.budget * 0.1;
      const remaining = cat.budget - (cat.allocated || 0);
      return amount <= remaining
        ? { ok: true }
        : { ok: false, reason: `Requested $${(amount / 1e6).toFixed(1)}M exceeds remaining $${(remaining / 1e6).toFixed(1)}M.` };
    },
    apply: (store, cat, params) => {
      const amount = params?.amount ?? cat.budget * 0.1;
      store.set(cat.id, { allocated: (cat.allocated || 0) + amount }, { origin: "action:allocateResources" });
      return { category: cat.name, amount, allocated: (cat.allocated || 0) + amount };
    },
  },

  dispatchCountermeasure: {
    id: "dispatchCountermeasure",
    label: "Dispatch countermeasure",
    target: "Claim",
    cost: 0.6,
    risk: 0.5,
    impact: 0.95,
    describe: (t) => `Deploy field countermeasure for "${titleFor(t).slice(0, 45)}…"`,
    check: (store, claim) =>
      claim.status === "escalated"
        ? { ok: true }
        : { ok: false, reason: "Claim must be escalated before countermeasures deploy." },
    apply: (store, claim) => {
      const regions = store.linked(claim.id, "locatedIn");
      store.set(claim.id, { status: "verified" }, { origin: "action:dispatchCountermeasure" });
      for (const r of regions)
        store.set(r.id, { threatLevel: "yellow" }, { origin: "action:dispatchCountermeasure:mitigated" });
      return { deployedTo: regions.map((r) => r.name) };
    },
  },
};

export const ACTION_LIST = Object.values(ACTIONS);

// ---------------------------------------------------------------------------
// The single sanctioned execution path. Runs the precondition, applies effects,
// writes an immutable audit record. Returns { ok, record | reason }.
// ---------------------------------------------------------------------------

export function execute(store, actionId, targetId, params = {}, actor = "operator") {
  const action = ACTIONS[actionId];
  if (!action) return { ok: false, reason: `Unknown action: ${actionId}` };

  const target = targetId ? store.get(targetId) : null;
  if (action.target && !target) return { ok: false, reason: `Target ${targetId} not found` };

  const gate = action.check ? action.check(store, target, params) : { ok: true };
  if (!gate.ok) {
    const record = store.record({
      action: actionId,
      label: action.label,
      target: targetId,
      targetTitle: target ? titleFor(target) : null,
      actor,
      status: "blocked",
      reason: gate.reason,
    });
    return { ok: false, reason: gate.reason, record };
  }

  const effects = action.apply(store, target, params);
  const record = store.record({
    action: actionId,
    label: action.label,
    target: targetId,
    targetTitle: target ? titleFor(target) : null,
    actor,
    status: "applied",
    effects,
  });
  store.persist();
  return { ok: true, effects, record };
}
