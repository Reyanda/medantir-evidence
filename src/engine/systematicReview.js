// systematicReview.js — local LLM-powered systematic review stage assists.
// Every function takes structured inputs, routes through taskRouter to the best
// local engine, and returns structured JSON suitable for direct consumption by
// reviewengine.js object stores. If no local engine is available, every function
// returns a graceful fallback (manual entry prompt) so the review is never blocked.

import { routeTask, executeTask } from "./taskRouter.js";

// ---------------------------------------------------------------------------
// Helper — check if executeTask returned a usable local result
// ---------------------------------------------------------------------------

function isAvailable(result) {
  return result && result.result !== null && result.source !== "none" && result.engine !== "none";
}

function engineName(result) {
  return result?.engine || "manual";
}

// ---------------------------------------------------------------------------
// 1. PICO structuring — extract population, intervention, comparator, outcomes
//    from a natural-language review question. Used in the Protocol stage.
// ---------------------------------------------------------------------------

export async function extractPICO(question) {
  const prompt = `You are a clinical epidemiologist. Extract PICO elements from the following review question. Return ONLY valid JSON with keys: population, intervention, comparator, outcomes (array of strings), studyDesigns (array of strings like "RCT", "cohort"). If an element is not stated, use null.\n\nQuestion: ${question}`;

  try {
    const result = await executeTask("extract-pico", prompt, { responseFormat: "json" });
    if (!isAvailable(result)) return { ...picoFallback(question), _engine: "manual" };
    return { ...parseJSON(result.result, picoFallback(question)), _engine: engineName(result) };
  } catch {
    return { ...picoFallback(question), _engine: "manual" };
  }
}

function picoFallback(question) {
  return { population: null, intervention: null, comparator: null, outcomes: [], studyDesigns: [], _parseFailed: true };
}

// ---------------------------------------------------------------------------
// 2. Eligibility criteria generation — given PICO, produce inclusion/exclusion
//    criteria text. Used in the Protocol stage.
// ---------------------------------------------------------------------------

