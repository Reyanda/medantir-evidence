// forestModel.js — the pure dataset model behind the Forest Plot Studio canvas:
// how the pipeline's included studies become plot rows, and how those rows are
// pooled by the real statistical core. No storage, no DOM — unit-testable in node.
// The storage binding lives in forestRuntime.js.
//
// The canvas renders ONE outcome-level meta-analysis dataset that lives inside
// the review object (`review.objects.meta`), so it is persisted in the project's
// review.json alongside every other review artifact and survives reload.
//
// Rows are OWNED by the pipeline: every study the full-text stage included
// becomes a row. The pipeline cannot supply 2x2 cell counts (the extractor
// returns narrative outcome records, not contingency tables), so a synced row
// starts with EMPTY counts and is excluded from pooling until an operator or a
// structured extraction fills them. Nothing is invented to make the plot look
// populated — a row without counts is reported as such.

import { effectFromBinary, metaAnalyze } from "./metaanalysis.js";

export const META_VERSION = 1;
export const ROB_LEVELS = ["Low", "Some", "High", "Unclear"];

// Colour is reserved for meaning: a judgement band, never decoration.
const ROB_COLOR = {
  Low: "#3fb950",
  Some: "#d29922",
  High: "#f0796a",
  Unclear: "#6a6a6e",
};

export function robColor(rob) {
  return ROB_COLOR[rob] || ROB_COLOR.Unclear;
}

// RoB 2 / ROBINS-I / QUADAS-2 overall judgements → the three studio bands.
export function robLevel(study) {
  const judgement = String(study?.rob?.overallJudgement || "").toLowerCase();
  if (!judgement) return "Unclear";
  if (judgement.includes("low")) return "Low";
  if (judgement.includes("some") || judgement.includes("moderate")) return "Some";
  if (judgement.includes("high") || judgement.includes("serious") || judgement.includes("critical")) return "High";
  return "Unclear";
}

// --- dataset model ---------------------------------------------------------

export function emptyOutcome(name = "Primary outcome", id = "outcome_1") {
  return { id, name, measure: "RR", model: "random", rows: [] };
}

export function emptyDataset() {
  const outcome = emptyOutcome();
  return { version: META_VERSION, activeOutcomeId: outcome.id, outcomes: [outcome] };
}

// Reads the dataset off a review, tolerating an absent or malformed block.
export function readDataset(review) {
  const raw = review?.objects?.meta;
  if (!raw || !Array.isArray(raw.outcomes) || raw.outcomes.length === 0) return emptyDataset();
  const outcomes = raw.outcomes.map((o, i) => ({
    id: o.id || `outcome_${i + 1}`,
    name: o.name || `Outcome ${i + 1}`,
    measure: o.measure === "OR" ? "OR" : "RR",
    model: o.model === "fixed" ? "fixed" : "random",
    rows: Array.isArray(o.rows) ? o.rows.map(normaliseRow) : [],
  }));
  const activeOutcomeId = outcomes.some((o) => o.id === raw.activeOutcomeId) ? raw.activeOutcomeId : outcomes[0].id;
  return { version: META_VERSION, activeOutcomeId, outcomes };
}

function normaliseRow(row = {}) {
  const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    studyId: row.studyId || row.id || null,
    label: row.label || row.name || "Untitled study",
    eventsT: num(row.eventsT),
    totalT: num(row.totalT),
    eventsC: num(row.eventsC),
    totalC: num(row.totalC),
    rob: ROB_LEVELS.includes(row.rob) ? row.rob : "Unclear",
    robOverride: !!row.robOverride,
    include: row.include !== false,
    source: row.source === "manual" ? "manual" : "runtime",
    detached: !!row.detached,
    pmid: row.pmid || null,
    doi: row.doi || null,
    year: row.year || null,
    color: row.color || null,
  };
}

export function writeDataset(review, dataset) {
  return { ...review, objects: { ...review?.objects, meta: dataset } };
}

export function activeOutcome(dataset) {
  return dataset.outcomes.find((o) => o.id === dataset.activeOutcomeId) || dataset.outcomes[0];
}

export function updateOutcome(dataset, outcomeId, patch) {
  return {
    ...dataset,
    outcomes: dataset.outcomes.map((o) => (o.id === outcomeId ? { ...o, ...patch } : o)),
  };
}

// --- pipeline → canvas sync ------------------------------------------------

// Brings the outcome's rows in line with the studies the pipeline has included.
// Additive and non-destructive: new included studies gain an empty row, rows
// whose study has disappeared are FLAGGED detached rather than deleted, and RoB
// is refreshed from the assessment unless the operator overrode it.
export function syncRowsFromReview(outcome, review) {
  const studies = review?.objects?.studies || [];
  const records = review?.objects?.records || [];
  const recordById = new Map(records.map((r) => [r.id, r]));
  const byStudy = new Map(outcome.rows.filter((r) => r.studyId).map((r) => [r.studyId, r]));

  const added = [];
  const rows = outcome.rows.map((row) => {
    if (row.source !== "runtime" || !row.studyId) return row;
    const study = studies.find((s) => s.id === row.studyId);
    if (!study) return { ...row, detached: true };
    return {
      ...row,
      detached: false,
      label: row.label && row.label !== "Untitled study" ? row.label : studyLabel(study),
      rob: row.robOverride ? row.rob : robLevel(study),
    };
  });

  for (const study of studies) {
    if (byStudy.has(study.id)) continue;
    const record = recordById.get(study.id);
    rows.push(normaliseRow({
      studyId: study.id,
      label: studyLabel(study),
      rob: robLevel(study),
      source: "runtime",
      pmid: record?.pmid || null,
      doi: study.doi || record?.doi || null,
      year: study.year || record?.year || null,
    }));
    added.push(study.id);
  }

  return { outcome: { ...outcome, rows }, added: added.length, detached: rows.filter((r) => r.detached).length };
}

