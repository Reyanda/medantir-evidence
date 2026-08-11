import React, { useState, useEffect, useRef } from "react";
import { GitBranch, Loader2, Check, Lock, CircleDot, RotateCcw, Play, Save, AlertTriangle, ShieldCheck, X, Pencil, PauseCircle, Search, Download, Wrench } from "lucide-react";
import { listProjects, createProject, isReviewProject, setActiveProject } from "../engine/projectstore.js";
import { createReview, loadReview, saveReview, stageStatus, completeStage, rollbackStage, progress } from "../engine/reviewengine.js";
import { runServerReview, getServerRun, pollServerRun, isRunTerminal, getProtocolPackage, getRegistrationArtifacts, getVerificationPackage, submitVerification } from "../engine/reviewservice.js";
import { executeSearches, toRis, troubleshoot } from "../engine/reviewsearch.js";
import { deduplicate, unmergeRecord } from "../engine/dedup.js";
import { runnableSources } from "../engine/academic.js";
import { putFile } from "../engine/projectstore.js";
import { EmptyState } from "./Skeleton.jsx";

// The deep-review stage of the unified Evidence workspace.
// Each stage has a validation gate: it can't complete until its outputs validate.

// Marker for the in-flight server run, so navigating away and back (or a full
// reload) re-attaches to the run instead of losing it. Runs execute server-side;
// the marker only holds the id needed to resume polling — no run content.
const ACTIVE_RUN_KEY = "medantir.review.activeRun.v1";
const readActiveRun = () => { try { return JSON.parse(localStorage.getItem(ACTIVE_RUN_KEY) || "null"); } catch { return null; } };
const writeActiveRun = (marker) => { if (marker) localStorage.setItem(ACTIVE_RUN_KEY, JSON.stringify(marker)); else localStorage.removeItem(ACTIVE_RUN_KEY); };

