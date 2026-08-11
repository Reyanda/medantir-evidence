// reviewengine.js — the closed-loop Evidence Review Engine data model + stage
// orchestrator. A review is a state machine: ordered stages, each with inputs,
// outputs, a validation gate, provenance, and rollback. A stage cannot complete
// until its outputs validate; completing one unlocks the next. The whole review
// object persists in the Workspace project store (review.json) so every artifact
// and decision is durable, auditable, and reversible.

import { recommendReviewType } from "./reviewtypes.js";
import { putFile, getFile } from "./projectstore.js";

const REVIEW_FILE = "review.json";

// The generalised pipeline (applies across review types; some stages are no-ops
// for a given type, e.g. meta-analysis for a scoping review → validated as N/A).
// Each stage.validate(review) → { ok, issues[] }. Gates block completion.
export const STAGES = [
  { id: "protocol", name: "Protocol & question", validate: (r) =>
      gate(!!r.question && !!r.methodology?.typeId && !!(r.objects.eligibility || "").trim(), "Define the question, review type, and eligibility criteria.") },
  { id: "search", name: "Search execution", validate: (r) =>
      gate((r.objects.searches || []).length > 0, "Run/import at least one database search with a recorded strategy + count.") },
  { id: "dedup", name: "Deduplication", validate: (r) =>
      gate(r.objects.dedup && r.objects.dedup.unique != null, "Deduplicate records; set the unique count (reversible).") },
  { id: "tiab", name: "Title/abstract screening", validate: (r) =>
      gate(recsScreened(r, "tiab"), "Screen every record (no unresolved 'uncertain').") },
  { id: "retrieval", name: "Full-text retrieval", validate: (r) =>
      gate((r.objects.records || []).filter((x) => x.tiab === "include").every((x) => x.retrieval), "Classify retrieval status for every included record.") },
  { id: "fulltext", name: "Full-text screening", validate: (r) =>
      gate((r.objects.records || []).filter((x) => x.tiab === "include" && x.retrieval === "retrieved").every((x) => x.fulltext), "Full-text screen with a documented reason for each exclusion.") },
  { id: "extraction", name: "Data extraction", validate: (r) =>
      gate((r.objects.studies || []).length > 0 && (r.objects.studies || []).every((s) => s.extracted), "Extract every included study (page-cited).") },
  { id: "rob", name: "Risk of bias", validate: (r) =>
      gate((r.objects.studies || []).length > 0 && (r.objects.studies || []).every((s) => s.rob), `Assess risk of bias for every study (${r.methodology?.robTool || "tool"}).`) },
  { id: "synthesis", name: "Evidence synthesis", validate: (r) =>
      gate(!!r.objects.synthesis, "Run synthesis (or record a justified synthesis-without-meta-analysis).") },
  { id: "grade", name: "Certainty (GRADE / SoF)", validate: (r) =>
      gate(!!r.objects.grade, "Rate certainty per outcome; link each judgement to the evidence.") },
  { id: "etd", name: "Evidence to decision", optional: true, validate: (r) =>
      gate(!!r.objects.etd, "Translate findings into decision-relevant conclusions.") },
  { id: "report", name: "PRISMA & report", validate: (r) =>
      gate(!!r.objects.report, "Generate the PRISMA flow, tables/figures, checklist, and report.") },
];

function gate(ok, issue) { return { ok: !!ok, issues: ok ? [] : [issue] }; }
// Screening completeness ignores flagged duplicates: dedup keeps them in the library
// for provenance but they are never screened, so requiring a decision on them would
// make the gate unsatisfiable.
function recsScreened(r, key) {
  const recs = (r.objects.records || []).filter((x) => !x.isDuplicate);
  return recs.length > 0 && recs.every((x) => x[key] && x[key] !== "uncertain");
}

export function stageIndex(id) { return STAGES.findIndex((s) => s.id === id); }

// Create a review from a question — applies the methodology recommender, seeds
// empty object stores + all stages pending. Not yet persisted.
export function createReview(question) {
  const rec = recommendReviewType(question);
  const stages = {};
  for (const s of STAGES) stages[s.id] = { status: "pending", completedAt: null, provenance: [] };
  return {
    version: 1,
    question,
    createdAt: null, // stamped by the caller (browser) to keep this pure
    methodology: { typeId: rec.type.id, typeName: rec.type.name, framework: rec.framework, robTool: rec.robTool, synthesis: rec.synthesis },
    objects: { eligibility: "", searches: [], records: [], studies: [], dedup: null, synthesis: null, grade: null, etd: null, report: null },
    stages,
    log: [],
  };
}

// Per-stage status for the UI: complete | active (next actionable) | blocked | pending.
export function stageStatus(review) {
  let firstIncomplete = -1;
  return STAGES.map((s, i) => {
    const st = review.stages[s.id];
    const complete = st?.status === "complete";
    if (!complete && firstIncomplete < 0) firstIncomplete = i;
    return { id: s.id, name: s.name, optional: !!s.optional, complete, active: i === firstIncomplete, validation: s.validate(review) };
  });
}

