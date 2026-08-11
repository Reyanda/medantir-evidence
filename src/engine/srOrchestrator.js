import { STAGES, stageIndex, completeStage, rollbackStage, saveReview, loadReview, progress } from "./reviewengine.js";
import { extractPICO, generateEligibility, screenTIAB, screenTIABBatch, screenFullText, extractStudyData, assessRoB, narrativeSynthesis, gradeCertainty, generatePRISMAFlow } from "./systematicReview.js";
import { executeCompiledStrategies, executeSearches, toCsv, toRis, troubleshoot } from "./reviewsearch.js";
import { STRATEGY_DBS, buildStrategy, conceptsFromPico } from "./searchStrategy.js";
import { deduplicate } from "./dedup.js";
import { putFile, getFile } from "./projectstore.js";

const REVIEW_FILE = "review.json";

function fmtEligibility(review) {
  const e = review?.objects?.eligibility || "";
  const pico = review?.protocol?.pico || {};
  const parts = [e];
  if (pico.population) parts.push(`Population: ${pico.population}`);
  if (pico.intervention) parts.push(`Intervention: ${pico.intervention}`);
  if (pico.outcomes?.length) parts.push(`Outcomes: ${pico.outcomes.join(", ")}`);
  return parts.filter(Boolean).join("\n");
}

// Records a stage still has work on. Duplicates are flagged, not deleted, so every
// selection below excludes them — a duplicate must never be screened twice.
// The ISR the operator built and executed in the Search Strategy builder. Reading
// it here is what keeps the builder and the automated pipeline on one strategy.
function savedIsr(projectId) {
  if (!projectId) return null;
  try {
    const file = getFile(projectId, "search/isr.json");
    return file?.content ? JSON.parse(file.content) : null;
  } catch {
    return null; // a corrupt or hand-edited ISR falls back to PICO derivation
  }
}

function recordsByStage(review, stageId) {
  const recs = (review?.objects?.records || []).filter((r) => !r.isDuplicate);
  if (stageId === "tiab") return recs.filter((r) => !r.tiab || r.tiab === "uncertain");
  if (stageId === "fulltext") return recs.filter((r) => r.tiab === "include" && r.retrieval === "retrieved" && !r.fulltext);
  return [];
}

function studiesForExtraction(review) {
  return (review?.objects?.studies || []).filter((s) => !s.extracted);
}

function eligibleStudies(review) {
  return (review?.objects?.records || []).filter((r) => !r.isDuplicate && (r.fulltext?.decision === "include" || r.tiab === "include"));
}

function stageCanRun(review, stageId) {
  const s = review?.stages?.[stageId];
  if (!s || s.status === "complete") return { ok: false, reason: "already complete" };
  const idx = stageIndex(stageId);
  if (idx < 0) return { ok: false, reason: "unknown stage" };
  for (let i = 0; i < idx; i++) {
    // Optional stages (evidence-to-decision) are human-judgement artifacts with no
    // automated producer. Requiring them would make every downstream stage —
    // including the PRISMA report — permanently unreachable.
    if (STAGES[i].optional) continue;
    const prev = review.stages[STAGES[i].id];
    if (prev?.status !== "complete") return { ok: false, reason: `${STAGES[i].name} must be completed first` };
  }
  return { ok: true };
}

export function pipelinePlan(review) {
  return STAGES.map((s) => {
    const st = review?.stages?.[s.id];
    const can = stageCanRun(review, s.id);
    return { id: s.id, name: s.name, optional: !!s.optional, status: st?.status || "pending", blocked: !can.ok, blockReason: can.reason, validation: s.validate(review) };
  });
}

