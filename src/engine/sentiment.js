// sentiment.js — In-browser sentiment analyzer + threat-domain classifier.
//
// A compact VADER-style rule engine (Hutto & Gilbert, 2014) tuned with a
// global-security lexicon. Deterministic, offline, free, and fully auditable —
// no key, no network, no black box. Returns a compound score in [-1, 1] where
// negative = alarm/deterioration, plus an intensity and the winning threat domain.
//
// This is the always-on default. The optional AI-provider pass (providers.js)
// can override `method: "ai"` when a provider is enabled, but the lexicon always
// gives a real answer so the board is never empty.

// --- affect lexicon: token -> valence in ~[-4, 4] -------------------------
// General affect (small core) + security/crisis domain terms. Extend freely.
const LEX = {
  // positive / stabilising
  peace: 2.6, ceasefire: 2.4, recovery: 2.0, recover: 1.8, aid: 1.4, relief: 1.8,
  breakthrough: 2.8, stabilise: 1.9, stabilize: 1.9, stable: 1.4, resilient: 1.9,
  cooperation: 1.7, agreement: 1.6, deal: 1.0, funding: 1.2, vaccine: 1.3, cure: 2.6,
  contained: 1.8, contain: 1.2, success: 2.2, progress: 1.7, improve: 1.6, improved: 1.6,
  rescued: 2.0, safe: 1.6, protect: 1.4, secure: 1.3, surplus: 1.3, boost: 1.4,
  restored: 1.8, resolved: 1.9, hope: 1.6, support: 1.2, pledged: 1.0, calm: 1.5,
  // negative / destabilising
  outbreak: -2.6, epidemic: -2.8, pandemic: -3.0, deaths: -3.0, death: -2.8, dying: -2.9,
  fatal: -2.9, deadly: -2.9, killed: -3.0, casualties: -2.8, wounded: -2.2, injured: -2.0,
  war: -2.9, conflict: -2.2, attack: -2.7, strike: -1.6, offensive: -1.8, invasion: -3.0,
  missile: -2.2, airstrike: -2.6, troops: -1.0, militia: -1.6, insurgency: -2.4, terror: -3.0,
  terrorist: -3.0, bombing: -2.9, shelling: -2.6, crisis: -2.6, catastrophe: -3.2, disaster: -3.0,
  famine: -3.2, starvation: -3.2, drought: -2.6, flood: -2.4, flooding: -2.4, wildfire: -2.6,
  hurricane: -2.4, cyclone: -2.4, heatwave: -2.0, emergency: -2.2, collapse: -2.8, shortage: -2.2,
  blackout: -2.4, outage: -2.0, disruption: -1.8, shutdown: -1.8, sanctions: -1.6, embargo: -1.8,
  inflation: -1.8, recession: -2.4, default: -2.2, debt: -1.2, unrest: -2.4, riot: -2.6,
  protest: -1.2, displacement: -2.2, refugees: -1.6, displaced: -2.0, evacuate: -1.8,
  hack: -2.2, breach: -2.2, ransomware: -2.6, malware: -2.2, cyberattack: -2.8, sabotage: -2.6,
  spillover: -1.8, mutation: -1.4, variant: -1.2, surge: -1.6, spike: -1.4, spreading: -1.6,
  contamination: -2.2, toxic: -2.2, hazard: -1.8, threat: -2.0, warning: -1.2, alarm: -1.8,
  fear: -1.9, panic: -2.4, fragile: -1.6, vulnerable: -1.4, severe: -1.8, critical: -1.6,
  overwhelmed: -2.0, undersupplied: -1.6, blocked: -1.4, stranded: -1.6, looting: -2.2,
};

// intensifiers: multiplicative adjustment to the next sentiment token
const BOOST = {
  very: 0.293, extremely: 0.5, severely: 0.45, massively: 0.45, hugely: 0.4, deeply: 0.35,
  highly: 0.3, seriously: 0.35, critically: 0.4, dangerously: 0.45, rapidly: 0.3, sharply: 0.35,
  slightly: -0.3, somewhat: -0.25, marginally: -0.3, barely: -0.35, partially: -0.2,
};

const NEGATIONS = new Set([
  "not", "no", "never", "none", "cannot", "cant", "won't", "wont", "without", "nor",
  "neither", "hardly", "scarcely", "fails", "failed", "denies", "denied", "halts", "halted",
]);

const CAPS_BOOST = 0.6;
const NEG_SCALAR = -0.74;

function tokenize(text) {
  return (text || "")
    .replace(/[""'']/g, "'")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, ""))
    .filter(Boolean);
}

function isAllCaps(w) {
  return w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w);
}

