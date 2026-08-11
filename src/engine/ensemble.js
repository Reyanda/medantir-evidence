// ensemble.js — Multi-model AI engine.
//
// The operator's choice of a "single model" or a "multi-model engine": in multi
// mode, EVERY enabled provider is shown the SAME input and returns its OWN answer.
// We then report each model's result plus the cross-model spread — the AI analogue
// of the statistical ensemble in algorithms.js. Two independent uncertainty views:
// algorithms disagreeing (epistemic) and models disagreeing (that too).

import { CONFIG } from "./config.js";
import { PROVIDER_BY_ID, callProvider, activeProvider, enabledProviders, getAIMode } from "./providers.js";
import { std, mean } from "./algorithms.js";

const SENTIMENT_MSG = (text) => [
  {
    role: "system",
    content:
      "You are a geopolitical media sentiment analyst. Score a news item's tone toward global-security stability. Output strict JSON only.",
  },
  {
    role: "user",
    content:
      `Return JSON {"sentiment": number in [-1,1] (-1 severe alarm, 1 stabilising), "domain": one of ["health","defence","climate","energy","economy","cyber","food","migration"], "rationale": short string}.\n\nITEM: ${text}`,
  },
];

async function scoreWith(providerId, text) {
  try {
    const raw = await callProvider(providerId, SENTIMENT_MSG(text), { json: true });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    if (typeof p.sentiment !== "number") return null;
    return {
      providerId,
      label: PROVIDER_BY_ID[providerId]?.label || providerId,
      sentiment: Math.max(-1, Math.min(1, p.sentiment)),
      domain: p.domain,
      rationale: p.rationale,
    };
  } catch {
    return null;
  }
}

// Analyse one item. In single mode → one provider. In multi mode → all enabled
// providers, returning per-model results + consensus + disagreement.
export async function multiModelSentiment(text) {
  const mode = getAIMode();
  const providers = mode === "multi" ? enabledProviders() : (activeProvider() ? [activeProvider()] : []);
  if (!providers.length) return { ok: false, reason: "No provider enabled", mode };

  const limited = providers.slice(0, CONFIG.ai.maxParallel);
  const settled = await Promise.all(limited.map((p) => scoreWith(p.id, text)));
  const models = settled.filter(Boolean);
  if (!models.length) return { ok: false, reason: "All model calls failed", mode };

  const scores = models.map((m) => m.sentiment);
  const consensus = mean(scores);
  const disagreement = std(scores); // cross-model uncertainty
  // domain vote
  const votes = {};
  for (const m of models) if (m.domain) votes[m.domain] = (votes[m.domain] || 0) + 1;
  const domain = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    ok: true,
    mode,
    models,
    consensus: Number(consensus.toFixed(3)),
    disagreement: Number(disagreement.toFixed(3)),
    domain,
    domainVotes: votes,
  };
}

// Generic multi-model ask (same prompt to N models) — reusable for monitors that
// want narrative model perspectives on a computed risk assessment.
export async function multiModelAsk(prompt, { system } = {}) {
  const mode = getAIMode();
  const providers = mode === "multi" ? enabledProviders() : (activeProvider() ? [activeProvider()] : []);
  if (!providers.length) return { ok: false, reason: "No provider enabled", mode, answers: [] };
  const limited = providers.slice(0, CONFIG.ai.maxParallel);
  const msgs = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const answers = await Promise.all(
    limited.map(async (p) => {
      try {
        const text = await callProvider(p.id, msgs);
        return { providerId: p.id, label: p.label, text: (text || "").trim() };
      } catch (e) {
        return { providerId: p.id, label: p.label, error: String(e.message || e) };
      }
    })
  );
  return { ok: true, mode, answers: answers.filter((a) => a.text || a.error) };
}