export async function runStage(projectId, review, stageId, { onProgress, onNote } = {}) {
  const can = stageCanRun(review, stageId);
  if (!can.ok) return { ok: false, reason: can.reason };

  const notify = (msg) => { onNote?.(msg); };
  const emitProgress = (pct, msg) => { onProgress?.({ stage: stageId, pct, msg }); };

  try {
    let reviewOut = { ...review };
    const eligibility = fmtEligibility(review);

    switch (stageId) {
      case "protocol": {
        notify("Extracting PICO from question…");
        const pico = await extractPICO(review.question);
        reviewOut.protocol = { ...reviewOut.protocol, pico };
        emitProgress(40, "PICO extracted");

        notify("Generating eligibility criteria…");
        const criteria = await generateEligibility(pico);
        const criteriaText = [
          ...(criteria.inclusion || []).map((c) => `INCLUDE: ${c.criterion}${c.rationale ? ` (${c.rationale})` : ""}`),
          ...(criteria.exclusion || []).map((c) => `EXCLUDE: ${c.criterion}${c.rationale ? ` (${c.rationale})` : ""}`),
        ].join("\n");
        reviewOut.objects = { ...reviewOut.objects, eligibility: criteriaText || reviewOut.objects.eligibility };
        reviewOut.protocol = { ...reviewOut.protocol, criteria };
        emitProgress(70, "Eligibility criteria generated");

        // Resolve the ISR so the search stage compiles a per-database Boolean
        // strategy instead of pushing the raw question at every API as free text.
        // Precedence: an ISR already on the review, then one the operator built and
        // saved in the Search Strategy builder, then a minimal ISR derived from PICO.
        if (!(reviewOut.protocol.concepts || []).length) {
          const saved = savedIsr(projectId);
          if (saved?.concepts?.length) {
            reviewOut.protocol = { ...reviewOut.protocol, concepts: saved.concepts, strategySource: "search/isr.json" };
            notify(`Using the peer-reviewable strategy saved in the Search Strategy builder (${saved.concepts.length} concepts).`);
          } else {
            const derived = conceptsFromPico(pico);
            reviewOut.protocol = { ...reviewOut.protocol, concepts: derived.concepts, strategyNotes: derived.notes, suggestedOutcomeTerms: derived.suggestedOutcomeTerms, strategySource: "pico" };
            derived.notes.forEach(notify);
          }
        }
        emitProgress(90, `Search concepts ready (${(reviewOut.protocol.concepts || []).length})`);
        break;
      }

      case "search": {
        const q = reviewOut.searchQuery || reviewOut.question || "";
        const sources = reviewOut.selectedSources || [];
        if (sources.length === 0) return { ok: false, reason: "No search sources selected" };
        const today = new Date().toISOString().slice(0, 10);
        const maxRecords = Number(reviewOut.maxRecordsPerSource) || 1000;

        // A compiled per-database strategy whenever an ISR exists; free text only
        // as an explicitly-recorded fallback. Free-text retrieval across APIs is
        // not a systematic search and the provenance must not imply that it is.
        const concepts = (reviewOut.protocol?.concepts || []).filter((concept) => (concept.terms || []).some((term) => (term || "").trim()));
        let res;
        let mode;
        if (concepts.length) {
          // Sources may be legacy identifiers OR { platform, database } targets
          // discovered behind a gateway. Filtering to the built-in list dropped
          // every detected database and then reported it as having no compiled
          // syntax — which stopped being true once the compiler took the pair.
          const detectedTargets = savedIsr(projectId)?.detectedTargets || [];
          const compilable = [
            ...sources.filter((source) => typeof source === "object" && source?.platform),
            ...sources.filter((source) => typeof source === "string" && STRATEGY_DBS.includes(source)),
            ...detectedTargets,
          ];
          const strategies = buildStrategy(concepts, compilable);
          const unsupported = sources.filter((source) => typeof source === "string" && !STRATEGY_DBS.includes(source));
          notify(`Executing compiled strategies across ${strategies.length} database(s)…`);
          res = await executeCompiledStrategies(strategies, { n: maxRecords, limits: reviewOut.searchLimits || [] });
          mode = "compiled";
          if (unsupported.length) {
            res.searches.push(...unsupported.map((id) => ({
              db: id, name: id, query: q, searchedAt: new Date().toISOString(), count: 0, hitCount: null,
              status: "error", fidelity: "none", warnings: [], limits: [],
              error: "No compiled syntax is registered for this source, so it was not searched.",
            })));
          }
        } else {
          notify(`No search concepts defined — running the review question as free text across ${sources.length} source(s).`);
          res = await executeSearches(q, sources, { n: maxRecords, date: today });
          mode = "free-text";
          res.summary = { ...res.summary, warnings: ["Executed as free text: no ISR was defined, so this is a scoping search and not a reportable systematic search."] };
        }

        reviewOut.objects = {
          ...reviewOut.objects,
          searches: res.searches,
          records: res.records || [],
          prismaS: res.prismaS || null,
        };
        reviewOut.searchSummary = { ...res.summary, mode, executedAt: today };
        const flagged = (res.summary.flagged || []).length;
        emitProgress(50, `${(res.records || []).length} unique records from ${res.searches.length} source(s)${flagged ? ` — ${flagged} flagged` : ""}`);

        if (projectId) {
          putFile(projectId, { path: "search_export.ris", name: "search_export.ris", type: "ris", content: toRis(res.records) });
          if (res.nativeRis) putFile(projectId, { path: "search_native.ris", name: "search_native.ris", type: "ris", content: `${res.nativeRis}\n` });
          if (res.prismaS) putFile(projectId, { path: "prisma-s-search-log.csv", name: "prisma-s-search-log.csv", type: "csv", content: toCsv(res.prismaS) });
          putFile(projectId, { path: "search_provenance.json", name: "search_provenance.json", type: "provenance", content: JSON.stringify({ mode, question: q, concepts, date: today, searches: res.searches, summary: reviewOut.searchSummary }, null, 2) });
        }
        break;
      }

      case "dedup": {
        const records = reviewOut.objects.records || [];
        if (records.length === 0) return { ok: false, reason: "No records to deduplicate" };
        notify(`Deduplicating ${records.length} records…`);
        // deduplicate() FLAGS duplicates (isDuplicate/dupOf/dedupCluster) rather than
        // deleting them, so every merge stays reversible and auditable. Downstream
        // stages select on !isDuplicate; the full library is retained for provenance.
        const { records: clustered, dedup } = deduplicate(records);
        reviewOut.objects = { ...reviewOut.objects, records: clustered, dedup: { ...dedup, at: Date.now() } };
        if (projectId) {
          putFile(projectId, { path: "dedup_audit.json", name: "dedup_audit.json", type: "audit", content: JSON.stringify(dedup, null, 2) });
        }
        emitProgress(100, `${dedup.unique} unique of ${dedup.total} — ${dedup.duplicates} duplicate${dedup.duplicates === 1 ? "" : "s"} flagged across ${dedup.clusters.length} cluster${dedup.clusters.length === 1 ? "" : "s"}`);
        break;
      }

      case "tiab": {
        const pending = recordsByStage(reviewOut, "tiab");
        if (pending.length === 0) return { ok: false, reason: "No records pending TIAB screening" };
        notify(`Screening ${pending.length} records…`);
        const recs = [...(reviewOut.objects.records || [])];
        const result = await screenTIABBatch(pending, eligibility, { onProgress: (p) => emitProgress(Math.round((p.processed / p.total) * 90), `Screened ${p.processed}/${p.total}`) });
        const screened = result.results || [];
        for (let i = 0; i < screened.length; i++) {
          const idx = recs.findIndex((r) => r.id === pending[i]?.id);
          if (idx >= 0) recs[idx] = { ...recs[idx], tiab: screened[i].decision || "uncertain", tiabConfidence: screened[i].confidence, tiabReason: screened[i].reason, tiabEngine: screened[i]._engine };
        }
        reviewOut.objects = { ...reviewOut.objects, records: recs };
        emitProgress(100, "TIAB screening complete");
        break;
      }

      case "retrieval": {
        notify("Retrieval stage: records flagged for full-text retrieval. Classify each as retrieved/unavailable.");
        const recs = (reviewOut.objects.records || []).map((r) => {
          if (r.tiab !== "include") return r;
          return { ...r, retrieval: r.retrieval || "pending" };
        });
        reviewOut.objects = { ...reviewOut.objects, records: recs };
        emitProgress(100, "Retrieval statuses initialised");
        break;
      }

      case "fulltext": {
        const pending = (reviewOut.objects.records || []).filter((r) => r.tiab === "include" && r.retrieval === "retrieved" && !r.fulltext);
        if (pending.length === 0) return { ok: false, reason: "No records pending full-text screening" };
        notify(`Full-text screening ${pending.length} studies…`);
        const recs = [...(reviewOut.objects.records || [])];
        for (let i = 0; i < pending.length; i++) {
          emitProgress(Math.round((i / pending.length) * 90), `Full-text screening ${i + 1}/${pending.length}`);
          const result = await screenFullText(pending[i].fullText || pending[i].abstract || "", eligibility, pending[i]);
          const idx = recs.findIndex((r) => r.id === pending[i].id);
          if (idx >= 0) recs[idx] = { ...recs[idx], fulltext: result };
        }
        const included = recs.filter((r) => r.fulltext?.decision === "include" || (!r.fulltext && r.tiab === "include"));
        reviewOut.objects = { ...reviewOut.objects, records: recs, studies: included.map((r) => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, doi: r.doi, extracted: false, rob: null })) };
        emitProgress(100, `Full-text screening complete — ${included.length} studies included`);
        break;
      }

      case "extraction": {
        const studies = studiesForExtraction(reviewOut);
        if (studies.length === 0) return { ok: false, reason: "No studies pending extraction" };
        notify(`Extracting data from ${studies.length} studies…`);
        const extracted = [...(reviewOut.objects.studies || [])];
        const pico = reviewOut.protocol?.pico || {};
        for (let i = 0; i < studies.length; i++) {
          emitProgress(Math.round((i / studies.length) * 90), `Extracting ${i + 1}/${studies.length}`);
          const fullText = (reviewOut.objects.records || []).find((r) => r.id === studies[i].id)?.fullText || "";
          const data = await extractStudyData(fullText, studies[i], pico);
          const idx = extracted.findIndex((s) => s.id === studies[i].id);
          if (idx >= 0) extracted[idx] = { ...extracted[idx], extracted: true, extraction: data, extractionEngine: data._engine };
        }
        reviewOut.objects = { ...reviewOut.objects, studies: extracted };
        emitProgress(100, "Data extraction complete");
        break;
      }

      case "rob": {
        const unassessed = (reviewOut.objects.studies || []).filter((s) => !s.rob);
        if (unassessed.length === 0) return { ok: false, reason: "No studies pending RoB assessment" };
        const tool = reviewOut.methodology?.robTool || "rob2";
        notify(`Assessing risk of bias (${tool}) for ${unassessed.length} studies…`);
        const assessed = [...(reviewOut.objects.studies || [])];
        for (let i = 0; i < unassessed.length; i++) {
          emitProgress(Math.round((i / unassessed.length) * 90), `RoB ${i + 1}/${unassessed.length}`);
          const fullText = (reviewOut.objects.records || []).find((r) => r.id === unassessed[i].id)?.fullText || "";
          const result = await assessRoB(fullText, unassessed[i], tool);
          const idx = assessed.findIndex((s) => s.id === unassessed[i].id);
          if (idx >= 0) assessed[idx] = { ...assessed[idx], rob: result, robEngine: result._engine };
        }
        reviewOut.objects = { ...reviewOut.objects, studies: assessed };
        emitProgress(100, "RoB assessment complete");
        break;
      }

      case "synthesis": {
        const studies = (reviewOut.objects.studies || []).filter((s) => s.extracted);
        if (studies.length === 0) return { ok: false, reason: "No extracted studies for synthesis" };
        notify("Running narrative synthesis…");
        const outcomes = reviewOut.protocol?.pico?.outcomes || [];
        const result = await narrativeSynthesis(studies, outcomes);
        reviewOut.objects = { ...reviewOut.objects, synthesis: result };
        emitProgress(100, "Synthesis complete");
        break;
      }

      case "grade": {
        const synthesis = reviewOut.objects.synthesis;
        if (!synthesis?.synthesisByOutcome?.length) return { ok: false, reason: "Run synthesis before GRADE" };
        notify(`Assessing GRADE certainty for ${synthesis.synthesisByOutcome.length} outcome(s)…`);
        const grades = [];
        for (let i = 0; i < synthesis.synthesisByOutcome.length; i++) {
          emitProgress(Math.round((i / synthesis.synthesisByOutcome.length) * 90), `GRADE ${i + 1}/${synthesis.synthesisByOutcome.length}`);
          const result = await gradeCertainty(synthesis.synthesisByOutcome[i]);
          grades.push(result);
        }
        reviewOut.objects = { ...reviewOut.objects, grade: { outcomes: grades } };
        emitProgress(100, "GRADE assessment complete");
        break;
      }

      case "report": {
        notify("Generating PRISMA flow and report artifacts…");
        const recs = reviewOut.objects.records || [];
        const studies = reviewOut.objects.studies || [];
        // PRISMA 2020 semantics. "Identified" is what the DATABASES reported, which is
        // not the same as what was retrieved into the library — a capped or paginated
        // search retrieves a subset, and conflating the two overstates the search.
        // Both numbers are reported so the flow diagram is auditable.
        const summary = reviewOut.searchSummary || {};
        const dedup = reviewOut.objects.dedup || {};
        const screenable = recs.filter((r) => !r.isDuplicate);
        const counts = {
          identified: Number(summary.totalHits ?? summary.reportedHits ?? recs.length) || recs.length,
          recordsRetrieved: recs.length,
          duplicatesRemoved: Number(dedup.duplicates ?? 0),
          screened: screenable.length,
          excluded: screenable.filter((r) => r.tiab === "exclude").length,
          soughtForRetrieval: screenable.filter((r) => r.tiab === "include").length,
          retrieved: screenable.filter((r) => r.retrieval === "retrieved").length,
          notRetrieved: screenable.filter((r) => r.tiab === "include" && r.retrieval !== "retrieved").length,
          fullTextScreened: screenable.filter((r) => r.fulltext).length,
          fullTextExcluded: screenable.filter((r) => r.fulltext?.decision === "exclude").length,
          included: studies.filter((s) => s.extracted).length,
          truncated: Boolean(summary.truncated),
        };
        const prisma = await generatePRISMAFlow(counts);
        reviewOut.objects = { ...reviewOut.objects, report: { prisma, counts } };
        emitProgress(100, "Report artifacts generated");
        break;
      }

      default:
        return { ok: false, reason: `Unknown stage: ${stageId}` };
    }

    const completed = completeStage(reviewOut, stageId, { when: Date.now() });
    if (!completed.ok) return { ok: false, issues: completed.issues, review: reviewOut };

    if (projectId) saveReview(projectId, completed.review);
    return { ok: true, review: completed.review };
  } catch (e) {
    return { ok: false, reason: String(e.message || e), review: reviewOut };
  }
}

