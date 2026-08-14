import { activeProject } from "./projectstore.js";
import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";

const REVIEW_API = (import.meta.env?.VITE_REVIEW_API_URL || "https://api.actiora.com/review").replace(/\/$/, "");

const SERVER_TYPES = new Set([
  "systematic", "intervention", "diagnostic-accuracy", "overall-prognosis",
  "prognostic-factor", "prediction-model", "prevalence-incidence", "qualitative",
  "mixed-methods", "scoping", "rapid", "umbrella", "living", "network-meta-analysis",
  "adverse-effects", "economic", "implementation", "mechanistic", "animal",
  "environmental", "evidence-map",
]);
const APP_TO_SERVER = {
  systematic: "systematic",
  meta_analysis: "intervention",
  scoping: "scoping",
  rapid: "rapid",
  umbrella: "umbrella",
  dta: "diagnostic-accuracy",
  prognostic: "prognostic-factor",
  prediction: "prediction-model",
  prevalence: "prevalence-incidence",
  qualitative: "qualitative",
  mixed: "mixed-methods",
  realist: "qualitative",
  mechanistic: "mechanistic",
  adverse: "adverse-effects",
  economic: "economic",
  animal: "animal",
  environmental: "environmental",
  map: "evidence-map",
};
const DATABASE_NAMES = {
  pubmed: "PubMed",
  medline: "MEDLINE",
  ovid_medline: "MEDLINE",
  europepmc: "Europe PMC",
  openalex: "OpenAlex",
  clinicaltrials: "ClinicalTrials.gov",
  "clinicaltrials.gov": "ClinicalTrials.gov",
  ovid_embase: "Embase",
  embase: "Embase",
  cochrane: "Cochrane Library",
  cinahl: "CINAHL",
  scopus: "Scopus",
  wos: "Web of Science",
  lilacs: "LILACS",
};

const tokens = (value) => Array.isArray(value)
  ? value.map((item) => String(item).trim()).filter(Boolean)
  : String(value || "").split(/\s*(?:,|;|\|)\s*/).map((item) => item.trim()).filter(Boolean);
const unique = (values) => [...new Set(values.filter(Boolean))];

export function toServerReviewType(typeId) {
  if (SERVER_TYPES.has(typeId)) return typeId;
  return APP_TO_SERVER[typeId] || "systematic";
}

async function headers(projectId, extra = {}) {
  return cloudAuthEnabled() ? cloudAuthHeaders(projectId || activeProject(), extra) : extra;
}

