import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Database, Loader2, Play, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { activeProject, putFile } from "../engine/projectstore.js";
import { currentUser } from "../engine/accounts.js";
import { loadReview } from "../engine/reviewengine.js";
import {
  activeHumanGate,
  createReviewRun,
  gateRoute,
  getGatePackage,
  getReviewRun,
  isRunAtRest,
  pollReviewRun,
  reviewApiConfig,
  reviewServiceHealth,
  submitGate,
} from "../engine/reviewApiClient.js";

const markerKey = (projectId) => `medantir.review.productionRun.v1:${projectId || "none"}`;
const readMarker = (projectId) => {
  try { return JSON.parse(localStorage.getItem(markerKey(projectId)) || "null"); } catch { return null; }
};
const writeMarker = (projectId, marker) => {
  try {
    if (marker) localStorage.setItem(markerKey(projectId), JSON.stringify(marker));
    else localStorage.removeItem(markerKey(projectId));
  } catch { /* storage unavailable */ }
};

const STAGE_LABELS = {
  question: "Question specification",
  identity: "Researcher identity",
  protocol: "Methodology profile",
  "review-landscape": "Existing-review landscape",
  "protocol-draft": "Protocol draft",
  "search-build": "Database search build",
  "search-test": "Search validation / PRESS",
  "protocol-finalise": "Protocol finalisation",
  "register-protocol": "Registration package",
  "search-execute": "Definitive search",
  deduplicate: "Deduplication and study linkage",
  "tiab-screen": "Title and abstract screening",
  "fulltext-retrieve": "Full-text retrieval",
  "pdf-to-text": "LiteParse document intelligence",
  "fulltext-screen": "Full-text screening",
  extract: "Structured extraction",
  "risk-of-bias": "Risk of bias",
  synthesise: "Synthesis",
  grade: "Certainty assessment",
  report: "Report and publication package",
  "human-verify": "Independent human verification",
};

function currentFailure(state) {
  return Object.entries(state?.stages || {}).find(([, stage]) => stage?.status === "failed") || null;
}