// VADER-style compound scoring.
export function analyzeSentiment(text) {
  const rawTokens = tokenize(text);
  if (!rawTokens.length) return { compound: 0, intensity: 0, hits: [] };

  const lower = rawTokens.map((t) => t.toLowerCase());
  const exclam = Math.min((text.match(/!/g) || []).length, 4) * 0.292;
  const capsPresent = rawTokens.some(isAllCaps);
  const hits = [];
  let sum = 0;

  for (let i = 0; i < lower.length; i++) {
    const w = lower[i];
    let v = LEX[w];
    if (v === undefined) continue;

    // caps emphasis on the sentiment word itself
    if (isAllCaps(rawTokens[i]) && capsPresent) v += v > 0 ? CAPS_BOOST : -CAPS_BOOST;

    // look back up to 3 tokens for boosters and negations
    for (let j = 1; j <= 3 && i - j >= 0; j++) {
      const prev = lower[i - j];
      const damp = 1 - (j - 1) * 0.05; // closer words matter more
      if (BOOST[prev] !== undefined) {
        let b = BOOST[prev] * damp;
        if (isAllCaps(rawTokens[i - j])) b *= 1 + CAPS_BOOST * 0.5;
        v += v > 0 ? b : -b;
      }
      if (NEGATIONS.has(prev)) v *= NEG_SCALAR;
    }

    hits.push({ token: w, valence: Number(v.toFixed(2)) });
    sum += v;
  }

  if (sum > 0) sum += exclam;
  else if (sum < 0) sum -= exclam;

  // normalize to [-1, 1]
  const compound = Math.max(-1, Math.min(1, sum / Math.sqrt(sum * sum + 15)));
  const intensity = Math.min(1, Math.abs(sum) / 8);
  return { compound: Number(compound.toFixed(3)), intensity: Number(intensity.toFixed(3)), hits };
}

// --- threat-domain classification ----------------------------------------
// Each domain has a keyword set. A signal is assigned to the highest-scoring
// domain; salience is the normalized match strength.
export const THREAT_DOMAINS = [
  { slug: "health", name: "Health & Pandemics", color: "#ef4444",
    terms: ["outbreak","epidemic","pandemic","virus","vaccine","disease","cholera","ebola","measles","malaria","infection","hospital","health","who","pathogen","mpox","influenza","cases","quarantine"] },
  { slug: "defence", name: "Defence & Conflict", color: "#dc2626",
    terms: ["war","conflict","military","troops","missile","attack","airstrike","offensive","insurgency","terror","militia","army","defence","defense","invasion","ceasefire","weapons","nato","border","shelling"] },
  { slug: "climate", name: "Climate & Environment", color: "#22c55e",
    terms: ["climate","drought","flood","flooding","wildfire","hurricane","cyclone","heatwave","emissions","warming","storm","rainfall","famine","desertification","glacier","temperature","environment","el niño","monsoon"] },
  { slug: "energy", name: "Energy & Resources", color: "#f59e0b",
    terms: ["energy","oil","gas","power","grid","blackout","outage","fuel","electricity","pipeline","opec","barrel","nuclear","renewable","solar","coal","refinery","supply","reactor"] },
  { slug: "economy", name: "Economy & Finance", color: "#8b5cf6",
    terms: ["inflation","recession","debt","default","currency","market","trade","sanctions","embargo","gdp","unemployment","imf","banking","fiscal","tariff","economy","prices","stocks"] },
  { slug: "cyber", name: "Cyber & Information", color: "#06b6d4",
    terms: ["cyber","cyberattack","hack","breach","ransomware","malware","data","network","phishing","disinformation","espionage","sabotage","infrastructure","outage","hackers"] },
  { slug: "food", name: "Food & Water Security", color: "#84cc16",
    terms: ["food","famine","starvation","hunger","harvest","crop","water","drought","malnutrition","agriculture","grain","wheat","shortage","fortification","nutrition","supply"] },
  { slug: "migration", name: "Migration & Displacement", color: "#ec4899",
    terms: ["refugees","migration","displaced","displacement","asylum","border","evacuate","camp","stranded","humanitarian","crossing","smuggling","exodus"] },
];

export function classifyDomain(text) {
  const words = tokenize(text).map((t) => t.toLowerCase());
  const set = new Set(words);
  let best = null;
  let bestScore = 0;
  const scores = {};
  for (const d of THREAT_DOMAINS) {
    let score = 0;
    for (const term of d.terms) if (set.has(term)) score += 1;
    scores[d.slug] = score;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return {
    domain: best ? best.slug : "health",
    salience: Math.min(1, bestScore / 4),
    matched: bestScore,
    scores,
  };
}

// --- LLM-enhanced sentiment ------------------------------------------------
// Uses the embedded local model (SmolLM2) for richer sentiment when available.
// Falls back to the lexicon on any failure — the board never breaks.

let _llmAvailable = null;

async function isLLMAvailable() {
  if (_llmAvailable !== null) return _llmAvailable;
  try {
    const mod = await import("./localInference.js");
    _llmAvailable = mod.isModelLoaded("text-classification") || true;
    return _llmAvailable;
  } catch {
    _llmAvailable = false;
    return false;
  }
}

/**
 * LLM-enhanced sentiment scoring. Returns the same shape as analyzeSentiment
 * plus `method: "lexicon" | "llm"` so callers know which engine scored it.
 * Never throws — always returns a valid result.
 */
export async function analyzeSentimentLLM(text) {
  const lexiconResult = analyzeSentiment(text);
  try {
    if (!(await isLLMAvailable())) return { ...lexiconResult, method: "lexicon" };
    const { inferSentiment } = await import("./localInference.js");
    const llm = await inferSentiment(text);
    // Map LLM labels to compound score: positive→positive score, negative→negative
    let compound;
    if (llm.label === "positive" || llm.label === "LABEL_1") {
      compound = llm.score;
    } else if (llm.label === "negative" || llm.label === "LABEL_0") {
      compound = -llm.score;
    } else {
      compound = 0;
    }
    return {
      ...lexiconResult,
      compound: Number(compound.toFixed(3)),
      llmScore: llm.score,
      llmLabel: llm.label,
      method: "llm",
    };
  } catch {
    return { ...lexiconResult, method: "lexicon" };
  }
}