export function studyLabel(study) {
  const first = String(study?.authors || "").split(/,| and /)[0].trim();
  const year = study?.year ? ` ${study.year}` : "";
  if (first) return `${first}${year}`;
  const title = String(study?.title || "").trim();
  return title ? `${title.slice(0, 48)}${title.length > 48 ? "…" : ""}` : study?.id || "Untitled study";
}

export function newManualRow(index = 0) {
  return normaliseRow({
    studyId: `manual_${index + 1}_${Math.abs(hash(`${index}`))}`,
    label: `New study ${index + 1}`,
    source: "manual",
    rob: "Unclear",
  });
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// --- computation -----------------------------------------------------------

export function rowIsAnalysable(row) {
  const cells = [row.eventsT, row.totalT, row.eventsC, row.totalC];
  if (cells.some((c) => c === null || !Number.isFinite(c))) return { ok: false, reason: "2x2 counts not extracted" };
  if (row.totalT <= 0 || row.totalC <= 0) return { ok: false, reason: "group total is zero" };
  if (row.eventsT < 0 || row.eventsC < 0) return { ok: false, reason: "negative event count" };
  if (row.eventsT > row.totalT || row.eventsC > row.totalC) return { ok: false, reason: "events exceed group total" };
  return { ok: true };
}

// Computes the outcome with the real statistical core. Returns the pooled model
// AND an explicit account of every row that could not enter it.
export function computeOutcome(outcome) {
  const measure = outcome.measure === "OR" ? "OR" : "RR";
  const excluded = [];
  const analysable = [];

  for (const row of outcome.rows) {
    if (row.detached) { excluded.push({ label: row.label, reason: "study no longer included by the pipeline" }); continue; }
    if (!row.include) { excluded.push({ label: row.label, reason: "excluded from this analysis by the operator" }); continue; }
    const check = rowIsAnalysable(row);
    if (!check.ok) { excluded.push({ label: row.label, reason: check.reason }); continue; }
    analysable.push(row);
  }

  if (analysable.length === 0) {
    return { ok: false, measure, reason: "No row carries a complete 2x2 table yet.", rows: [], excluded, k: 0 };
  }

  const prepared = analysable.map((row) => {
    const e = effectFromBinary(
      { events_t: row.eventsT, n_t: row.totalT, events_c: row.eventsC, n_c: row.totalC },
      measure
    );
    return { name: row.label, effect: e.effect, se: e.se };
  });

  const ma = metaAnalyze(prepared, { measure });
  if (!ma.ok) {
    return { ok: false, measure, reason: ma.error || "pooling failed", rows: [], excluded, k: 0 };
  }

  const model = outcome.model === "fixed" ? ma.fixed : ma.random;
  const rows = analysable.map((row, i) => {
    const calc = model.studies[i] || {};
    return {
      ...row,
      effect: calc.effect,
      lower: calc.ci?.[0],
      upper: calc.ci?.[1],
      weight: calc.weight,
      color: row.color || robColor(row.rob),
    };
  });

  return {
    ok: true,
    measure,
    modelName: outcome.model === "fixed" ? "Fixed effect (inverse variance)" : "Random effects (DerSimonian–Laird)",
    rows,
    excluded,
    k: ma.k,
    pooled: model,
    fixed: ma.fixed,
    random: ma.random,
    heterogeneity: ma.heterogeneity,
    nullLine: ma.nullLine,
    totals: {
      eventsT: analysable.reduce((a, r) => a + r.eventsT, 0),
      totalT: analysable.reduce((a, r) => a + r.totalT, 0),
      eventsC: analysable.reduce((a, r) => a + r.eventsC, 0),
      totalC: analysable.reduce((a, r) => a + r.totalC, 0),
    },
  };
}

export function outcomeToCsv(outcome, computed) {
  const head = [
    "outcome", "measure", "model", "study", "study_id", "source", "events_t", "total_t", "events_c", "total_c",
    "effect", "ci_lower", "ci_upper", "weight_pct", "risk_of_bias", "pmid", "doi", "status",
  ];
  const byId = new Map((computed.rows || []).map((r) => [r.studyId, r]));
  const lines = outcome.rows.map((row) => {
    const calc = byId.get(row.studyId);
    const status = calc ? "pooled" : (computed.excluded.find((e) => e.label === row.label)?.reason || "not pooled");
    return [
      outcome.name, outcome.measure, outcome.model, row.label, row.studyId, row.source,
      row.eventsT, row.totalT, row.eventsC, row.totalC,
      calc?.effect ?? "", calc?.lower ?? "", calc?.upper ?? "", calc?.weight ?? "",
      row.rob, row.pmid || "", row.doi || "", status,
    ].map(csvCell).join(",");
  });
  if (computed.ok) {
    lines.push([
      outcome.name, outcome.measure, outcome.model, "POOLED", "", "",
      computed.totals.eventsT, computed.totals.totalT, computed.totals.eventsC, computed.totals.totalC,
      computed.pooled.effect, computed.pooled.ci[0], computed.pooled.ci[1], 100,
      "", "", "", `I2=${computed.heterogeneity.I2}%; Q=${computed.heterogeneity.Q}; df=${computed.heterogeneity.df}; p=${computed.heterogeneity.pQ}`,
    ].map(csvCell).join(","));
  }
  return [head.join(","), ...lines].join("\n");
}

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