function gateTemplate(route, gate, state) {
  const payload = gate?.payload || {};
  if (!route) return {};
  if (route.kind === "clarification") {
    const issue = payload?.request?.issue;
    return {
      issueId: issue?.id || "REPLACE_WITH_ISSUE_ID",
      field: issue?.field || "REPLACE_WITH_FIELD",
      value: "REPLACE_WITH_EVIDENCE_BOUND_ANSWER",
      rationale: "Explain why this answer is scientifically appropriate and who agreed it.",
    };
  }
  if (route.kind === "grade-policy") {
    return {
      version: "1.0.0",
      rationale: "Prospectively prespecified GRADE thresholds approved by the review methodologist.",
      riskOfBias: {
        highRiskWeightSerious: "REPLACE_WITH_0_TO_1_THRESHOLD",
        highRiskWeightVerySerious: "REPLACE_WITH_0_TO_1_THRESHOLD",
        someConcernsWeightSerious: "REPLACE_WITH_0_TO_1_THRESHOLD",
        minimumWeightCoverage: "REPLACE_WITH_0_TO_1_THRESHOLD",
      },
      inconsistency: {
        i2Serious: "REPLACE_WITH_0_TO_100_THRESHOLD",
        i2VerySerious: "REPLACE_WITH_0_TO_100_THRESHOLD",
        predictionIntervalDecisionConflictSerious: "REPLACE_WITH_BOOLEAN",
      },
      imprecision: {
        nullValue: "REPLACE_WITH_NULL_EFFECT",
        benefitThreshold: "REPLACE_WITH_BENEFIT_THRESHOLD",
        harmThreshold: "REPLACE_WITH_HARM_THRESHOLD",
        requiredInformationSize: "REPLACE_WITH_POSITIVE_NUMBER",
        verySeriousOisFraction: "REPLACE_WITH_0_TO_1_THRESHOLD",
      },
      indirectness: {
        seriousIfPartialDimensionsAtLeast: "REPLACE_WITH_POSITIVE_INTEGER",
        verySeriousIfIndirectDimensionsAtLeast: "REPLACE_WITH_POSITIVE_INTEGER",
      },
      publicationBias: {
        seriousSignalWeight: "REPLACE_WITH_POSITIVE_NUMBER",
        verySeriousSignalWeight: "REPLACE_WITH_POSITIVE_NUMBER",
      },
    };
  }
  if (route.kind === "publication-bias-policy") {
    return {
      version: "1.0.0",
      rationale: "Prospective policy for the eligible registered-study universe and outcome-reporting completeness.",
      minimumEligibleUniverseRegistryCoverage: "REPLACE_WITH_0_TO_1_THRESHOLD",
      requireEligibilityResolvedForAssessmentBasis: "REPLACE_WITH_BOOLEAN",
      requireResultAvailabilityKnownForAssessmentBasis: "REPLACE_WITH_BOOLEAN",
      requireTargetOutcomeStatusKnownForAssessmentBasis: "REPLACE_WITH_BOOLEAN",
    };
  }
  if (route.kind === "publication-bias-search") {
    return {
      source: "ClinicalTrials.gov",
      rationale: "The prospective publication-bias policy requires a trial-registry search in addition to publication databases.",
    };
  }
  if (route.kind === "risk-of-bias") {
    const item = payload?.reviewPackage?.items?.[0];
    return {
      studyId: item?.studyId || "REPLACE_WITH_STUDY_ID",
      resultId: item?.resultId || "REPLACE_WITH_RESULT_ID",
      outcome: item?.outcome || "REPLACE_WITH_OUTCOME",
      responses: (item?.missingQuestionIds || []).map((questionId) => ({
        questionId,
        response: "REPLACE_WITH_Y_PY_PN_N_NI_OR_NA",
        rationale: "Cite the exact evidence and explain the signalling response.",
        evidenceIds: ["REPLACE_WITH_EVIDENCE_ID_OR_EMPTY_ONLY_FOR_NI_NA"],
      })),
      overrides: [],
    };
  }
  if (route.kind === "grade-evidence") {
    const item = payload?.reviewPackage?.items?.[0];
    return {
      outcome: item?.outcome || "REPLACE_WITH_OUTCOME",
      totalParticipants: "REPLACE_WITH_POSITIVE_INTEGER",
      totalParticipantsEvidenceIds: ["REPLACE_WITH_AUTHORISED_CATALOG_ID"],
    };
  }
  if (route.kind === "registry-universe") {
    const item = payload?.reviewPackage?.items?.[0];
    const body = {
      registryId: item?.registryId || "REPLACE_WITH_REGISTRY_ID",
      outcome: item?.outcome || "REPLACE_WITH_OUTCOME",
      evidenceIds: item?.evidenceIds?.length ? [item.evidenceIds[0]] : ["REPLACE_WITH_EVIDENCE_ID"],
      rationale: "Explain how the cited registry/publication evidence resolves the selected field.",
    };
    const field = item?.requiredFields?.[0];
    if (field) body[field] = `REPLACE_WITH_${String(field).toUpperCase()}_VALUE`;
    return body;
  }
  if (route.kind === "verification") {
    return {
      packageId: payload?.id || "REPLACE_WITH_PACKAGE_ID",
      mode: payload?.mode || "blinded",
      decisions: (payload?.items || []).map((item) => ({
        itemId: item.id,
        verdict: "REPLACE_WITH_accept_reject_amend_or_defer",
        rationale: "Record the independent evidence-based rationale.",
      })),
    };
  }
  return state?.artifacts || {};
}