export async function runPipeline(projectId, review, { fromStage, onProgress, onNote } = {}) {
  const startIdx = fromStage ? stageIndex(fromStage) : 0;
  let currentReview = review;

  for (let i = startIdx; i < STAGES.length; i++) {
    const s = STAGES[i];
    if (currentReview.stages[s.id]?.status === "complete") continue;
    if (s.optional) {
      onNote?.(`${s.name} skipped — optional human-judgement stage, complete it directly when needed.`);
      continue;
    }

    const result = await runStage(projectId, currentReview, s.id, {
      onProgress: (p) => onProgress?.({ ...p, stageIndex: i, totalStages: STAGES.length }),
      onNote,
    });
    if (!result.ok) {
      return { ok: false, stage: s.id, stageIndex: i, reason: result.reason, issues: result.issues, review: result.review };
    }
    currentReview = result.review;
    onNote?.(`${s.name} complete — ${progress(currentReview).pct}% done`);
  }

  return { ok: true, review: currentReview };
}

export async function runToStage(projectId, review, targetStageId, opts = {}) {
  const targetIdx = stageIndex(targetStageId);
  if (targetIdx < 0) return { ok: false, reason: `Unknown target stage: ${targetStageId}` };

  let currentReview = review;

  for (let i = 0; i <= targetIdx; i++) {
    const s = STAGES[i];
    if (currentReview.stages[s.id]?.status === "complete") continue;
    if (s.optional && s.id !== targetStageId) continue;

    const result = await runStage(projectId, currentReview, s.id, {
      onProgress: (p) => opts.onProgress?.({ ...p, stageIndex: i, totalStages: targetIdx + 1 }),
      onNote: opts.onNote,
    });
    if (!result.ok) {
      return { ok: false, stage: s.id, stageIndex: i, reason: result.reason, issues: result.issues, review: result.review };
    }
    currentReview = result.review;
  }

  return { ok: true, review: currentReview };
}

