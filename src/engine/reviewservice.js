// reviewservice.js — client for the deployed Evidence Review Engine service
// (the closed-loop TS engine at api.actiora.com/review). The browser hands it a
// ReviewRequest; the service runs the full 21-stage pipeline server-side over
// live open-data sources and returns the PipelineState (stages + artifacts + audit).

import { activeProject } from "./projectstore.js";
import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";

const REVIEW_API = "https://api.actiora.com/review";

async function reviewHeaders(extra = {}) {
  return cloudAuthEnabled() ? cloudAuthHeaders(activeProject(), extra) : extra;
}

// The engine's 21 review-family vocabulary. Map the app's methodology-recommender
// type IDs (src/engine/reviewtypes.js) onto the engine's ReviewType union so each
// family routes to its own protocol, appraisal tools, synthesis mode, and certainty
// framework server-side. Unmapped IDs fall back to a general systematic review.
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
export function toServerReviewType(typeId) {
  if (SERVER_TYPES.has(typeId)) return typeId;
  return APP_TO_SERVER[typeId] || "systematic";
}

// Run modes map to how much autonomy the pipeline is granted. Intermediate
// methodological gates may be auto-approved in supervised/high-automation runs, but
// the terminal human-verification stage always demands a real human verdict — that
// is the review's accountability closure and is never bypassed.
const RUN_MODES = {
  manual: { autoApproveHumanGates: false, verify: true },
  assisted: { autoApproveHumanGates: false, verify: true },
  supervised: { autoApproveHumanGates: true, verify: true },
  autonomous: { autoApproveHumanGates: true, verify: true },
};

// Convert a common natural-language intervention question into enough structured
// PICO fields for the server search builder. The server still preserves the full
// question as the objective; this only prevents a one-shot run from reaching the
// search stage with no searchable concepts.
export function structureReviewQuestion(question, suppliedConcepts = []) {
  const text = String(question || "").trim().replace(/[?]+$/, "");
  const structured = { concepts: suppliedConcepts.filter(Boolean) };
  const lead = text.match(/^in\s+(.+?),\s*how\s+(?:do|does|did|are|is)\s+(.+)$/i);
  if (lead) {
    structured.population = lead[1].trim();
    let comparison = lead[2].trim();
    const outcome = comparison.match(/\s+(?:affect|influence|impact|change|improve|reduce|increase)\s+(.+)$/i);
    if (outcome) {
      structured.outcomes = outcome[1].split(/\s*(?:,|\band\b|\bor\b)\s*/i).map((value) => value.trim()).filter(Boolean);
      comparison = comparison.slice(0, outcome.index).trim();
    }
    const arms = comparison.split(/\s+(?:compared\s+with|compared\s+to|versus|vs\.?|relative\s+to)\s+/i);
    structured.interventionOrExposure = arms[0]?.trim();
    if (arms[1]) structured.comparator = arms.slice(1).join(" ").trim();
  }
  if (!structured.population && !structured.interventionOrExposure && !structured.concepts.length && text) {
    structured.concepts = [text];
  }
  return structured;
}

export async function runServerReview({ question, objective, reviewType, databases, population, intervention, concepts, mode = "supervised", verificationMode = "blinded" }) {
  const m = RUN_MODES[mode] || RUN_MODES.supervised;
  const structured = structureReviewQuestion(question, concepts || []);
  const request = {
    question: {
      title: (question || "").slice(0, 140),
      objective: objective || question || "",
      population: population || structured.population,
      interventionOrExposure: intervention || structured.interventionOrExposure,
      comparator: structured.comparator,
      outcomes: structured.outcomes,
      concepts: structured.concepts,
    },
    reviewType: toServerReviewType(reviewType),
    databases: databases && databases.length ? databases : ["europepmc", "openalex"],
    autoApproveHumanGates: m.autoApproveHumanGates,
    autonomous: mode === "autonomous",
    humanVerification: { enabled: m.verify, mode: verificationMode },
    protocolDevelopment: {
      searchPeerReviewRequired: true,
      searchPeerReviewCompleted: false,
      protocolVersion: "0.1.0",
    },
    // The live app prepares all registry-specific packages, but never submits
    // them without configured OAuth/vault/browser handoffs and human approval.
    registration: {
      enabled: true,
      targets: ["prospero", "osf", "zenodo", "github"],
      submissionMode: "prepare-only",
      requireAuthenticatedOrcid: true,
    },
  };
  try {
    const headers = await reviewHeaders({ "content-type": "application/json" });
    const res = await fetch(`${REVIEW_API}/runs`, {
      method: "POST", headers, body: JSON.stringify(request),
    });
    const state = await res.json();
    const failedStage = state?.stages && Object.entries(state.stages).find(([, stage]) => stage?.status === "failed");
    const stageErrors = failedStage?.[1]?.errors?.filter(Boolean)?.join("; ");
    const error = res.ok ? undefined : [
      `Review service HTTP ${res.status}`,
      state?.error,
      failedStage && `stage ${failedStage[0]}`,
      stageErrors,
    ].filter(Boolean).join(" — ");
    return { ok: res.ok, state, error, request, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e), request };
  }
}