export async function generateEligibility(pico) {
  const prompt = `You are a systematic review methodologist. Given the following PICO elements, generate structured eligibility criteria.\n\nPICO: ${JSON.stringify(pico)}\n\nReturn ONLY valid JSON with keys:\n- inclusion: array of { criterion: string, rationale: string }\n- exclusion: array of { criterion: string, rationale: string }\nInclude at minimum: population, intervention, comparators, outcomes, study design, setting, and language criteria.`;

  try {
    const result = await executeTask("generate-eligibility", prompt, { responseFormat: "json" });
    if (!isAvailable(result)) return { inclusion: [], exclusion: [], _engine: "manual" };
    return { ...parseJSON(result.result, { inclusion: [], exclusion: [] }), _engine: engineName(result) };
  } catch {
    return { inclusion: [], exclusion: [], _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 3. Title/Abstract screening — classify a single record as include/exclude/
//    uncertain against eligibility criteria. Returns a structured verdict
//    with reason and confidence.
// ---------------------------------------------------------------------------

export async function screenTIAB(record, eligibility, options = {}) {
  const title = String(record.title || "").trim();
  const abstract = String(record.abstract || "").trim();

  const prompt = `You are a systematic review screener. Classify this record against the eligibility criteria.\n\nEligibility:\n${eligibility}\n\nRecord:\nTitle: ${title}\nAbstract: ${abstract}\n\nReturn ONLY valid JSON:\n{\n  "decision": "include" | "exclude" | "uncertain",\n  "reason": "brief reason matching an exclusion criterion or rationale for include",\n  "confidence": 0.0-1.0,\n  "matchedCriteria": ["which criteria this record meets"]\n}`;

  try {
    const result = await executeTask("tiab-screening", prompt, { responseFormat: "json", maxTokens: 200 });
    if (!isAvailable(result)) return { decision: "uncertain", reason: "", confidence: 0, matchedCriteria: [], _engine: "manual" };
    const parsed = parseJSON(result.result, { decision: "uncertain", reason: "", confidence: 0, matchedCriteria: [] });
    if (!["include", "exclude", "uncertain"].includes(parsed.decision)) parsed.decision = "uncertain";
    return { ...parsed, _engine: engineName(result) };
  } catch {
    return { decision: "uncertain", reason: "", confidence: 0, matchedCriteria: [], _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 4. Batch TIAB screening — screen multiple records. Uses batch classification
//    for Transformers.js (fast) or sequential if WebLLM.
// ---------------------------------------------------------------------------

export async function screenTIABBatch(records, eligibility, { onProgress } = {}) {
  const tasks = records.map((rec, i) => ({
    id: rec.id || String(i),
    text: `${rec.title || ""} ${rec.abstract || ""}`.trim(),
    label: null,
    meta: rec,
  }));

  const prompt = `Classify each record as "include", "exclude", or "uncertain" against these criteria:\n${eligibility}`;

  const result = await executeTask("tiab-screening", prompt, {
    batch: true,
    tasks,
    onProgress,
  });

  if (result.engine === "manual") {
    return { results: records.map(() => ({ decision: "uncertain", _engine: "manual" })), engine: "manual" };
  }

  return {
    results: result.results || records.map(() => ({ decision: "uncertain", _engine: result.engine })),
    engine: result.engine,
    latencyMs: result.latencyMs,
  };
}

// ---------------------------------------------------------------------------
// 5. Full-text screening — given the full text (or a large excerpt), determine
//    eligibility with detailed exclusion reasons mapped to criteria.
// ---------------------------------------------------------------------------

export async function screenFullText(fullText, eligibility, recordMeta = {}) {
  const excerpt = fullText.slice(0, 6000);
  const prompt = `You are a systematic review full-text screener. Determine if this study meets the eligibility criteria.\n\nEligibility:\n${eligibility}\n\nStudy record:\nTitle: ${recordMeta.title || "N/A"}\nAuthors: ${recordMeta.authors || "N/A"}\nYear: ${recordMeta.year || "N/A"}\n\nFull text excerpt:\n${excerpt}\n\nReturn ONLY valid JSON:\n{\n  "decision": "include" | "exclude",\n  "reason": "if excluded, map to a specific exclusion criterion",\n  "exclusionCriterion": "the exact criterion text if excluded, else null",\n  "confidence": 0.0-1.0,\n  "notes": "any methodological observations"\n}`;

  try {
    const result = await executeTask("fulltext-screening", prompt, { responseFormat: "json", maxTokens: 300 });
    if (!isAvailable(result)) return { decision: "exclude", reason: "manual review required", exclusionCriterion: null, confidence: 0, notes: "", _engine: "manual" };
    return { ...parseJSON(result.result, { decision: "exclude", reason: "", exclusionCriterion: null, confidence: 0, notes: "" }), _engine: engineName(result) };
  } catch {
    return { decision: "exclude", reason: "manual review required", exclusionCriterion: null, confidence: 0, notes: "", _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 6. PICO data extraction — extract structured data from a study's full text.
//    Returns population characteristics, intervention details, outcomes, and
//    effect estimates.
// ---------------------------------------------------------------------------

export async function extractStudyData(fullText, studyMeta = {}, pico = {}) {
  const excerpt = fullText.slice(0, 8000);
  const prompt = `You are a clinical data extractor. Extract structured study data from the following text.\n\nExpected PICO framework:\n${JSON.stringify(pico)}\n\nStudy: ${studyMeta.title || "N/A"} (${studyMeta.year || "N/A"})\n\nFull text excerpt:\n${excerpt}\n\nReturn ONLY valid JSON:\n{\n  "population": { "description": string, "n": number|null, "age": string|null, "sex": string|null, "setting": string|null, "country": string|null },\n  "intervention": { "description": string, "dose": string|null, "duration": string|null, "delivery": string|null },\n  "comparator": { "description": string, "type": "placebo"|"active"|"usual-care"|"none"|null },\n  "outcomes": [{ "name": string, "type": "primary"|"secondary", "measure": string, "result": string, "ci": string|null, "effectEstimate": number|null, "effectMeasure": string|null }],\n  "studyDesign": string,\n  "riskOfBias": "low"|"moderate"|"high"|"unclear"|null,\n  "funding": string|null,\n  "limitations": [string]\n}`;

  try {
    const result = await executeTask("extract-data", prompt, { responseFormat: "json", maxTokens: 800 });
    if (!isAvailable(result)) return { _engine: "manual", _extractionFailed: true };
    return { ...parseJSON(result.result, { _extractionFailed: true }), _engine: engineName(result) };
  } catch {
    return { _engine: "manual", _extractionFailed: true };
  }
}

// ---------------------------------------------------------------------------
// 7. Risk of bias assessment — assess a study using a specified RoB tool.
//    Supports RoB 2 (for Rcts), ROBINS-I (for non-randomised), QUIPS
//    (prognostic), and QUADAS-2 (diagnostic).
// ---------------------------------------------------------------------------

export async function assessRoB(fullText, studyMeta = {}, tool = "rob2") {
  const toolPrompts = {
    rob2: `Assess using RoB 2 (Cochrane). Domains: randomisation, deviations, missing data, outcome measurement, selective reporting. For each domain judge: "low", "some concerns", or "high". Overall: "low risk" if all low, "some concerns" if any some-concerns, "high risk" if any high.`,
    robins_i: `Assess using ROBINS-I (Cochrane). Domains: confounding, selection, classification, deviations, missing data, outcome measurement, selective reporting. For each: "low", "moderate", "serious", "critical", "no information".`,
    quipS: `Assess using QUIPS (prognostic). Domains: study participation, study attrition, prognostic factor measurement, outcome measurement, confounding, statistical analysis.`,
    quadas2: `Assess using QUADAS-2 (diagnostic). Domains: patient selection, index test, reference standard, flow and timing.`,
  };

  const excerpt = fullText.slice(0, 6000);
  const prompt = `You are a methodologist performing risk of bias assessment.\n\nTool: ${tool.toUpperCase()}\n${toolPrompts[tool] || toolPrompts.rob2}\n\nStudy: ${studyMeta.title || "N/A"} (${studyMeta.year || "N/A"})\n\nFull text excerpt:\n${excerpt}\n\nReturn ONLY valid JSON:\n{\n  "tool": "${tool}",\n  "domains": [{ "name": string, "judgement": string, "supportForJudgement": string }],\n  "overallJudgement": "low risk"|"some concerns"|"high risk"|"moderate"|"serious"|"critical",\n  "rationale": "brief overall rationale"\n}`;

  try {
    const result = await executeTask("assess-rob", prompt, { responseFormat: "json", maxTokens: 500 });
    if (!isAvailable(result)) return { tool, domains: [], overallJudgement: "unclear", rationale: "", _engine: "manual" };
    return { ...parseJSON(result.result, { tool, domains: [], overallJudgement: "unclear", rationale: "" }), _engine: engineName(result) };
  } catch {
    return { tool, domains: [], overallJudgement: "unclear", rationale: "", _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 8. Narrative synthesis assist — given extracted data from multiple studies,
//    produce a structured narrative synthesis by outcome.
// ---------------------------------------------------------------------------

export async function narrativeSynthesis(studies, outcomes) {
  const prompt = `You are a systematic review methodologist producing a narrative synthesis.\n\nStudies (extracted data):\n${JSON.stringify(studies.slice(0, 20))}\n\nOutcomes of interest:\n${JSON.stringify(outcomes)}\n\nProduce a structured narrative synthesis. Return ONLY valid JSON:\n{\n  "synthesisByOutcome": [{\n    "outcome": string,\n    "studies": [{ "id": string, "finding": string, "effectEstimate": string|null }],\n    "direction": "favors-intervention"|"favors-comparator"|"mixed"|"no-difference",\n    "certainty": "high"|"moderate"|"low"|"very-low",\n    "narrative": "2-3 sentence summary"\n  }],\n  "overallConclusion": string,\n  "heterogeneity": "low"|"moderate"|"high",\n  "limitations": [string]\n}`;

  try {
    const result = await executeTask("synthesize", prompt, { responseFormat: "json", maxTokens: 1500 });
    if (!isAvailable(result)) return { synthesisByOutcome: [], overallConclusion: "", _engine: "manual" };
    return { ...parseJSON(result.result, { synthesisByOutcome: [], overallConclusion: "" }), _engine: engineName(result) };
  } catch {
    return { synthesisByOutcome: [], overallConclusion: "", _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 9. GRADE certainty assessment — rate certainty per outcome using GRADE
//    domains (risk of bias, inconsistency, indirectness, imprecision, publication bias).
// ---------------------------------------------------------------------------

export async function gradeCertainty(outcomeData) {
  const prompt = `You are a GRADE methodologist. Rate the certainty of evidence for the following outcome.\n\nOutcome data:\n${JSON.stringify(outcomeData)}\n\nGRADE domains: risk of bias, inconsistency, indirectness, imprecision, publication bias.\n\nReturn ONLY valid JSON:\n{\n  "outcome": string,\n  "initialCertainty": "high",\n  "domains": {\n    "riskOfBias": { "rating": "no-change"|"serious"|"very-serious", "reason": string },\n    "inconsistency": { "rating": "no-change"|"serious"|"very-serious", "reason": string },\n    "indirectness": { "rating": "no-change"|"serious"|"very-serious", "reason": string },\n    "imprecision": { "rating": "no-change"|"serious"|"very-serious", "reason": string },\n    "publicationBias": { "rating": "no-change"|"undetected"|"suspected", "reason": string }\n  },\n  "finalCertainty": "high"|"moderate"|"low"|"very-low",\n  "upgradeConsiderations": [{ "factor": string, "reason": string }],\n  "summaryOfFindings": string\n}`;

  try {
    const result = await executeTask("grade-assessment", prompt, { responseFormat: "json", maxTokens: 500 });
    if (!isAvailable(result)) return { initialCertainty: "high", finalCertainty: "high", domains: {}, _engine: "manual" };
    return { ...parseJSON(result.result, { initialCertainty: "high", finalCertainty: "high", domains: {} }), _engine: engineName(result) };
  } catch {
    return { initialCertainty: "high", finalCertainty: "high", domains: {}, _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// 10. PRISMA flow numbers — given stage counts, generate the PRISMA flow
//     description text.
// ---------------------------------------------------------------------------

export async function generatePRISMAFlow(counts) {
  const prompt = `Given these systematic review counts, generate a concise PRISMA flow description.\n\n${JSON.stringify(counts)}\n\nReturn ONLY valid JSON:\n{\n  "identification": { "recordsIdentified": number, "duplicatesRemoved": number },\n  "screening": { "recordsScreened": number, "recordsExcluded": number, "exclusionReasons": [{ "reason": string, "count": number }] },\n  "included": { "studiesAssessed": number, "studiesExcluded": number, "exclusionReasons": [{ "reason": string, "count": number }], "studiesIncluded": number },\n  "narrative": "PRISMA flow summary in plain text"\n}`;

  try {
    const result = await executeTask("generate-prisma", prompt, { responseFormat: "json", maxTokens: 500 });
    if (!isAvailable(result) || result.engine === "manual") return { ...counts, narrative: "", _engine: "manual" };
    return { ...parseJSON(result.result, counts), _engine: result.engine };
  } catch {
    return { ...counts, narrative: "", _engine: "manual" };
  }
}

// ---------------------------------------------------------------------------
// Utility — safe JSON parse with fallback
// ---------------------------------------------------------------------------

function parseJSON(text, fallback) {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { ...fallback, _parseFailed: true, _raw: text };
  }
}

// ---------------------------------------------------------------------------
// Exports — capability map for the UI to show what local engines can do
// ---------------------------------------------------------------------------

export const SR_CAPABILITIES = [
  { id: "pico", label: "PICO extraction", engine: "transformers", stage: "protocol", description: "Extract population, intervention, comparator, outcomes from a review question" },
  { id: "eligibility", label: "Eligibility criteria", engine: "transformers", stage: "protocol", description: "Generate inclusion/exclusion criteria from PICO" },
  { id: "tiab", label: "Title/abstract screening", engine: "transformers", stage: "tiab", description: "Classify records as include/exclude/uncertain against eligibility criteria" },
  { id: "fulltext", label: "Full-text screening", engine: "webllm", stage: "fulltext", description: "Detailed full-text eligibility assessment" },
  { id: "extraction", label: "Data extraction", engine: "webllm", stage: "extraction", description: "Extract structured study data (PICO, outcomes, effect estimates)" },
  { id: "rob", label: "Risk of bias", engine: "webllm", stage: "rob", description: "Assess risk of bias using RoB 2, ROBINS-I, QUIPS, or QUADAS-2" },
  { id: "synthesis", label: "Narrative synthesis", engine: "webllm", stage: "synthesis", description: "Structured narrative synthesis by outcome" },
  { id: "grade", label: "GRADE certainty", engine: "webllm", stage: "grade", description: "Rate evidence certainty per GRADE domains" },
  { id: "prisma", label: "PRISMA flow", engine: "transformers", stage: "report", description: "Generate PRISMA flow numbers and narrative" },
];