export async function batchScreenTIAB(projectId, review, recordBatch, { onProgress } = {}) {
  const eligibility = fmtEligibility(review);
  const result = await screenTIABBatch(recordBatch, eligibility, { onProgress });
  return result;
}

export async function batchExtract(projectId, review, studyBatch, { onProgress, onNote } = {}) {
  const pico = review.protocol?.pico || {};
  const extracted = [];
  for (let i = 0; i < studyBatch.length; i++) {
    onProgress?.({ pct: Math.round((i / studyBatch.length) * 100), msg: `Extracting ${i + 1}/${studyBatch.length}` });
    const fullText = review.objects.records?.find((r) => r.id === studyBatch[i].id)?.fullText || "";
    const data = await extractStudyData(fullText, studyBatch[i], pico);
    extracted.push({ ...studyBatch[i], extracted: true, extraction: data, extractionEngine: data._engine });
  }
  return extracted;
}

export function stageProgress(review) {
  return progress(review);
}

export function stageDetails(review) {
  return STAGES.map((s) => {
    const st = review?.stages?.[s.id];
    const can = stageCanRun(review, s.id);
    const recs = review?.objects;
    let recordCount = 0;
    if (s.id === "tiab") recordCount = recordsByStage(review, "tiab").length;
    if (s.id === "fulltext") recordCount = (recs?.records || []).filter((r) => r.tiab === "include" && r.retrieval === "retrieved" && !r.fulltext).length;
    if (s.id === "extraction") recordCount = (recs?.studies || []).filter((st) => !st.extracted).length;
    if (s.id === "rob") recordCount = (recs?.studies || []).filter((st) => !st.rob).length;

    return {
      id: s.id, name: s.name, optional: !!s.optional,
      status: st?.status || "pending",
      blocked: !can.ok,
      blockReason: can.reason,
      validation: s.validate(review),
      pendingCount: recordCount,
    };
  });
}

export function reviewSummary(review) {
  const recs = review?.objects?.records || [];
  const studies = review?.objects?.studies || [];
  return {
    question: review?.question || "",
    type: review?.methodology?.typeName || "",
    framework: review?.methodology?.framework || "",
    robTool: review?.methodology?.robTool || "",
    synthesis: review?.methodology?.synthesis || "",
    records: recs.length,
    included: recs.filter((r) => r.tiab === "include" || r.fulltext?.decision === "include").length,
    excluded: recs.filter((r) => r.tiab === "exclude" || r.fulltext?.decision === "exclude").length,
    extracted: studies.filter((s) => s.extracted).length,
    searchCount: (review?.objects?.searches || []).length,
    stageProgress: progress(review),
    stages: stageDetails(review),
  };
}