function saveRunArtifacts(projectId, state) {
  if (!projectId || !state?.runId) return;
  putFile(projectId, {
    path: `server/runs/${state.runId}/run-summary.json`,
    name: "run-summary.json",
    type: "review-run",
    content: JSON.stringify({
      runId: state.runId,
      request: state.request,
      stages: state.stages,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      artifactKeys: Object.keys(state.artifacts || {}).sort(),
      auditEventCount: Array.isArray(state.audit) ? state.audit.length : 0,
    }, null, 2),
  });
  if (state.artifacts?.finalReport) {
    putFile(projectId, {
      path: `server/runs/${state.runId}/final-report.json`,
      name: "final-report.json",
      type: "report",
      content: JSON.stringify(state.artifacts.finalReport, null, 2),
    });
  }
  if (state.artifacts?.protocolPackage) {
    putFile(projectId, {
      path: `server/runs/${state.runId}/protocol-package.json`,
      name: "protocol-package.json",
      type: "protocol",
      content: JSON.stringify(state.artifacts.protocolPackage, null, 2),
    });
  }
}

export default function ReviewControlRoom() {
  const projectId = activeProject();
  const review = loadReview(projectId);
  const [runId, setRunId] = useState(() => readMarker(projectId)?.runId || "");
  const [attachId, setAttachId] = useState("");
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [gate, setGate] = useState(null);
  const [submission, setSubmission] = useState("");
  const [pressConfirmed, setPressConfirmed] = useState(false);
  const [pressRationale, setPressRationale] = useState("");
  const pollGeneration = useRef(0);

  const route = useMemo(() => gateRoute(state), [state]);
  const gateStage = activeHumanGate(state);
  const failure = currentFailure(state);
  const stages = Object.entries(state?.stages || {});
  const passed = stages.filter(([, stage]) => stage.status === "passed").length;

  const loadGate = useCallback(async (nextState) => {
    if (!nextState?.runId || !activeHumanGate(nextState)) {
      setGate(null);
      setSubmission("");
      return;
    }
    const result = await getGatePackage(nextState.runId, nextState, projectId);
    setGate(result);
    if (result.ok) setSubmission(JSON.stringify(gateTemplate(result.route, result, nextState), null, 2));
    else setSubmission("");
  }, [projectId]);

  const acceptState = useCallback((nextState) => {
    if (!nextState?.runId) return;
    setState(nextState);
    setRunId(nextState.runId);
    writeMarker(projectId, { runId: nextState.runId, updatedAt: Date.now(), question: nextState.request?.question?.title });
    saveRunArtifacts(projectId, nextState);
    if (isRunAtRest(nextState)) void loadGate(nextState);
  }, [loadGate, projectId]);

  const track = useCallback(async (id) => {
    const generation = ++pollGeneration.current;
    setBusy(true);
    const result = await pollReviewRun(id, {
      projectId,
      onUpdate: (nextState) => {
        if (generation === pollGeneration.current) acceptState(nextState);
      },
    });
    if (generation !== pollGeneration.current) return;
    setBusy(false);
    if (!result.ok) setNote(result.error || "Review run could not be read.");
    else if (result.timedOut) setNote("The review is still executing; polling paused. Refresh or reattach to continue observing it.");
    else {
      acceptState(result.state);
      setNote(activeHumanGate(result.state) ? "The pipeline reached an attributable human gate." : "The pipeline reached a terminal state.");
    }
  }, [acceptState, projectId]);

  useEffect(() => {
    pollGeneration.current += 1;
    setState(null);
    setGate(null);
    setSubmission("");
    setNote("");
    const marker = readMarker(projectId);
    const savedRunId = marker?.runId || "";
    setRunId(savedRunId);
    void reviewServiceHealth().then(setHealth);
    if (!savedRunId) return undefined;
    void getReviewRun(savedRunId, projectId).then((result) => {
      if (!result.ok) { setNote(result.error || "Saved server run was not found."); return; }
      acceptState(result.state);
      if (!isRunAtRest(result.state)) void track(savedRunId);
    });
    return () => { pollGeneration.current += 1; };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    const currentProject = projectId;
    const currentReview = review;
    if (!currentProject || !currentReview) {
      setNote("Select a saved review project and complete its Question surface first.");
      return;
    }
    setBusy(true);
    setNote("Creating an authenticated, durable server review run…");
    if (!pressConfirmed || pressRationale.trim().length < 20) {
      setBusy(false);
      setNote("Record the independent PRESS/search-strategy peer-review attestation and a substantive rationale before definitive searching.");
      return;
    }
    putFile(currentProject, {
      path: `server/press-attestation-${Date.now()}.json`,
      name: "press-attestation.json",
      type: "methodology-approval",
      content: JSON.stringify({
        completed: true,
        rationale: pressRationale.trim(),
        actor: currentUser()?.email || currentUser()?.id || "authenticated-reviewer",
        recordedAt: new Date().toISOString(),
      }, null, 2),
    });
    const result = await createReviewRun(currentReview, { projectId: currentProject, searchPeerReviewCompleted: true });
    if (!result.ok || !result.state?.runId) {
      setBusy(false);
      setNote(result.error || "The review service rejected the run request.");
      return;
    }
    acceptState(result.state);
    await track(result.state.runId);
  };

  const attach = async () => {
    const id = attachId.trim();
    if (!id) return;
    setRunId(id);
    writeMarker(projectId, { runId: id, updatedAt: Date.now() });
    const result = await getReviewRun(id, projectId);
    if (!result.ok) { setNote(result.error || "Run not found for this user and project."); return; }
    acceptState(result.state);
    if (!isRunAtRest(result.state)) await track(id);
  };

  const refresh = async () => {
    if (!runId) return;
    const result = await getReviewRun(runId, projectId);
    if (!result.ok) { setNote(result.error || "Run refresh failed."); return; }
    acceptState(result.state);
    if (!isRunAtRest(result.state)) await track(runId);
  };

  const submit = async () => {
    if (!state || !route) return;
    let body;
    try { body = JSON.parse(submission); }
    catch (error) { setNote(`Submission is not valid JSON: ${error.message}`); return; }
    setBusy(true);
    const result = await submitGate(state.runId, state, body, projectId);
    setBusy(false);
    if (!result.ok) { setNote(result.error || "Gate submission was rejected."); return; }
    acceptState(result.state);
    setNote("Gate decision recorded. The pipeline is resuming from the earliest affected stage.");
    if (!isRunAtRest(result.state)) await track(result.state.runId);
  };

  return (
    <div className="space-y-3 text-xs" style={{ minHeight: 420 }}>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 bg-white dark:bg-zinc-950">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 font-semibold text-sm"><Server className="h-4 w-4" /> Production review service</div>
            <div className="mt-1 text-zinc-500">{reviewApiConfig.baseUrl}</div>
            <div className="mt-1 text-zinc-500">Project: {projectId || "none"} · Review: {review?.question || "not loaded"}</div>
          </div>
          <div className={`flex items-center gap-1.5 font-mono ${health?.ok ? "text-emerald-600" : "text-amber-600"}`}>
            {health?.ok ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {health == null ? "checking" : health.ok ? "online" : "unavailable"}
          </div>
        </div>
        <div className="mt-3 rounded border border-zinc-200 dark:border-zinc-800 p-2.5">
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={pressConfirmed} onChange={(event) => setPressConfirmed(event.target.checked)} className="mt-0.5" />
            <span><span className="font-semibold">Independent search-strategy peer review completed.</span> This attests that the database strategies, syntax, concepts, limits, and known-record recall have been reviewed before definitive searching.</span>
          </label>
          <textarea value={pressRationale} onChange={(event) => setPressRationale(event.target.value)} rows={2} placeholder="Reviewer, date, PRESS findings, amendments made, and why the strategy is ready…" className="mt-2 w-full px-2.5 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent" />
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button onClick={start} disabled={busy || !review || !pressConfirmed || pressRationale.trim().length < 20} className="ui-primary-button flex items-center gap-1.5 px-3 py-2"><Play className="h-3.5 w-3.5" /> Start durable run</button>
          <button onClick={refresh} disabled={busy || !runId} className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700 flex items-center gap-1.5"><RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh</button>
          <input value={attachId} onChange={(event) => setAttachId(event.target.value)} placeholder="existing run id" className="px-2.5 py-2 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent min-w-[230px]" />
          <button onClick={attach} disabled={busy || !attachId.trim()} className="px-3 py-2 rounded border border-zinc-300 dark:border-zinc-700">Attach</button>
        </div>
        {note && <div className="mt-2 text-zinc-600 dark:text-zinc-300">{note}</div>}
      </div>

      {state && (
        <>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between gap-2">
              <div className="font-semibold">Run {state.runId}</div>
              <div className="font-mono text-zinc-500">{passed}/{stages.length} passed{gateStage ? ` · awaiting ${gateStage}` : failure ? ` · failed ${failure[0]}` : ""}</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {stages.map(([name, stage]) => (
                <div key={name} className="px-3 py-2 border-t border-r border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                  {stage.status === "passed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : stage.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" /> : stage.status === "awaiting-human" ? <ClipboardCheck className="h-3.5 w-3.5 text-blue-600" /> : <span className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />}
                  <span className="flex-1">{STAGE_LABELS[name] || name}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{stage.status}</span>
                </div>
              ))}
            </div>
          </div>

          {failure && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
              <div className="font-semibold text-rose-600">{STAGE_LABELS[failure[0]] || failure[0]} failed</div>
              <div className="mt-1 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{(failure[1].errors || []).join("\n") || "No error detail was recorded."}</div>
            </div>
          )}

          {route && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/[0.03] overflow-hidden">
              <div className="px-3 py-2 border-b border-blue-500/20 flex items-center justify-between gap-2">
                <div><span className="font-semibold">Methodology gate:</span> {route.kind}</div>
                <button onClick={() => loadGate(state)} className="px-2 py-1 rounded border border-blue-500/30">Reload evidence package</button>
              </div>
              {gate?.ok ? (
                <div className="grid grid-cols-1 xl:grid-cols-2">
                  <div className="p-3 border-b xl:border-b-0 xl:border-r border-blue-500/20">
                    <div className="font-semibold mb-2 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Evidence package</div>
                    <pre className="text-[10px] leading-relaxed whitespace-pre-wrap max-h-[430px] overflow-auto rounded bg-zinc-950 text-zinc-200 p-3">{JSON.stringify(gate.payload, null, 2)}</pre>
                  </div>
                  <div className="p-3">
                    <div className="font-semibold mb-1">Attributable decision submission</div>
                    <div className="mb-2 text-zinc-500">The template is deliberately incomplete where a scientific judgement is required. Replace every placeholder and cite only evidence IDs present in the package.</div>
                    {["registration", "protocol-finalisation"].includes(route.kind) ? (
                      <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-amber-800 dark:text-amber-200">
                        This gate has no safe generic submission action. Complete the named external or reconciliation task, then refresh the run. MEDANTIR will not fabricate a registry approval or replay an uncertain mutation.
                      </div>
                    ) : (
                      <>
                        <textarea value={submission} onChange={(event) => setSubmission(event.target.value)} rows={20} spellCheck={false} className="w-full rounded bg-zinc-950 text-zinc-100 font-mono text-[10px] leading-relaxed p-3 border border-zinc-800" />
                        <button onClick={submit} disabled={busy || !submission.trim()} className="mt-2 ui-primary-button px-3 py-2">Record decision and resume</button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3 text-amber-700 dark:text-amber-300">{gate?.error || "Loading the active gate package…"}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
