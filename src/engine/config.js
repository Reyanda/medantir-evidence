// config.js — Single source of truth for every tunable engine parameter.
//
// Rationale (per project doctrine): app code must not scatter magic numbers or
// retype behaviour into leaf views. Weights, thresholds, formulas and API routes
// live HERE; the engine and UI both read from this object. Two payoffs:
//   1. No drift — the EV formula the UI shows is the one the engine computes.
//   2. Learnable — the Bayesian/RL layer can update these values at runtime
//      (see algorithms.js applyLearning) instead of them being constants I baked in.

export const CONFIG = {
  app: {
    updateCheckMs: 300000,
  },
  // --- decision engine: expected-value scoring --------------------------
  scoring: {
    // The formula, described once, rendered by the UI and computed by decision.js.
    formula: "impact × urgency × P(success) − cost × risk",
    summary:
      "Every applicable typed action is ranked by expected value; committing one runs its preconditions and writes an immutable audit record.",
    riskBase: 0.5, // riskPenalty = riskBase + action.risk
    mediaPressureScale: 0.35, // how hard adverse media sentiment pushes urgency
    // factor display metadata — the UI iterates this instead of hardcoding labels
    factors: [
      { key: "impact", label: "impact", role: "gain" },
      { key: "urgency", label: "urgency", role: "gain" },
      { key: "successProb", label: "P(success)", role: "gain" },
      { key: "cost", label: "cost", role: "penalty" },
      { key: "riskPenalty", label: "risk×", role: "neutral" },
      { key: "gain", label: "gain", role: "gain" },
      { key: "penalty", label: "penalty", role: "penalty" },
    ],
  },

  // --- claim confidence (weighted triangulation) ------------------------
  confidence: {
    sourceWeight: 0.45,
    vectorWeight: 0.45,
    agreementPerSource: 0.01,
    agreementCap: 0.1,
    verifyThreshold: 60, // ≥ verified, ≤ refuteThreshold refuted
    refuteThreshold: 35,
  },

  // --- alert / escalation gates ----------------------------------------
  thresholds: {
    escalateConfidence: 60,
    criticalConfidence: 85,
  },

  // --- media / GDELT ----------------------------------------------------
  media: {
    gdeltSpacingMs: 5200, // GDELT throttles ~1 req / 5s
    perDomain: 6,
    // domain sentiment index → threat level bands
    bands: { critical: -50, elevated: -20, watch: 5 },
  },

  // --- EWAR monitors: risk banding + uncertainty ------------------------
  ewar: {
    // risk index 0..100 → level
    bands: { critical: 75, elevated: 55, watch: 35 },
    // ensemble spread (0..1) above which we flag "high model uncertainty"
    uncertaintyFlag: 0.18,
    lookbackDays: 30,
    weatherBaselineDays: 60,
    weatherForecastDays: 7,
    anomalyMinBaselineRows: 14,
  },

  // --- multi-model AI engine -------------------------------------------
  ai: {
    mode: "single", // "single" | "multi" — overridden by vault at runtime
    maxParallel: 6,
  },

  // --- external open-data APIs (CORS-verified, keyless) -----------------
  apis: {
    usgs: "https://earthquake.usgs.gov/fdsnws/event/1/query",
    eonet: "https://eonet.gsfc.nasa.gov/api/v3/events",
    openMeteo: "https://api.open-meteo.com/v1/forecast",
    openMeteoArchive: "https://archive-api.open-meteo.com/v1/archive",
    openMeteoClimate: "https://climate-api.open-meteo.com/v1/climate",
    dhsProgram: "https://api.dhsprogram.com/rest/dhs",
    diseaseSh: "https://disease.sh/v3/covid-19",
    gdelt: "https://api.gdeltproject.org/api/v2/doc/doc",
  },
};

// Convenience: the scoring descriptor the DecisionTab renders (no retyped copy).
export const SCORING = CONFIG.scoring;

// Runtime override hook for the learning layer. Shallow-merges a patch into a
// section so RL/Bayesian updates can nudge weights without code changes.
export function tuneConfig(section, patch) {
  if (!CONFIG[section]) return;
  Object.assign(CONFIG[section], patch);
}

// --- operator-facing persistence (Protocols control panel) ----------------
// Changes made in the Protocols tab persist to localStorage and re-apply on
// load, so the operator's engine tuning is real and durable (not dead UI state).
const OVERRIDE_KEY = "medantir.config.overrides.v1";

export function persistTune(section, patch) {
  tuneConfig(section, patch);
  if (typeof localStorage === "undefined") return;
  let all = {};
  try { all = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}"); } catch { /* ignore */ }
  all[section] = { ...(all[section] || {}), ...patch };
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(all));
}

export function resetConfigOverrides() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(OVERRIDE_KEY);
}

// re-apply saved overrides at startup
if (typeof localStorage !== "undefined") {
  try {
    const all = JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "{}");
    for (const [section, patch] of Object.entries(all)) tuneConfig(section, patch);
  } catch { /* ignore */ }
}