export default function ReviewTab({ embedded = false }) {
  const [projects, setProjects] = useState(() => listProjects().filter(isReviewProject));
  const [pid, setPid] = useState(projects[0]?.id || "");
  const [question, setQuestion] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [review, setReview] = useState(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState(false);
  const [serverRun, setServerRun] = useState(null);
  const [protocolArtifacts, setProtocolArtifacts] = useState(null);
  const [runId, setRunId] = useState(null);
  const [verif, setVerif] = useState(null);        // { package, verdicts: {id:{verdict,rationale}}, bulk }
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const allSources = runnableSources();
  const [srcSel, setSrcSel] = useState(allSources.filter((s) => s.kind === "builtin").slice(0, 2).map((s) => s.id));
  const [searchQ, setSearchQ] = useState("");
  const [searching, setSearching] = useState(false);
  const pollGen = useRef(0);

  useEffect(() => { if (pid) { setActiveProject(pid); const r = loadReview(pid); setReview(r); if (r && !searchQ) setSearchQ(r.question || ""); } }, [pid]);

  // Re-attach to an in-flight server run for this project (navigation/reload
  // recovery): resume polling, or land the finished state if it completed
  // while the user was elsewhere.
  useEffect(() => {
    const marker = readActiveRun();
    if (!marker?.runId || marker.pid !== pid) return;
    let cancelled = false;
    (async () => {
      const r = await getServerRun(marker.runId);
      if (cancelled) return;
      if (!r.ok || !r.state?.stages) { writeActiveRun(null); return; }
      if (isRunTerminal(r.state)) finishRun(r.state);
      else trackRun(r.state);
    })();
    return () => { cancelled = true; };
  }, [pid]);

  const newProject = () => {
    const name = newProjectName.trim();
    if (!name) { setNote("Enter a project name first."); return; }
    const p = createProject(name, { projectType: "systematic-review", mode: "academic" });
    setProjects(listProjects().filter(isReviewProject));
    setPid(p.id);
    setNewProjectName("");
    setNote(`Project "${p.name}" created.`);
  };
  const persist = (r) => { setReview({ ...r }); saveReview(pid, r); };

  const start = () => {
    if (!pid) { setNote("Select or create a project first."); return; }
    if (!question.trim()) { setNote("Enter the review question first."); return; }
    const r = createReview(question); r.createdAt = Date.now();
    persist(r); setNote("Review created — begin at the Protocol stage.");
  };
  const setEligibility = (v) => { const r = { ...review, objects: { ...review.objects, eligibility: v } }; persist(r); };
  const toggleSrc = (id) => setSrcSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Execute the strategy against each selected database (live keyless APIs today;
  // login-walled sources land with the AI-assisted login layer). Captures per-DB
  // executed query + date + count + status, merges/dedups records into the review
  // library, and writes provenance — never a silent zero.
  const runSearch = async () => {
    if (!srcSel.length) { setNote("Select at least one database to search."); return; }
    const q = (searchQ || review.question || "").trim();
    if (!q) { setNote("Enter a search query (defaults to the review question)."); return; }
    setSearching(true); setNote(`Running ${srcSel.length} database search${srcSel.length > 1 ? "es" : ""} (live)…`);
    const today = new Date().toISOString().slice(0, 10);
    let res;
    try { res = await executeSearches(q, srcSel, { n: 50, date: today }); }
    catch (e) { setSearching(false); setNote(`Search failed: ${String(e.message || e)}`); return; }
    const r = { ...review, objects: { ...review.objects, searches: res.searches, records: res.records } };
    r.searchSummary = res.summary;
    persist(r);
    // Persist the RIS export + a provenance record into the project.
    if (pid) {
      putFile(pid, { path: "search_export.ris", name: "search_export.ris", type: "ris", content: toRis(res.records) });
      putFile(pid, { path: "search_provenance.json", name: "search_provenance.json", type: "provenance", content: JSON.stringify({ query: q, date: today, searches: res.searches, summary: res.summary }, null, 2) });
    }
    setSearching(false);
    const flagged = res.summary.flagged.length;
    setNote(`Search done — ${res.summary.uniqueRecords} unique of ${res.summary.totalHits} hits across ${res.summary.sources} sources${flagged ? `; ${flagged} source(s) flagged — review troubleshooting.` : "."} RIS saved.`);
  };
  const downloadRis = () => {
    const blob = new Blob([toRis(review.objects.records || [])], { type: "application/x-research-info-systems" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "search_export.ris"; a.click(); URL.revokeObjectURL(a.href);
  };

  // Deduplicate the merged library — exact (DOI/PMID/PMCID/trial) then fuzzy title.
  // Records are flagged, never deleted, so every merge is reversible + auditable.
  const runDedup = () => {
    const res = deduplicate(review.objects.records || []);
    const r = { ...review, objects: { ...review.objects, records: res.records, dedup: { ...res.dedup, at: Date.now() } } };
    persist(r);
    if (pid) putFile(pid, { path: "dedup_audit.json", name: "dedup_audit.json", type: "audit", content: JSON.stringify(res.dedup, null, 2) });
    setNote(`Deduplicated — ${res.dedup.unique} unique of ${res.dedup.total} (${res.dedup.duplicates} duplicate${res.dedup.duplicates === 1 ? "" : "s"} across ${res.dedup.clusters.length} cluster${res.dedup.clusters.length === 1 ? "" : "s"}). Reversible.`);
  };
  // Human adjudication: mark a flagged record as NOT a duplicate (reversible, audited).
  const unmerge = (index) => {
    const res = unmergeRecord({ records: review.objects.records, dedup: review.objects.dedup }, index);
    persist({ ...review, objects: { ...review.objects, records: res.records, dedup: { ...res.dedup, at: Date.now() } } });
    setNote(`Record un-merged (kept as unique) — override recorded. Now ${res.dedup.unique} unique.`);
  };
  const complete = (id) => { const res = completeStage(review, id, { when: Date.now() }); if (res.ok) { persist(res.review); setNote(`Stage "${id}" validated + completed.`); } else setNote(res.issues.join(" ")); };
  const rollback = (id) => { persist(rollbackStage(review, id, { when: Date.now() })); setNote(`Rolled back from "${id}" (downstream stages reset).`); };

  // Run the pipeline on the server. The POST returns immediately (202); the run
  // executes in the background and is tracked by polling — the marker lets a
  // later visit re-attach, so progress is never lost by navigating away.
  const runServer = async () => {
    setRunning(true); setServerRun(null); setProtocolArtifacts(null); setVerif(null); setOutcome(null); setRunId(null);
    setNote("Starting the pipeline on the server (live searches)…");
    const r = await runServerReview({ question: review.question, objective: review.question, reviewType: review.methodology.typeId, concepts: [], mode: "autonomous", verificationMode: "blinded" });
    if (!r.ok || !r.state?.runId) { setRunning(false); setNote(r.error || "Server run failed to start."); return; }
    writeActiveRun({ runId: r.state.runId, pid, question: review.question, startedAt: Date.now() });
    trackRun(r.state);
  };

  // Track a running pipeline to its rest point, rendering live stage progress.
  const trackRun = (state) => {
    const gen = ++pollGen.current;
    setServerRun({ stages: state.stages || {}, artifacts: state.artifacts || {}, audit: state.audit || [] });
    setRunId(state.runId);
    setRunning(true);
    setNote("Pipeline running on the server — safe to navigate away; this view re-attaches when you return.");
    pollServerRun(state.runId, {
      onUpdate: (s) => { if (gen === pollGen.current) setServerRun({ stages: s.stages || {}, artifacts: s.artifacts || {}, audit: s.audit || [] }); },
    }).then((r) => {
      if (gen !== pollGen.current) return;
      setRunning(false);
      if (!r.ok) { setNote(`Lost contact with the run (${r.error}). It continues server-side — reopen this project to re-attach.`); return; }
      if (r.timedOut) { setNote("Run still executing server-side; polling paused. Reopen this project to re-attach."); return; }
      finishRun(r.state);
    });
  };

  const finishRun = (state) => {
    applyServerState(state);
    writeActiveRun(null);
    if (state.runId) loadProtocolArtifacts(state.runId);
    if (state.stages?.["human-verify"]?.status === "awaiting-human" && state.runId) loadVerification(state.runId);
  };

  const loadProtocolArtifacts = async (id) => {
    const [protocol, registration] = await Promise.all([
      getProtocolPackage(id),
      getRegistrationArtifacts(id),
    ]);
    if (!protocol.ok && !registration.ok) return;
    const bundle = {
      protocol: protocol.ok ? protocol.protocol : null,
      registration: registration.ok ? registration.registration : null,
    };
    setProtocolArtifacts(bundle);
    if (pid && bundle.protocol) {
      putFile(pid, { path: "protocol_package.json", name: "protocol_package.json", type: "protocol", content: JSON.stringify(bundle.protocol, null, 2) });
      putFile(pid, { path: "protocol.md", name: "protocol.md", type: "protocol", content: bundle.protocol.documentMarkdown || "" });
    }
    if (pid && bundle.registration) {
      putFile(pid, { path: "registration_plan.json", name: "registration_plan.json", type: "registration", content: JSON.stringify(bundle.registration, null, 2) });
    }
  };

  const applyServerState = (state) => {
    const st = state.stages || {};
    const passed = Object.values(st).filter((s) => s.status === "passed").length;
    setServerRun({ stages: st, artifacts: state.artifacts || {}, audit: state.auditLog || state.audit || [] });
    setRunId(state.runId || null);
    if (pid) putFile(pid, { path: "review_run.json", name: "review_run.json", type: "review-run", content: JSON.stringify(state, null, 2) });
    const awaiting = st["human-verify"]?.status === "awaiting-human";
    setNote(`Pipeline ${awaiting ? "reached the human-verification gate" : "finished"} — ${passed}/${Object.keys(st).length} stages passed. Run saved to review_run.json.`);
  };

  // Fetch the blinded verification package a reviewer must adjudicate before closure.
  const loadVerification = async (id) => {
    const r = await getVerificationPackage(id);
    if (!r.ok) { setNote(`Verification package unavailable: ${r.error}`); return; }
    const verdicts = {};
    for (const it of r.package.items) verdicts[it.id] = { verdict: "accept", rationale: "" };
    setVerif({ package: r.package, verdicts, bulk: "" });
  };
  const setVerdict = (itemId, patch) => setVerif((v) => ({ ...v, verdicts: { ...v.verdicts, [itemId]: { ...v.verdicts[itemId], ...patch } } }));

  // Submit reviewer verdicts for every package item, closing or rolling back the loop.
  const submitVerdicts = async () => {
    if (!verif || !runId) return;
    const bulk = verif.bulk.trim();
    if (!bulk) { setNote("Provide a verification rationale before closing the review (accountability)."); return; }
    setSubmitting(true); setNote("Submitting reviewer verdicts…");
    const decisions = verif.package.items.map((it) => {
      const d = verif.verdicts[it.id] || { verdict: "accept", rationale: "" };
      return { itemId: it.id, verdict: d.verdict, rationale: d.rationale.trim() || bulk, reviewerId: "medantir-reviewer" };
    });
    const r = await submitVerification(runId, { packageId: verif.package.id, mode: verif.package.mode, decisions });
    setSubmitting(false);
    if (r.ok && r.state) {
      applyServerState(r.state);
      const hv = r.state.stages?.["human-verify"];
      const oc = r.state.artifacts?.verificationOutcome;
      setOutcome(oc || { status: hv?.status });
      if (hv?.status === "passed") { setVerif(null); setNote("Review closed — human verification passed. Final report released."); }
      else if (hv?.status === "awaiting-human") { loadVerification(runId); setNote("Amendment applied — pipeline re-ran; re-verification required."); }
      else setNote(`Verification returned status: ${hv?.status || "unknown"}.`);
    } else setNote(r.error || "Verification submission failed.");
  };

  const stages = review ? stageStatus(review) : [];
  const prog = review ? progress(review) : null;

  return (
    <div className="space-y-6">
      {!embedded && <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><GitBranch className="h-6 w-6 text-teal-500" /> Review Pipeline
          <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-500 border border-teal-500/30">closed-loop</span>
        </h1>
      </div>}

      {/* project + question */}
      <div className="chrome-surface p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Review project" className="text-xs px-2 py-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none text-white">
            <option value="">select project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && newProject()} aria-label="New review project name" placeholder="new review project…" className="text-xs px-2 py-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none focus:border-teal-500 text-white placeholder-zinc-500" />
          <button onClick={newProject} disabled={!newProjectName.trim()} className="text-[11px] text-teal-500 hover:underline disabled:opacity-40">+ create project</button>
          {review && prog && <span className="text-[11px] font-mono text-zinc-500 ml-auto">{prog.done}/{prog.total} stages · {prog.pct}%</span>}
        </div>
        {!review ? (
          <>
            <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="Enter the review question…" aria-label="Research question" className="w-full text-sm px-3 py-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none focus:border-teal-500 text-white placeholder-zinc-500 resize-none" />
            <button onClick={start} disabled={!pid || !question.trim()} className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"><Play className="h-4 w-4" /> Create review</button>
          </>
        ) : (
          <div className="text-xs">
            <div className="text-zinc-700 dark:text-zinc-300">{review.question}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-zinc-400">
              <span className="text-teal-500 font-bold">{review.methodology.typeName}</span>
              <span>reporting <span className="text-zinc-600 dark:text-zinc-300">{review.methodology.framework}</span></span>
              <span>RoB <span className="text-zinc-600 dark:text-zinc-300">{review.methodology.robTool}</span></span>
            </div>
            <button onClick={runServer} disabled={running} className="mt-2 flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run autonomous pipeline (server)
            </button>
          </div>
        )}
        {note && <div className="text-[11px] font-mono text-teal-500">{note}</div>}
      </div>

      {!pid && <EmptyState icon={GitBranch} title="No project" hint="Select or create a project to hold this review's artifacts." />}

      {/* stage pipeline */}
      {review && (
        <div className="space-y-2">
          {stages.map((s) => (
            <div key={s.id} className={`rounded-xl border p-3 transition-all ${s.complete ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : s.active ? "border-teal-500/30 bg-teal-500/5 text-teal-300" : "border-zinc-800 bg-zinc-950/20 text-zinc-400 opacity-70"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {s.complete ? <Check className="h-4 w-4 text-emerald-400 shrink-0" /> : s.active ? <CircleDot className="h-4 w-4 text-teal-400 shrink-0" /> : <Lock className="h-3.5 w-3.5 text-zinc-500 shrink-0" />}
                  <span className="text-sm font-medium truncate">{s.name}{s.optional && <span className="text-[10px] text-zinc-500 ml-1">optional</span>}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.complete && <button onClick={() => rollback(s.id)} title="Roll back (resets downstream)" className="text-zinc-500 hover:text-amber-400"><RotateCcw className="h-3.5 w-3.5" /></button>}
                  {!s.complete && s.active && <button onClick={() => complete(s.id)} disabled={!s.validation.ok} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white"><Check className="h-3 w-3" /> Complete</button>}
                </div>
              </div>
              {/* Protocol stage inline editor (first concrete stage; others land in later cycles) */}
              {s.id === "protocol" && !s.complete && (
                <textarea value={review.objects.eligibility} onChange={(e) => setEligibility(e.target.value)} rows={2} placeholder="Eligibility criteria (population, intervention/exposure, comparator, outcomes, designs)…" aria-label="Eligibility criteria" className="mt-2 w-full text-xs px-2.5 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none focus:border-teal-500 text-white placeholder-zinc-500 resize-none" />
              )}

              {/* Search stage — live per-database execution with provenance + troubleshooting */}
              {s.id === "search" && s.active && (
                <div className="mt-2 space-y-2">
                  <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search query (defaults to the review question)…" aria-label="Search query" className="w-full text-xs px-2.5 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none focus:border-teal-500 text-white placeholder-zinc-500" />
                  <div className="flex flex-wrap gap-1">
                    {allSources.map((src) => {
                      const on = srcSel.includes(src.id);
                      return (
                        <button key={src.id} onClick={() => toggleSrc(src.id)} title={src.kind === "custom" ? "custom source" : src.id}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${on ? "bg-teal-500/10 border-teal-500/30 text-teal-400" : "border-zinc-800 text-zinc-500 hover:border-teal-500/40"}`}>
                          {src.name}{src.kind === "custom" && " ·c"}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={runSearch} disabled={searching} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg">
                      {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Run search ({srcSel.length})
                    </button>
                    {(review.objects.records || []).length > 0 && (
                      <button onClick={downloadRis} className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-teal-400 text-zinc-300"><Download className="h-3.5 w-3.5" /> RIS ({review.objects.records.length})</button>
                    )}
                  </div>
                  {/* per-database provenance */}
                  {(review.objects.searches || []).length > 0 && (
                    <div className="space-y-1">
                      {review.objects.searches.map((sr) => (
                        <div key={sr.db} className="flex items-center gap-2 text-[11px] font-mono">
                          <span className={`px-1.5 py-0.5 rounded ${sr.status === "ok" ? "bg-emerald-500/10 text-emerald-400" : sr.status === "empty" ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"}`}>{sr.status}</span>
                          <span className="text-zinc-300">{sr.db}</span>
                          <span className="text-zinc-500">· {sr.count} hits · {sr.date}</span>
                        </div>
                      ))}
                      {review.searchSummary && <div className="text-[11px] font-mono text-zinc-500">Σ {review.searchSummary.uniqueRecords} unique / {review.searchSummary.totalHits} hits · {review.searchSummary.sources} sources</div>}
                    </div>
                  )}
                  {/* Search Troubleshooting Agent — flagged sources + suggested fixes (human gate) */}
                  {troubleshoot(review.objects.searches || []).length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400"><Wrench className="h-3 w-3" /> Search troubleshooting</div>
                      {troubleshoot(review.objects.searches).map((t) => (
                        <div key={t.db} className="text-[11px]">
                          <span className="font-mono text-amber-400">{t.db}</span> <span className="text-zinc-400">— {t.cause}{t.error ? `: ${t.error}` : ""}</span>
                          <ul className="list-disc ml-4 text-zinc-500">{t.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Dedup stage — exact + fuzzy clustering, reversible + auditable */}
              {s.id === "dedup" && s.active && (
                <div className="mt-2 space-y-2">
                  <button onClick={runDedup} disabled={!(review.objects.records || []).length} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg">
                    <GitBranch className="h-3.5 w-3.5" /> Run deduplication ({(review.objects.records || []).length} records)
                  </button>
                  {review.objects.dedup && (
                    <>
                      <div className="flex flex-wrap gap-3 text-[11px] font-mono text-zinc-400">
                        <span className="text-emerald-400 font-bold">{review.objects.dedup.unique} unique</span>
                        <span>{review.objects.dedup.duplicates} duplicates</span>
                        <span>{review.objects.dedup.clusters.length} clusters</span>
                        {review.objects.dedup.overrides > 0 && <span className="text-amber-400">{review.objects.dedup.overrides} override(s)</span>}
                        <span className="text-zinc-500 font-medium">method: {review.objects.dedup.method}</span>
                      </div>
                      {/* duplicate clusters — each flagged member can be reversibly un-merged */}
                      <div className="space-y-1.5 max-h-72 overflow-auto">
                        {review.objects.dedup.clusters.slice(0, 25).map((c) => (
                          <div key={c.key} className="rounded-lg border border-zinc-800 bg-zinc-950/30 p-2.5">
                            <div className="text-[11px] font-mono text-zinc-500">{c.method} · {c.size} reports</div>
                            <div className="text-xs font-medium truncate">{(review.objects.records[c.primary] || {}).title || "(untitled)"} <span className="text-[10px] text-emerald-400">primary</span></div>
                            {c.members.filter((i) => i !== c.primary).map((i) => {
                              const rec = review.objects.records[i] || {};
                              return (
                                <div key={i} className="flex items-center justify-between gap-2 mt-1">
                                  <span className="text-[11px] text-zinc-400 truncate">↳ {rec.title || "(untitled)"} {rec.overridden && <span className="text-amber-400">· kept</span>}</span>
                                  {rec.isDuplicate && <button onClick={() => unmerge(i)} title="Not a duplicate (reversible)" className="text-[10px] text-amber-400 hover:underline shrink-0">not a dup</button>}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        {review.objects.dedup.clusters.length > 25 && <div className="text-[11px] text-zinc-500 font-mono">+{review.objects.dedup.clusters.length - 25} more clusters</div>}
                      </div>
                    </>
                  )}
                </div>
              )}
              {s.active && !s.validation.ok && (
                <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-500"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /> {s.validation.issues.join(" ")}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* server pipeline run result */}
      {serverRun && (
        <div className="chrome-surface p-4 space-y-2 !border-teal-500/30">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-teal-400">Autonomous run · server pipeline</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {Object.entries(serverRun.stages).map(([id, s]) => (
              <div key={id} className={`text-[10px] font-mono px-2 py-1 rounded flex items-center gap-1 ${s.status === "passed" ? "bg-emerald-500/10 text-emerald-400" : s.status === "awaiting-human" ? "bg-amber-500/10 text-amber-400" : s.status === "running" ? "bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]" : s.status === "failed" ? "bg-rose-500/10 text-rose-400" : "bg-zinc-950/40 text-zinc-500"}`}>
                {s.status === "passed" ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />} {id}
              </div>
            ))}
          </div>
          {serverRun.artifacts?.finalReport && (
            <pre className="text-[11px] whitespace-pre-wrap text-zinc-300 max-h-72 overflow-auto border-t border-teal-500/20 pt-2">{typeof serverRun.artifacts.finalReport === "string" ? serverRun.artifacts.finalReport.slice(0, 2500) : JSON.stringify(serverRun.artifacts.finalReport, null, 2).slice(0, 2500)}</pre>
          )}
        </div>
      )}

      {protocolArtifacts && (
        <div className="chrome-surface p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Save className="h-4 w-4 text-teal-500" />
            <span className="text-sm font-semibold text-white">Protocol & registration package</span>
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">prepare-only</span>
          </div>
          {protocolArtifacts.protocol && (
            <div className="grid md:grid-cols-3 gap-2 text-[11px] font-mono">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"><span className="text-zinc-500">version</span><div className="text-zinc-300">{protocolArtifacts.protocol.version}</div></div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"><span className="text-zinc-500">search tests</span><div className="text-zinc-300">{protocolArtifacts.protocol.searchTestReport?.status || "not available"} · peer review {protocolArtifacts.protocol.searchTestReport?.peerReviewStatus || "not set"}</div></div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2"><span className="text-zinc-500">checksum</span><div className="text-zinc-300 truncate" title={protocolArtifacts.protocol.checksum}>{protocolArtifacts.protocol.checksum}</div></div>
            </div>
          )}
          {protocolArtifacts.registration?.receipts?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {protocolArtifacts.registration.receipts.map((receipt) => (
                <span key={receipt.target} className="text-[10px] font-mono px-2 py-1 rounded-md border border-zinc-800 text-zinc-300 bg-zinc-950/25">
                  {receipt.target.toUpperCase()} · {receipt.status}
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] text-zinc-500">The engine has generated the review-specific protocol, search-test report, registry field maps, CITATION.cff, and archival metadata. External ORCID/PROSPERO/OSF/Zenodo/GitHub actions remain blocked until OAuth clients, the gateway vault, account permissions, and supervised human handoffs are configured.</p>
        </div>
      )}

      {/* Human verification gate — the review's accountability closure. Blinded mode
          withholds the AI verdict so the reviewer judges the evidence directly. */}
      {verif && (
        <div className="chrome-surface p-4 space-y-3 !border-amber-500/40">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold text-white">Human verification required</span>
            <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">{verif.package.mode}</span>
            <span className="text-[11px] font-mono text-zinc-500 ml-auto">{verif.package.items.length} items</span>
          </div>
          <p className="text-[11px] text-zinc-500">Adjudicate the pipeline's proposed decisions. In <b>blinded</b> mode the machine verdict is hidden — judge each proposition against its evidence. A reject or amend rolls the pipeline back and re-runs; every verdict is written to the override ledger.</p>

          <textarea value={verif.bulk} onChange={(e) => setVerif((v) => ({ ...v, bulk: e.target.value }))} rows={2} placeholder="Verification rationale (required) — applied to any item you don't annotate individually…" aria-label="Verification rationale" className="w-full text-xs px-2.5 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800 outline-none focus:border-amber-500 text-white placeholder-zinc-500 resize-none" />

          <div className="space-y-1.5 max-h-96 overflow-auto">
            {verif.package.items.slice(0, 30).map((it) => {
              const d = verif.verdicts[it.id];
              const verdicts = [
                ["accept", Check, "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"],
                ["reject", X, "bg-rose-500/15 border-rose-500/40 text-rose-400"],
                ["amend", Pencil, "bg-amber-500/15 border-amber-500/40 text-amber-400"],
                ["defer", PauseCircle, "bg-zinc-500/15 border-zinc-500/40 text-zinc-400"],
              ];
              return (
                <div key={it.id} className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-zinc-500">{it.category} · {it.subjectCode}</div>
                      <div className="text-xs font-medium text-white">{it.proposition}</div>
                      {it.context?.title && <div className="text-[11px] text-zinc-400 truncate">{it.context.title}</div>}
                      {it.evidence?.[0]?.quote && <div className="text-[11px] text-zinc-500 italic mt-0.5 line-clamp-2">“{it.evidence[0].quote.slice(0, 200)}”</div>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {verdicts.map(([v, Icon, cls]) => (
                        <button key={v} title={v} onClick={() => setVerdict(it.id, { verdict: v })} className={`p-1 rounded-md border ${d.verdict === v ? cls : "border-transparent text-zinc-500 hover:text-zinc-300"}`}><Icon className="h-3.5 w-3.5" /></button>
                      ))}
                    </div>
                  </div>
                  {d.verdict !== "accept" && (
                    <input value={d.rationale} onChange={(e) => setVerdict(it.id, { rationale: e.target.value })} placeholder={`Reason for ${d.verdict}…`} className="mt-1.5 w-full text-[11px] px-2 py-1 rounded-md bg-zinc-950/40 border border-zinc-800 outline-none focus:border-amber-500 text-white placeholder-zinc-500" />
                  )}
                </div>
              );
            })}
            {verif.package.items.length > 30 && <div className="text-[11px] text-zinc-500 font-mono px-1">+{verif.package.items.length - 30} more items — not shown individually; the verification rationale above applies to them (all accepted unless annotated).</div>}
          </div>

          <button onClick={submitVerdicts} disabled={submitting} className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Submit verdicts & close review
          </button>
        </div>
      )}

      {outcome && (
        <div className={`rounded-xl border p-3 text-xs ${outcome.status === "accepted" || outcome.status === "passed" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400" : "border-amber-500/30 bg-amber-500/5 text-amber-400"}`}>
          <span className="font-mono font-bold uppercase text-[10px]">Verification outcome:</span> {outcome.status}
          {typeof outcome.acceptedCount === "number" && <span className="ml-2 text-zinc-500">{outcome.acceptedCount} accepted · {outcome.amendedCount || 0} amended · {outcome.rejectedCount || 0} rejected</span>}
        </div>
      )}
    </div>
  );
}