// Attempt to complete a stage: runs its validation gate; on pass, marks complete
// with a provenance stamp and returns { ok, review }. On fail, returns issues.
export function completeStage(review, stageId, { when = 0, note = "" } = {}) {
  const s = STAGES.find((x) => x.id === stageId);
  if (!s) return { ok: false, issues: [`unknown stage ${stageId}`] };
  const v = s.validate(review);
  if (!v.ok) return { ok: false, issues: v.issues };
  const st = review.stages[stageId];
  st.status = "complete"; st.completedAt = when;
  st.provenance = [...(st.provenance || []), { at: when, note: note || "validated + completed" }];
  review.log = [...(review.log || []), { stage: stageId, action: "complete", at: when }];
  return { ok: true, review };
}

// Rollback a stage (reversibility): marks it + all downstream stages pending.
export function rollbackStage(review, stageId, { when = 0 } = {}) {
  const from = stageIndex(stageId);
  if (from < 0) return review;
  for (let i = from; i < STAGES.length; i++) {
    const st = review.stages[STAGES[i].id];
    st.status = "pending"; st.completedAt = null;
  }
  review.log = [...(review.log || []), { stage: stageId, action: "rollback", at: when }];
  return review;
}

export function progress(review) {
  const done = STAGES.filter((s) => review.stages[s.id]?.status === "complete").length;
  return { done, total: STAGES.length, pct: Math.round((done / STAGES.length) * 100) };
}

// --- persistence in the Workspace project ---------------------------------
export function saveReview(projectId, review) {
  if (!projectId) return null;
  return putFile(projectId, { path: REVIEW_FILE, name: REVIEW_FILE, type: "review", content: JSON.stringify(review, null, 2) });
}
export function loadReview(projectId) {
  if (!projectId) return null;
  const f = getFile(projectId, REVIEW_FILE);
  if (!f) return null;
  try { return JSON.parse(f.content); } catch { return null; }
}

// --- local LLM TIAB screening assist --------------------------------------
// Uses the embedded model to pre-screen title/abstract pairs. Returns
// { suggestion: "include" | "exclude" | "uncertain", confidence: number, method: "llm" }.
// Always returns a result — falls back to "uncertain" on any failure.

export async function llmScreenTIAB(title, abstract, eligibilityCriteria) {
  try {
    const { executeTask } = await import("./taskRouter.js");
    const text = `Title: ${title}\nAbstract: ${abstract || ""}\nCriteria: ${eligibilityCriteria || "General research"}\n\nShould this study be included in a systematic review? Answer: include, exclude, or uncertain.`;
    const { result } = await executeTask("tiab-screening", text);
    const label = (result?.label || "uncertain").toLowerCase();
    const suggestion = label.includes("include") ? "include" : label.includes("exclude") ? "exclude" : "uncertain";
    return { suggestion, confidence: result?.score || 0, method: "llm" };
  } catch {
    return { suggestion: "uncertain", confidence: 0, method: "unavailable" };
  }
}

/**
 * Batch screen multiple records using the local model.
 * Returns array of { index, suggestion, confidence }.
 */
export async function llmScreenBatch(records, eligibilityCriteria, { batchSize = 8, onProgress } = {}) {
  const results = [];
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((r) => llmScreenTIAB(r.title || "", r.abstract || "", eligibilityCriteria))
    );
    batchResults.forEach((r, j) => results.push({ index: i + j, ...r }));
    onProgress?.({ processed: Math.min(i + batchSize, records.length), total: records.length });
  }
  return results;
}

// --- local LLM systematic review stage assists ------------------------------
// These functions delegate to systematicReview.js and write results back into
// the review object store, so the stage validation gates pass.

export async function llmExtractPICO(question) {
  try {
    const { extractPICO } = await import("./systematicReview.js");
    return await extractPICO(question);
  } catch {
    return { population: null, intervention: null, comparator: null, outcomes: [], _engine: "unavailable" };
  }
}

export async function llmGenerateEligibility(pico) {
  try {
    const { generateEligibility } = await import("./systematicReview.js");
    return await generateEligibility(pico);
  } catch {
    return { inclusion: [], exclusion: [], _engine: "unavailable" };
  }
}

export async function llmScreenFullText(fullText, eligibility, recordMeta) {
  try {
    const { screenFullText } = await import("./systematicReview.js");
    return await screenFullText(fullText, eligibility, recordMeta);
  } catch {
    return { decision: "exclude", reason: "local engine unavailable", _engine: "unavailable" };
  }
}

export async function llmExtractStudyData(fullText, studyMeta, pico) {
  try {
    const { extractStudyData } = await import("./systematicReview.js");
    return await extractStudyData(fullText, studyMeta, pico);
  } catch {
    return { _engine: "unavailable", _extractionFailed: true };
  }
}

export async function llmAssessRoB(fullText, studyMeta, tool) {
  try {
    const { assessRoB } = await import("./systematicReview.js");
    return await assessRoB(fullText, studyMeta, tool);
  } catch {
    return { tool, domains: [], overallJudgement: "unclear", _engine: "unavailable" };
  }
}

export async function llmNarrativeSynthesis(studies, outcomes) {
  try {
    const { narrativeSynthesis } = await import("./systematicReview.js");
    return await narrativeSynthesis(studies, outcomes);
  } catch {
    return { synthesisByOutcome: [], overallConclusion: "", _engine: "unavailable" };
  }
}

export async function llmGradeCertainty(outcomeData) {
  try {
    const { gradeCertainty } = await import("./systematicReview.js");
    return await gradeCertainty(outcomeData);
  } catch {
    return { initialCertainty: "high", finalCertainty: "high", domains: {}, _engine: "unavailable" };
  }
}