export async function reviewApi(path, { method = "GET", body, projectId } = {}) {
  try {
    const extra = {};
    if (body !== undefined) extra["content-type"] = "application/json";
    const response = await fetch(`${REVIEW_API}${path}`, {
      method,
      headers: await headers(projectId, extra),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? { ok: true, status: response.status, payload }
      : { ok: false, status: response.status, payload, error: payload?.error || `Review service HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export function buildReviewRequest(review) {
  if (!review?.question) throw new Error("A saved review question is required before server execution.");
  const prism = review.protocol?.prism?.facets || {};
  const pico = review.protocol?.pico || {};
  const populationTerms = tokens(prism.population || pico.population);
  const interventionTerms = tokens(prism.intervention || pico.intervention);
  const comparatorTerms = tokens(prism.standard || pico.comparator);
  const outcomeTerms = tokens(prism.measure || pico.outcomes);
  const designTerms = tokens(prism.design || pico.studyDesign);
  const sourceIds = review.selectedSources?.length ? review.selectedSources : ["pubmed", "europepmc", "clinicaltrials.gov"];
  const databases = unique(sourceIds.map((source) => DATABASE_NAMES[String(source).toLowerCase()] || String(source)));
  const pressStatus = review.protocol?.press?.status || review.protocol?.prism?.press?.status;

  return {
    question: {
      title: String(review.question).slice(0, 240),
      objective: String(review.objective || review.question),
      population: populationTerms.join(" OR ") || undefined,
      interventionOrExposure: interventionTerms.join(" OR ") || undefined,
      comparator: comparatorTerms.join(" OR ") || undefined,
      outcomes: outcomeTerms.length ? outcomeTerms : undefined,
      studyDesigns: designTerms.length ? designTerms : undefined,
      concepts: unique([...populationTerms, ...interventionTerms, ...outcomeTerms]),
    },
    reviewType: toServerReviewType(review.methodology?.typeId || review.reviewType || "systematic"),
    databases,
    autoApproveHumanGates: false,
    dualScreening: true,
    targetReport: review.targetReport || "PRISMA 2020 systematic review report",
    humanVerification: { enabled: true, mode: "blinded", requireAllItems: true },
    protocolDevelopment: {
      searchPeerReviewRequired: true,
      searchPeerReviewCompleted: pressStatus === "pass" || pressStatus === "passed",
      protocolVersion: String(review.protocol?.version || "0.1.0"),
    },
    registration: {
      enabled: true,
      targets: ["prospero", "osf", "zenodo", "github"],
      submissionMode: "prepare-only",
      requireAuthenticatedOrcid: true,
    },
  };
}

export async function createReviewRun(review, { projectId = activeProject(), searchPeerReviewCompleted } = {}) {
  const request = buildReviewRequest(review);
  if (typeof searchPeerReviewCompleted === "boolean") {
    request.protocolDevelopment.searchPeerReviewCompleted = searchPeerReviewCompleted;
  }
  const result = await reviewApi("/runs", { method: "POST", body: request, projectId });
  return { ...result, request, state: result.payload };
}

export async function getReviewRun(runId, projectId = activeProject()) {
  const result = await reviewApi(`/runs/${encodeURIComponent(runId)}`, { projectId });
  return { ...result, state: result.payload };
}

export function activeHumanGate(state) {
  return Object.entries(state?.stages || {}).find(([, stage]) => stage?.status === "awaiting-human")?.[0] || null;
}

export function isRunAtRest(state) {
  const stages = Object.values(state?.stages || {});
  if (!stages.length) return false;
  if (stages.some((stage) => stage.status === "failed" || stage.status === "awaiting-human")) return true;
  return stages.every((stage) => ["passed", "skipped"].includes(stage.status));
}

export async function pollReviewRun(runId, { projectId = activeProject(), onUpdate, intervalMs = 2500, timeoutMs = 30 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await getReviewRun(runId, projectId);
    if (!result.ok) return result;
    onUpdate?.(result.state);
    if (isRunAtRest(result.state)) return result;
    if (Date.now() >= deadline) return { ...result, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function protocolGateRoute(state) {
  const grade = state?.artifacts?.gradePolicyRequirement;
  const publication = state?.artifacts?.publicationBiasUniversePolicyRequirement;
  if (grade?.status === "required") return { kind: "grade-policy", path: "/grade/policy" };
  if (publication?.status === "required") return { kind: "publication-bias-policy", path: "/grade/publication-bias-policy" };
  if (publication?.status === "search-plan-incompatible") return { kind: "publication-bias-search", path: "/grade/publication-bias-search" };
  return { kind: "protocol-finalisation", path: "/protocol" };
}

export function gateRoute(state) {
  const stage = activeHumanGate(state);
  if (!stage) return null;
  if (stage === "question") return { stage, kind: "clarification", path: "/clarification" };
  if (stage === "protocol-finalise") return { stage, ...protocolGateRoute(state) };
  if (stage === "risk-of-bias") return { stage, kind: "risk-of-bias", path: "/risk-of-bias" };
  if (stage === "grade") {
    if (state?.artifacts?.registryUniverseReviewPackage) return { stage, kind: "registry-universe", path: "/grade/registry-universe" };
    return { stage, kind: "grade-evidence", path: "/grade" };
  }
  if (stage === "human-verify") return { stage, kind: "verification", path: "/verification" };
  if (stage === "register-protocol") return { stage, kind: "registration", path: "/registration" };
  return { stage, kind: stage, path: null };
}

export async function getGatePackage(runId, state, projectId = activeProject()) {
  const route = gateRoute(state);
  if (!route) return { ok: false, error: "No active human gate." };
  if (!route.path) return { ok: true, route, payload: state?.artifacts || {} };
  const result = await reviewApi(`/runs/${encodeURIComponent(runId)}${route.path}`, { projectId });
  return { ...result, route };
}

export async function submitGate(runId, state, submission, projectId = activeProject()) {
  const route = gateRoute(state);
  if (!route?.path || route.kind === "registration" || route.kind === "protocol-finalisation") {
    return { ok: false, error: `The active ${route?.kind || "unknown"} gate has no direct submission endpoint.` };
  }
  const result = await reviewApi(`/runs/${encodeURIComponent(runId)}${route.path}`, {
    method: "POST",
    body: submission,
    projectId,
  });
  return { ...result, route, state: result.payload?.state || result.payload };
}

export async function reviewServiceHealth() {
  try {
    const response = await fetch(`${REVIEW_API}/health`);
    return { ok: response.ok, status: response.status, payload: await response.json().catch(() => ({})) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export const reviewApiConfig = Object.freeze({ baseUrl: REVIEW_API });
