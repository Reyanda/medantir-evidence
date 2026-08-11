// decision.js — The decision engine. "Find the best action."
//
// This is the claim the whole product makes. In the mockup it was a slogan. Here
// it is a function: given a situation (a Claim, or the whole board), enumerate the
// finite set of TYPED actions that are currently APPLICABLE (preconditions pass),
// score each by expected value, and return a ranked, *explained* recommendation.
//
// Expected value is transparent and derived from ontology state — never a black box:
//
//   EV = impact × urgency × successProb  −  cost × riskPenalty
//
//   impact/cost/risk   : declared per action type
//   urgency            : how much the situation demands action now (confidence,
//                        threat level, unverified-but-plausible, budget headroom)
//   successProb        : likelihood the action achieves its effect given state
//   riskPenalty        : scales risk by how irreversible / high-stakes the target is
//
// Every recommendation ships its factor breakdown, so an operator sees WHY the
// engine ranked one action over another — the opposite of "the model just decided".

import { ACTION_LIST } from "./actions.js";
import { titleFor } from "./ontology.js";
import { CONFIG } from "./config.js";

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// Media-sentiment pressure on a claim: how alarmed is the world's press about the
// claim's threat domain right now? Negative sentimentIndex (-100..0) → positive
// pressure in [0, ~0.35] that raises the urgency of acting. This is the point where
// "real sentiment from media" actually changes what the engine recommends.
function mediaPressure(store, claim) {
  const domains = store.linked(claim.id, "domainOfClaim");
  if (!domains.length) return 0;
  const idx = domains.reduce((a, d) => a + (d.sentimentIndex ?? 0), 0) / domains.length;
  return idx < 0 ? clamp01(-idx / 100) * CONFIG.scoring.mediaPressureScale : 0;
}

// Situational urgency + success probability per (action, target).
function situationalFactors(store, action, target) {
  let urgency = 0.5;
  let successProb = 0.7;

  if (target?.kind === "Claim") {
    const conf = (target.confidence ?? 0) / 100;
    const pressure = mediaPressure(store, target);
    switch (action.id) {
      case "verifyClaim":
        // Most urgent when we know least — unverified claims with evidence waiting.
        // Adverse media pressure makes verifying an unknown claim more urgent.
        urgency = clamp01((target.status === "unverified" ? 0.9 : 0.4) + pressure * 0.5);
        successProb = 0.95;
        break;
      case "escalateAlert":
        // Urgency tracks confidence, amplified by how alarmed the press is about
        // this threat domain — a 92%-confident outbreak amid negative media is maximal.
        urgency = clamp01(conf + pressure);
        successProb = clamp01(conf + 0.1);
        break;
      case "dispatchCountermeasure":
        urgency = target.status === "escalated" ? 0.95 : 0.2;
        successProb = clamp01(conf);
        break;
      default:
        break;
    }
  }

  if (target?.kind === "Source" && action.id === "quarantineSource") {
    // Urgent when a low-credibility, high-bias source is polluting many claims.
    const affected = store.linkedInverse(target.id, "cites").length;
    urgency = clamp01((1 - target.credibility) * 0.6 + Math.min(affected, 5) * 0.08);
    successProb = 0.9;
  }

  if (target?.kind === "ResearchCategory" && action.id === "allocateResources") {
    const headroom = (target.budget - (target.allocated || 0)) / (target.budget || 1);
    urgency = clamp01(0.3 + headroom * 0.4);
    successProb = 0.85;
  }

  return { urgency, successProb };
}

// Irreversibility multiplier: acting on a Region-threatening or field-deploying
// action carries more downside if wrong.
function riskPenaltyFor(action) {
  return CONFIG.scoring.riskBase + action.risk;
}

export function scoreAction(store, action, target, params = {}) {
  const gate = action.check ? action.check(store, target, params) : { ok: true };
  const { urgency, successProb } = situationalFactors(store, action, target);

  const gain = action.impact * urgency * successProb;
  const penalty = action.cost * riskPenaltyFor(action);
  const ev = gain - penalty;

  return {
    actionId: action.id,
    label: action.label,
    targetId: target?.id ?? null,
    targetTitle: target ? titleFor(target) : "system",
    description: action.describe ? action.describe(target, params) : action.label,
    applicable: gate.ok,
    blockedReason: gate.ok ? null : gate.reason,
    ev: Number(ev.toFixed(4)),
    factors: {
      impact: action.impact,
      urgency: Number(urgency.toFixed(3)),
      successProb: Number(successProb.toFixed(3)),
      cost: action.cost,
      riskPenalty: Number(riskPenaltyFor(action).toFixed(3)),
      gain: Number(gain.toFixed(3)),
      penalty: Number(penalty.toFixed(3)),
    },
  };
}

// Recommend over a single target: every action type whose target matches.
export function recommendForTarget(store, targetId) {
  const target = store.get(targetId);
  if (!target) return [];
  return ACTION_LIST.filter((a) => a.target === target.kind)
    .map((a) => scoreAction(store, a, target))
    .sort((x, y) => Number(y.applicable) - Number(x.applicable) || y.ev - x.ev);
}

// Recommend across the WHOLE board: scan every object, score every applicable
// action, return the global best-action ranking. This is the engine answering
// "of everything happening right now, what is the single highest-value thing to do?"
export function recommendGlobal(store, { limit = 12, applicableOnly = true } = {}) {
  const recs = [];
  for (const action of ACTION_LIST) {
    const targets = action.target ? store.all(action.target) : [null];
    for (const target of targets) {
      const r = scoreAction(store, action, target);
      if (applicableOnly && !r.applicable) continue;
      recs.push(r);
    }
  }
  recs.sort((a, b) => b.ev - a.ev);
  return recs.slice(0, limit);
}