// Fetch a completed run's state (stages + artifacts + audit) by id. This remains
// the application's internal owner view. Verifier/audit surfaces should use the
// constrained helpers below rather than receiving arbitrary run state.
export async function getServerRun(runId) {
  try {
    const res = await fetch(`${REVIEW_API}/runs/${encodeURIComponent(runId)}`, { headers: await reviewHeaders() });
    return { ok: res.ok, state: await res.json() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

async function getVerifierPath(runId, suffix = "") {
  try {
    const encodedRun = encodeURIComponent(runId);
    const path = suffix ? `/runs/${encodedRun}/verifier/${suffix}` : `/runs/${encodedRun}/verifier`;
    const res = await fetch(`${REVIEW_API}${path}`, { headers: await reviewHeaders() });
    const payload = await res.json();
    return res.ok
      ? { ok: true, payload, status: res.status }
      : { ok: false, error: payload?.error || `HTTP ${res.status}`, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Read-only, allowlisted independent-verifier surface. These calls never use the
// unrestricted PipelineState endpoint and cannot mutate a review.
export async function getRunVerifierBundle(runId) {
  const result = await getVerifierPath(runId);
  return result.ok ? { ok: true, verifier: result.payload } : result;
}

export async function getRunManifest(runId) {
  const result = await getVerifierPath(runId, "manifest");
  return result.ok ? { ok: true, manifest: result.payload } : result;
}

export async function getRunSeal(runId) {
  const result = await getVerifierPath(runId, "seal");
  return result.ok ? { ok: true, seal: result.payload } : result;
}

export async function getRunArtifactLineage(runId) {
  const result = await getVerifierPath(runId, "lineage");
  return result.ok ? { ok: true, lineage: result.payload } : result;
}

export async function getRunAttemptLedger(runId) {
  const result = await getVerifierPath(runId, "attempts");
  return result.ok ? { ok: true, ledger: result.payload } : result;
}

export async function getVerifierArtifact(runId, artifactKey) {
  const result = await getVerifierPath(runId, `artifacts/${encodeURIComponent(artifactKey)}`);
  return result.ok ? { ok: true, artifact: result.payload } : result;
}

// A run is at rest when every stage resolved, any stage failed, or the
// pipeline is parked at the human-verification gate awaiting a reviewer.
export function isRunTerminal(state) {
  const stages = Object.values(state?.stages || {});
  if (!stages.length) return false;
  if (stages.some((s) => s.status === "failed")) return true;
  if (state.stages["human-verify"]?.status === "awaiting-human") return true;
  return stages.every((s) => ["passed", "skipped"].includes(s.status));
}

// Poll a background run until it reaches a rest point. Runs execute server-side
// (POST /runs returns immediately), so the caller can navigate away and re-attach
// later with the same runId. onUpdate fires with each polled state for live
// progress rendering. Resolves { ok, state, timedOut } — never throws.
export async function pollServerRun(runId, { onUpdate, intervalMs = 4000, timeoutMs = 20 * 60 * 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await getServerRun(runId);
    if (!r.ok) return { ok: false, error: r.error };
    onUpdate?.(r.state);
    if (isRunTerminal(r.state)) return { ok: true, state: r.state };
    if (Date.now() > deadline) return { ok: true, state: r.state, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function getProtocolPackage(runId) {
  try {
    const res = await fetch(`${REVIEW_API}/runs/${encodeURIComponent(runId)}/protocol`, { headers: await reviewHeaders() });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, protocol: await res.json() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export async function getRegistrationArtifacts(runId) {
  try {
    const res = await fetch(`${REVIEW_API}/runs/${encodeURIComponent(runId)}/registration`, { headers: await reviewHeaders() });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, registration: await res.json() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Fetch the human-verification package (the items a reviewer must adjudicate).
// In blinded mode the package withholds AI verdicts so the reviewer judges evidence.
export async function getVerificationPackage(runId) {
  try {
    const res = await fetch(`${REVIEW_API}/runs/${encodeURIComponent(runId)}/verification`, { headers: await reviewHeaders() });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, package: await res.json() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Submit reviewer verdicts (accept/reject/amend/defer + rationale) to close or
// roll back the review. Every decision is recorded in the override ledger server-side.
export async function submitVerification(runId, submission) {
  try {
    const headers = await reviewHeaders({ "content-type": "application/json" });
    const res = await fetch(`${REVIEW_API}/runs/${encodeURIComponent(runId)}/verification`, {
      method: "POST", headers, body: JSON.stringify(submission),
    });
    return { ok: res.ok, state: await res.json() };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

export async function reviewServiceHealth() {
  try {
    const res = await fetch(`${REVIEW_API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
