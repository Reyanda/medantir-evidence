import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  listReviewProjects,
  loadStudio,
  persistDataset,
  readDataset,
  activeOutcome,
  updateOutcome,
  syncRowsFromReview,
  computeOutcome,
  outcomeToCsv,
  newManualRow,
  emptyOutcome,
  robColor,
  ROB_LEVELS
} from "../engine/forestRuntime.js";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import { runPipeline, runStage, stageDetails, stageProgress, reviewSummary } from "../engine/srOrchestrator.js";
import { createProject, setActiveProject, activeProject } from "../engine/projectstore.js";
import { runnableSources } from "../engine/academic.js";
import { enabledProviders } from "../engine/providers.js";
import { getTaskPreference, setTaskPreference } from "../engine/taskRouter.js";
import ReviewTab from "./ReviewTab.jsx";
import SearchStrategyBuilder from "./SearchStrategyBuilder.jsx";
import { SearchView } from "./AcademicTab.jsx";
import ProjectFiles from "./ProjectFiles.jsx";
import ResearchLoopView from "./ResearchLoopView.jsx";
import ScientificRuntimeView from "./ScientificRuntimeView.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import BrowserTab from "./BrowserTab.jsx";
import ReaderPanel from "./ReaderPanel.jsx";
import TracerPanel from "./TracerPanel.jsx";
import CommandDock from "./CommandDock.jsx";
import ScreeningGrid from "./ScreeningGrid.jsx";
import ConcordancePanel from "./ConcordancePanel.jsx";
import BridgePanel from "./BridgePanel.jsx";
import SandboxPanel from "./SandboxPanel.jsx";
import QuestionBuilder from "./QuestionBuilder.jsx";
import "../styles/workbench.css";

// The LLM-backed stages of the review pipeline. The studio exposes their route
// because the default (local-first) runs an in-browser model that can take
// minutes per stage on a laptop — an operator with a provider configured needs
// to be able to say so without leaving the canvas.
const LLM_TASKS = [
  "extract-pico", "generate-eligibility", "tiab-screening", "fulltext-screening",
  "extract-data", "assess-rob", "synthesize", "grade-assessment", "generate-prisma",
];

const MODULES = [
  { label: "Question", view: "Question", tab: "QUESTION" },
  { label: "Overview", view: "Overview", tab: "BUILD" },
  { label: "Protocols", view: "Protocols", tab: "BUILD" },
  { label: "Search", view: "Search", tab: "ANALYZE" },
  { label: "Screening", view: "Screening", tab: "ANALYZE" },
  { label: "Extraction", view: "Extraction", tab: "SYNTHESIZE" },
  { label: "Synthesis", view: "Synthesis", tab: "SYNTHESIZE" },
  { label: "Evidence map", view: "Evidence Map", tab: "VISUALIZE" },
  { label: "Figures", view: "Figures", tab: "VISUALIZE" },
  { label: "Reports", view: "Reports", tab: "PUBLISH" },
  { label: "Reader", view: "Reader", tab: "ANALYZE" },
  { label: "Browser", view: "Browser", tab: "ANALYZE" },
  { label: "Tracer", view: "Tracer", tab: "VISUALIZE" },
  { label: "Sandbox & files", view: "Sandbox", tab: "BUILD", hint: "the review's own file layout, YAML manifest and document links" },
  { label: "Model concordance", view: "Concordance", tab: "BUILD", setup: true, hint: "run several models in parallel sandboxes and compare them" },
  { label: "AI model setup", view: "Settings", tab: "BUILD", setup: true, hint: "providers, keys, models, engine mode" },
  { label: "Database setup", view: "Databases", tab: "BUILD", setup: true, hint: "which databases are searchable, their keys and logins" },
  { label: "Compute & folder bridge", view: "Bridge", tab: "BUILD", setup: true, hint: "attach a local folder or your own compute" },
];

// The menu bar carries app chrome only — every item does something real, and an
// item that cannot act right now is disabled rather than silently inert.
const MENUS = [
  {
    label: "File",
    items: [
      { label: "New review project…", run: (c) => { c.setActiveView("Figures"); c.setActiveTab("VISUALIZE"); c.note("Pick a project in the toolbar, or use the empty-state form to create one."); } },
      { label: "Attach working folder…", run: (c) => { c.setActiveView("Bridge"); c.setActiveTab("BUILD"); } },
      { label: "Open reader", run: (c) => { c.setActiveView("Reader"); c.setActiveTab("ANALYZE"); } },
      { sep: true },
      { label: "Re-read review.json", key: "Sync", run: (c) => c.reloadReview(), disabled: ({ review }) => !review },
      { label: "Export outcome CSV", run: (c) => c.exportCSV(), disabled: ({ review }) => !review },
      { label: "Project files", run: (c) => { c.setActiveView("Reports"); c.setActiveTab("PUBLISH"); } },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Add manual plot row", run: (c) => c.addManual(), disabled: ({ review }) => !review },
      { label: "Add outcome", run: (c) => c.addOutcome(), disabled: ({ review }) => !review },
      { sep: true },
      { label: "Question and PRISM blocks", run: (c) => { c.setActiveView("Question"); c.setActiveTab("QUESTION"); } },
      { label: "Search strategy", run: (c) => { c.setActiveView("Protocols"); c.setActiveTab("BUILD"); } },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Left dock", key: "Cmd-1", run: (c) => c.setLeftDock((d) => ({ ...d, open: !d.open })) },
      { label: "Inspector", key: "Cmd-2", run: (c) => c.setRightDock((d) => ({ ...d, open: !d.open })) },
      { label: "Command dock", key: "Cmd-3", run: (c) => c.setBottomDock((d) => ({ ...d, open: !d.open })) },
      { sep: true },
      { label: "Screening grid", run: (c) => { c.setActiveView("Screening"); c.setActiveTab("ANALYZE"); } },
      { label: "Sandbox and files", run: (c) => { c.setActiveView("Sandbox"); c.setActiveTab("BUILD"); } },
      { label: "Figures canvas", run: (c) => { c.setActiveView("Figures"); c.setActiveTab("VISUALIZE"); } },
      { label: "Evidence map", run: (c) => { c.setActiveView("Evidence Map"); c.setActiveTab("VISUALIZE"); } },
    ],
  },
  {
    label: "Run",
    items: [
      { label: "Run pipeline", run: (c) => c.executePipeline(), disabled: ({ review }) => !review },
      { label: "Tracer — raster to vector", run: (c) => { c.setActiveView("Tracer"); c.setActiveTab("VISUALIZE"); } },
      { sep: true },
      { label: "AI model setup", run: (c) => { c.setActiveView("Settings"); c.setActiveTab("BUILD"); } },
      { label: "Database setup", run: (c) => { c.setActiveView("Databases"); c.setActiveTab("BUILD"); } },
      { label: "Compute and folder bridge", run: (c) => { c.setActiveView("Bridge"); c.setActiveTab("BUILD"); } },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "Keyboard map", key: "?", run: (c) => c.setShowKeys((v) => !v) },
      { label: "What runs where", run: (c) => { c.setActiveView("Bridge"); c.setActiveTab("BUILD"); } },
    ],
  },
];

// Modules that already speak the workbench language and own their whole pane.
const NATIVE_VIEWS = ["Question", "Screening", "Concordance", "Reader", "Tracer", "Browser", "Bridge", "Settings", "Databases", "Sandbox"];

// The question comes before the build: it is what everything downstream compiles
// from, so it leads the mode bar.
const MODES = [
  ["QUESTION", "Question"], ["BUILD", "Protocols"], ["ANALYZE", "Search"],
  ["SYNTHESIZE", "Synthesis"], ["VISUALIZE", "Figures"], ["PUBLISH", "Reports"],
];

export default function ForestPlotStudio({
  activeView = "Figures",
  setActiveView = () => {},
  activeTab = "VISUALIZE",
  setActiveTab = () => {}
}) {
  // --- runtime binding ------------------------------------------------------
  const [projects, setProjects] = useState(() => listReviewProjects());
  const [pid, setPid] = useState(() => {
    const activeId = activeProject();
    const reviews = listReviewProjects();
    return reviews.find((p) => p.id === activeId)?.id || reviews[0]?.id || "";
  });
  const [review, setReview] = useState(null);
  const [dataset, setDataset] = useState(() => readDataset(null));
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(null); // { stage, pct, msg, startedAt } | null
  const [elapsed, setElapsed] = useState(0);
  const [newProjectName, setNewProjectName] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [llmRoute, setLlmRoute] = useState(() => getTaskPreference("extract-pico") || "auto");
  // A detached run keeps executing (the stage saves itself into review.json when
  // it finishes); the token stops THIS view from applying a stale result.
  const runToken = useRef(0);

  // --- canvas state ---------------------------------------------------------
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [tableTab, setTableTab] = useState("DATA");
  const [showKeys, setShowKeys] = useState(false);
  const [settingsTab, setSettingsTab] = useState("AI models");
  const [openMenu, setOpenMenu] = useState(null);
  // Handed to the Search Strategy builder when the question tab builds a strategy,
  // so the strategy surface opens already carrying it.
  const [strategyQuestion, setStrategyQuestion] = useState("");
  // Docks are furniture: same place every time, resizable by their gutter,
  // collapsible to reclaim width. Nothing slides in, nothing floats.
  const [leftDock, setLeftDock] = useState({ open: true, width: 270 });
  const [rightDock, setRightDock] = useState({ open: true, width: 300 });
  const [bottomDock, setBottomDock] = useState({ open: true, height: 210 });
  const dragging = useRef(null);
  const [layers, setLayers] = useState({ studies: true, summary: true, axis: true, nullLine: true });

  const allSources = useMemo(() => runnableSources().filter((s) => s.kind === "builtin"), []);

  const note = useCallback((msg, kind = "info") => {
    setLog((prev) => [...prev.slice(-199), { at: Date.now(), msg, kind }]);
  }, []);

  // Load project → review → dataset, and reconcile rows with what the pipeline
  // has actually included. The sync is written back so the canvas and review.json
  // never drift apart.
  useEffect(() => {
    if (!pid) { setReview(null); setDataset(readDataset(null)); return; }
    setActiveProject(pid);
    const { review: r, dataset: d } = loadStudio(pid);
    if (!r) { setReview(null); setDataset(d); return; }
    const target = activeOutcome(d);
    const synced = syncRowsFromReview(target, r);
    const nextDataset = updateOutcome(d, target.id, { rows: synced.outcome.rows });
    const nextReview = synced.added || synced.detached ? persistDataset(pid, r, nextDataset) : r;
    setReview(nextReview);
    setDataset(nextDataset);
    setSelectedRowId(activeOutcome(nextDataset)?.rows[0]?.studyId || null);
    if (synced.added) note(`${synced.added} included stud${synced.added === 1 ? "y" : "ies"} added to the canvas from the pipeline.`);
    if (synced.detached) note(`${synced.detached} row(s) no longer map to an included study — flagged, not deleted.`, "warn");
  }, [pid, note]);

  // An LLM stage on the in-browser engine can take minutes; a frozen-looking
  // button is indistinguishable from a hang, so the run is always timed.
  useEffect(() => {
    if (!running) { setElapsed(0); return undefined; }
    const started = running.startedAt;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);

  // One up-front statement of which inference route the LLM stages will take.
  useEffect(() => {
    if (!review) return;
    const providers = enabledProviders().filter((p) => p.shape !== "local");
    if (providers.length) note(`LLM stages route to ${providers.map((p) => p.label || p.id).join(", ")}.`);
    else note("No API provider is enabled — PICO, screening, extraction, RoB, synthesis and GRADE run on the in-browser model. Expect minutes per stage, and a model download on first use.", "warn");
  }, [review?.question, note]); // eslint-disable-line react-hooks/exhaustive-deps

  const outcome = useMemo(() => activeOutcome(dataset), [dataset]);
  const computed = useMemo(() => computeOutcome(outcome), [outcome]);
  const summary = useMemo(() => (review ? reviewSummary(review) : null), [review]);
  const stages = useMemo(() => (review ? stageDetails(review) : []), [review]);
  const overall = useMemo(() => (review ? stageProgress(review) : { done: 0, total: 0, pct: 0 }), [review]);

  const commit = useCallback((nextDataset) => {
    setDataset(nextDataset);
    setReview((r) => (r ? persistDataset(pid, r, nextDataset) : r));
  }, [pid]);

  const patchOutcome = useCallback((patch) => {
    commit(updateOutcome(dataset, outcome.id, patch));
  }, [commit, dataset, outcome]);

  const patchRow = useCallback((studyId, patch) => {
    patchOutcome({ rows: outcome.rows.map((r) => (r.studyId === studyId ? { ...r, ...patch } : r)) });
  }, [outcome, patchOutcome]);

  // Dock gutters: drag to resize, double-click to collapse.
  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      if (dragging.current === "left") setLeftDock((d) => ({ ...d, width: Math.max(200, Math.min(480, e.clientX)) }));
      else if (dragging.current === "right") setRightDock((d) => ({ ...d, width: Math.max(220, Math.min(560, window.innerWidth - e.clientX)) }));
      else setBottomDock((d) => ({ ...d, height: Math.max(90, Math.min(window.innerHeight - 220, window.innerHeight - e.clientY - 20)) }));
    };
    const up = () => { dragging.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  // Keyboard is the primary input: J/K to move, I/E/M to judge with auto-advance,
  // Cmd-1 / Cmd-2 for the docks, ? for the map. The mouse is the fallback.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const rows = outcome.rows;
      const idx = rows.findIndex((r) => r.studyId === selectedRowId);

      if ((e.metaKey || e.ctrlKey) && e.key === "1") { e.preventDefault(); setLeftDock((d) => ({ ...d, open: !d.open })); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "2") { e.preventDefault(); setRightDock((d) => ({ ...d, open: !d.open })); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === "3") { e.preventDefault(); setBottomDock((d) => ({ ...d, open: !d.open })); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const advance = () => { const next = rows[Math.min(rows.length - 1, idx + 1)]; if (next) setSelectedRowId(next.studyId); };
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); if (rows.length) setSelectedRowId((rows[Math.min(rows.length - 1, idx + 1)] || rows[0]).studyId); break;
        case "k": case "ArrowUp": e.preventDefault(); if (rows.length) setSelectedRowId((rows[Math.max(0, idx - 1)] || rows[0]).studyId); break;
        case "i": if (selectedRowId) { patchRow(selectedRowId, { include: true }); advance(); } break;
        case "e": if (selectedRowId) { patchRow(selectedRowId, { include: false }); advance(); } break;
        case "m": if (selectedRowId) { patchRow(selectedRowId, { rob: "Some", robOverride: true }); advance(); } break;
        case "?": setShowKeys((v) => !v); break;
        case "Escape": setShowKeys(false); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [outcome, selectedRowId, patchRow]);

  // --- project / review lifecycle -------------------------------------------
  const createReviewProject = () => {
    const name = newProjectName.trim();
    const question = newQuestion.trim();
    if (!name || !question) { note("A project name and a review question are both required.", "warn"); return; }
    const project = createProject(name, { projectType: "systematic-review", mode: "academic" });
    const r = createReview(question);
    r.createdAt = Date.now();
    r.selectedSources = allSources.slice(0, 2).map((s) => s.id);
    saveReview(project.id, r);
    setProjects(listReviewProjects());
    setPid(project.id);
    setNewProjectName("");
    setNewQuestion("");
    note(`Review project "${project.name}" created — run the pipeline from the protocol stage.`);
  };

  const reloadReview = useCallback(() => {
    const r = loadReview(pid);
    if (!r) return null;
    const d = readDataset(r);
    const target = activeOutcome(d);
    const synced = syncRowsFromReview(target, r);
    const nextDataset = updateOutcome(d, target.id, { rows: synced.outcome.rows });
    const nextReview = persistDataset(pid, r, nextDataset);
    setReview(nextReview);
    setDataset(nextDataset);
    if (synced.added) note(`${synced.added} included stud${synced.added === 1 ? "y" : "ies"} added to the canvas.`);
    return nextReview;
  }, [pid, note]);

  // Eligibility criteria are a human artifact: the protocol stage drafts them
  // from PICO when an LLM is reachable, but the gate must be satisfiable
  // without one, so they stay directly editable.
  const patchReview = (patch) => {
    if (!review) return;
    const updated = { ...review, ...patch };
    saveReview(pid, updated);
    setReview(updated);
  };
  const setEligibility = (text) => patchReview({ objects: { ...review.objects, eligibility: text } });
  const toggleSource = (id) => {
    if (!review) return;
    const current = review.selectedSources || [];
    patchReview({ selectedSources: current.includes(id) ? current.filter((s) => s !== id) : [...current, id] });
  };

  // --- pipeline execution ---------------------------------------------------
  const track = useCallback((token, startedAt) => ({
    onProgress: (p) => { if (runToken.current === token) setRunning({ stage: p.stage, pct: p.pct, msg: p.msg, startedAt }); },
    onNote: (m) => { if (runToken.current === token) note(m); },
  }), [note]);

  const detach = () => {
    runToken.current += 1;
    setRunning(null);
    note("Detached from the run. The stage keeps executing and writes its result to review.json when it finishes — press Sync to pick it up.", "warn");
  };

  const executePipeline = async () => {
    if (!review || running) return;
    const token = ++runToken.current;
    const startedAt = Date.now();
    setRunning({ stage: "pipeline", pct: 0, msg: "starting", startedAt });
    note("Pipeline started.");
    const result = await runPipeline(pid, review, track(token, startedAt));
    if (runToken.current !== token) return;
    setRunning(null);
    if (result.ok) note(`Pipeline complete — ${stageProgress(result.review).pct}% of stages validated.`, "ok");
    else note(`Pipeline stopped at "${result.stage}": ${result.reason || (result.issues || []).join(" ")}`, "err");
    reloadReview();
  };

  const executeStage = async (stageId) => {
    if (!review || running) return;
    const token = ++runToken.current;
    const startedAt = Date.now();
    setRunning({ stage: stageId, pct: 0, msg: "starting", startedAt });
    const result = await runStage(pid, review, stageId, track(token, startedAt));
    if (runToken.current !== token) return;
    setRunning(null);
    if (result.ok) note(`Stage "${stageId}" validated and completed.`, "ok");
    else note(`Stage "${stageId}" did not complete: ${result.reason || (result.issues || []).join(" ")}`, "err");
    reloadReview();
  };

  // --- canvas actions -------------------------------------------------------
  const addManual = () => {
    const row = newManualRow(outcome.rows.length);
    patchOutcome({ rows: [...outcome.rows, row] });
    setSelectedRowId(row.studyId);
    note(`Manual row "${row.label}" added — it is not derived from the pipeline.`, "warn");
  };

  const addOutcome = () => {
    const id = `outcome_${dataset.outcomes.length + 1}`;
    commit({ ...dataset, outcomes: [...dataset.outcomes, emptyOutcome(`Outcome ${dataset.outcomes.length + 1}`, id)], activeOutcomeId: id });
  };

  const removeRow = (studyId) => {
    const row = outcome.rows.find((r) => r.studyId === studyId);
    if (!row) return;
    if (row.source === "runtime") {
      patchRow(studyId, { include: false });
      note(`"${row.label}" comes from the pipeline — excluded from this analysis rather than deleted.`, "warn");
      return;
    }
    patchOutcome({ rows: outcome.rows.filter((r) => r.studyId !== studyId) });
    setSelectedRowId(null);
  };

  const exportCSV = () => {
    const blob = new Blob([outcomeToCsv(outcome, computed)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(outcome.name || "outcome").replace(/\W+/g, "-").toLowerCase()}-${outcome.measure}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const selectedRow = outcome.rows.find((r) => r.studyId === selectedRowId) || null;
  const selectedCalc = computed.rows.find((r) => r.studyId === selectedRowId) || null;
  const het = computed.ok ? computed.heterogeneity : null;
  const project = projects.find((p) => p.id === pid) || null;

  // Log scale bounded by the data actually present.
  const bounds = useMemo(() => {
    if (!computed.ok) return { min: 0.05, max: 10 };
    const vals = computed.rows.flatMap((r) => [r.lower, r.upper]).concat(computed.pooled.ci).filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { min: 0.05, max: 10 };
    return { min: Math.min(0.05, Math.min(...vals) * 0.8), max: Math.max(10, Math.max(...vals) * 1.25) };
  }, [computed]);

  const getXPos = (val) => {
    if (!Number.isFinite(val) || val <= 0) return 0;
    const lo = Math.log(bounds.min), hi = Math.log(bounds.max);
    return Math.max(0, Math.min(100, ((Math.log(val) - lo) / (hi - lo)) * 100));
  };
  const ticks = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].filter((t) => t >= bounds.min && t <= bounds.max);

  const decisionClass = (row) => (row.detached ? "pend" : !row.include ? "exc" : computed.rows.some((c) => c.studyId === row.studyId) ? "inc" : "maybe");
  const decisionLabel = (row) => (row.detached ? "DETACH" : !row.include ? "EXCL" : computed.rows.some((c) => c.studyId === row.studyId) ? "POOLED" : "NO 2x2");

  return (
    <div className="wb">
      {/* MENU BAR — app chrome only; the review flow lives on its own strip */}
      <div className="wb-menubar" onMouseLeave={() => setOpenMenu(null)}>
        <span className="wb-brand">MED<b>ANTIR</b> Workbench</span>
        {MENUS.map((menu) => (
          <span
            key={menu.label}
            className={`wb-menu-item ${openMenu === menu.label ? "on" : ""}`}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
          >
            {menu.label}
            {openMenu === menu.label && (
              <div className="wb-menu" onClick={(e) => e.stopPropagation()}>
                {menu.items.map((item, i) => (
                  item.sep ? <div key={i} className="sep" /> : (
                    <div
                      key={i}
                      className={`mi ${item.disabled?.({ review, pid }) ? "disabled" : ""}`}
                      onClick={() => {
                        if (item.disabled?.({ review, pid })) return;
                        item.run({
                          setActiveView, setActiveTab, setLeftDock, setRightDock, setBottomDock, setShowKeys,
                          executePipeline, reloadReview, exportCSV, note, review, pid, addManual, addOutcome,
                        });
                        setOpenMenu(null);
                      }}
                    >
                      <span>{item.label}</span>
                      {item.key && <kbd>{item.key}</kbd>}
                    </div>
                  )
                ))}
              </div>
            )}
          </span>
        ))}
        <span className="wb-spacer" />
        <span className="wb-env" title={review?.question || ""}>
          {project ? project.name : "no project"}
          {review?.question ? ` · ${review.question.slice(0, 78)}${review.question.length > 78 ? "…" : ""}` : ""}
          {" · "}{overall.done}/{overall.total} stages
        </span>
      </div>

      {/* TOOLBAR RIBBON — the review flow leads it, then the tools */}
      <div className="wb-toolbar">
        <div className="wb-tb-group">
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--fg-faint)", paddingRight: 4 }}>Flow</span>
          {MODES.map(([mode, view]) => (
            <button
              key={mode}
              className={`wb-btn ${activeTab === mode ? "on" : ""}`}
              onClick={() => { setActiveTab(mode); setActiveView(view); }}
            >
              {mode.charAt(0) + mode.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="wb-tb-group">
          <select className="wb-select" value={pid} onChange={(e) => setPid(e.target.value)} style={{ width: 190, height: 22 }}>
            {projects.length === 0 && <option value="">No review project</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="wb-tb-group">
          {running ? (
            <button className="wb-btn on" onClick={detach} title="Stop waiting — the run continues in the background">
              Running {elapsed}s · Detach
            </button>
          ) : (
            <button className="wb-btn" onClick={executePipeline} disabled={!review} title="Run every stage the gates allow">
              Run pipeline
            </button>
          )}
          <button className="wb-btn" onClick={reloadReview} disabled={!review} title="Re-read review.json and re-sync canvas rows">Sync</button>
          <button className="wb-btn" onClick={exportCSV} disabled={!review} title="Export this outcome with pooled row">Export CSV</button>
        </div>

        {review && activeView === "Figures" && (
          <div className="wb-tb-group">
            <select className="wb-select" value={dataset.activeOutcomeId} onChange={(e) => commit({ ...dataset, activeOutcomeId: e.target.value })} style={{ width: 150, height: 22 }}>
              {dataset.outcomes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button className="wb-btn" onClick={addOutcome} title="Add outcome">+</button>
            <span className="wb-sep" />
            <select className="wb-select" value={outcome.measure} onChange={(e) => patchOutcome({ measure: e.target.value })} style={{ height: 22 }}>
              <option value="RR">Risk ratio</option>
              <option value="OR">Odds ratio</option>
            </select>
            <select className="wb-select" value={outcome.model} onChange={(e) => patchOutcome({ model: e.target.value })} style={{ height: 22 }}>
              <option value="random">Random effects</option>
              <option value="fixed">Fixed effect</option>
            </select>
          </div>
        )}

        {review && activeView === "Figures" && (
          <div className="wb-tb-group">
            {[["studies", "Studies"], ["summary", "Diamond"], ["axis", "Axis"], ["nullLine", "Null"]].map(([key, label]) => (
              <button key={key} className={`wb-btn ${layers[key] ? "on" : ""}`} onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}>
                {label}
              </button>
            ))}
            <span className="wb-sep" />
            <button className="wb-btn" onClick={addManual} title="Add a row not derived from the pipeline">Add row</button>
          </div>
        )}

        <span className="wb-spacer" />

        <div className="wb-tb-group">
          <button className={`wb-btn ${leftDock.open ? "on" : ""}`} onClick={() => setLeftDock((d) => ({ ...d, open: !d.open }))} title="Toggle left dock (Cmd-1)">Left</button>
          <button className={`wb-btn ${rightDock.open ? "on" : ""}`} onClick={() => setRightDock((d) => ({ ...d, open: !d.open }))} title="Toggle right dock (Cmd-2)">Right</button>
          <button className={`wb-btn ${bottomDock.open ? "on" : ""}`} onClick={() => setBottomDock((d) => ({ ...d, open: !d.open }))} title="Toggle question and composer dock (Cmd-3)">Dock</button>
          <button className={`wb-btn ${showKeys ? "on" : ""}`} onClick={() => setShowKeys((v) => !v)} title="Keyboard map (?)">Keys</button>
        </div>
      </div>

      {/* WORKSPACE: left = pipeline/filters, centre = the grid, right = inspector */}
      <div className="wb-workspace">
        {leftDock.open && (
          <div className="wb-panel" style={{ width: leftDock.width, flexShrink: 0 }}>
            <div className="wb-panel-head">
              <span className="title">Pipeline</span>
              <span className="wb-count">{overall.done}/{overall.total}</span>
              <span className="wb-spacer" />
              <span className="wb-count">{overall.pct}%</span>
            </div>

            <div className="wb-panel-body">
              {!review && <div style={{ padding: "6px 8px", color: "var(--fg-faint)", fontSize: 11 }}>No review loaded.</div>}
              {stages.map((s, i) => {
                const isRunning = running?.stage === s.id;
                const firstBlocked = stages.findIndex((x) => x.blocked && x.status !== "complete") === i;
                const colour = s.status === "complete" ? "var(--ok)" : isRunning ? "var(--warn)" : "var(--fg-faint)";
                return (
                  <div key={s.id}>
                    <div className={`wb-row ${isRunning ? "soft" : ""}`}>
                      <span className="dot" style={{ background: colour }} />
                      <span className="lbl">{s.name}</span>
                      {s.pendingCount > 0 && <span className="n" style={{ color: "var(--warn)" }}>{s.pendingCount}</span>}
                      {s.status !== "complete" && (
                        <button
                          className="wb-btn"
                          style={{ height: 16, padding: "0 5px", fontSize: 10 }}
                          onClick={() => executeStage(s.id)}
                          disabled={!!running || s.blocked}
                          title={s.blocked ? s.blockReason : `Run ${s.name}`}
                        >
                          Run
                        </button>
                      )}
                    </div>
                    {s.blocked && s.status !== "complete" && firstBlocked && (
                      <div style={{ padding: "0 8px 2px 22px", fontSize: 10, color: "var(--fg-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.blockReason}>
                        {s.blockReason}
                      </div>
                    )}
                  </div>
                );
              })}

              {review && (
                <>
                  <div className="wb-insp-title">Inference route</div>
                  <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
                    {[["auto", "Auto"], ["local", "In-browser"], ["api", "Provider"]].map(([value, label]) => (
                      <button
                        key={value}
                        className={`wb-tag ${llmRoute === value ? "on" : ""}`}
                        onClick={() => {
                          LLM_TASKS.forEach((t) => setTaskPreference(t, value === "auto" ? null : value));
                          setLlmRoute(value);
                          note(`LLM stages routed to: ${label.toLowerCase()}.`);
                        }}
                        title={value === "local" ? "In-browser model: no network, minutes per stage" : value === "api" ? "Configured API provider" : "Local first, provider on failure"}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="wb-insp-title">
                    Databases this review searches
                    <span className="wb-spacer" />
                    <button
                      className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10, textTransform: "none", letterSpacing: 0 }}
                      onClick={() => { setActiveView("Databases"); setActiveTab("BUILD"); }}
                      title="Add databases, store their keys, and enable platforms"
                    >
                      setup
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                    {allSources.map((s) => (
                      <button key={s.id} className={`wb-tag ${(review.selectedSources || []).includes(s.id) ? "on" : ""}`} onClick={() => toggleSource(s.id)}>
                        {s.name}
                      </button>
                    ))}
                  </div>

                </>
              )}

              {/* Navigation is never gated on a loaded review: the setup surfaces
                  are how an operator gets to a working review in the first place. */}
              <div className="wb-insp-title">Modules</div>
              {MODULES.map((m) => (
                <div
                  key={m.view}
                  className={`wb-row ${activeView === m.view ? "sel" : ""}`}
                  onClick={() => { setActiveView(m.view); setActiveTab(m.tab); }}
                  title={m.hint || m.label}
                >
                  <span className="lbl">{m.label}</span>
                  {m.setup && <span className="n">setup</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {leftDock.open && (
          <div
            className="wb-gutter"
            onMouseDown={() => { dragging.current = "left"; document.body.style.cursor = "col-resize"; }}
            onDoubleClick={() => setLeftDock((d) => ({ ...d, open: false }))}
            title="Drag to resize, double-click to collapse (Cmd-1)"
          />
        )}

        {/* CENTRE */}
        <div className="wb-panel center">
          {NATIVE_VIEWS.includes(activeView) ? (
            /* Modules already speaking the workbench language: no embed wrapper,
               no padding — they own their full pane like any other dock. */
            <>
              <div className="wb-panel-head">
                <span className="title">{activeView}</span>
                {activeView === "Settings" && (
                  <>
                    <span className="wb-spacer" />
                    {["AI models", "Logins", "Services"].map((t) => (
                      <button key={t} className={`wb-btn ${settingsTab === t ? "on" : ""}`} onClick={() => setSettingsTab(t)}>{t}</button>
                    ))}
                  </>
                )}
              </div>
              <div className={`wb-panel-body ${activeView === "Browser" ? "wb-embed" : ""}`}>
                {activeView === "Question" && (
                  <QuestionBuilder
                    projectId={pid}
                    review={review}
                    onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                    onNote={note}
                    onOpenStrategy={(q) => { setStrategyQuestion(q); setActiveView("Protocols"); setActiveTab("BUILD"); }}
                  />
                )}
                {activeView === "Screening" && (
                  <ScreeningGrid
                    projectId={pid}
                    review={review}
                    onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                    onNote={note}
                  />
                )}
                {activeView === "Concordance" && (
                  <ConcordancePanel
                    projectId={pid} review={review}
                    onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                    onNote={note}
                  />
                )}
                {activeView === "Sandbox" && (
                  <SandboxPanel
                    projectId={pid} review={review}
                    onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                    onNote={note}
                  />
                )}
                {activeView === "Bridge" && <BridgePanel projectId={pid} onNote={note} />}
                {activeView === "Reader" && <ReaderPanel projectId={pid} />}
                {activeView === "Tracer" && <TracerPanel projectId={pid} />}
                {activeView === "Browser" && <BrowserTab />}
                {activeView === "Settings" && <SettingsPanel tab={settingsTab} onNote={note} />}
                {activeView === "Databases" && <SettingsPanel tab="Databases" onNote={note} />}
              </div>
            </>
          ) : activeView !== "Figures" ? (
            <>
              <div className="wb-panel-head"><span className="title">{activeView}</span></div>
              <div className="wb-panel-body wb-embed" style={{ padding: 8 }}>
                {activeView === "Protocols" && <SearchStrategyBuilder initialQuestion={strategyQuestion || review?.question || ""} />}
                {activeView === "Search" && <SearchView goToSources={() => { setActiveView("Databases"); setActiveTab("BUILD"); }} />}
                {(activeView === "Extraction" || activeView === "Synthesis") && <ReviewTab embedded />}
                {activeView === "Evidence Map" && <ResearchLoopView />}
                {activeView === "Overview" && <ScientificRuntimeView />}
                {activeView === "Reports" && <ProjectFiles />}
              </div>
            </>
          ) : !review ? (
            <>
              <div className="wb-panel-head"><span className="title">No review bound</span></div>
              <div className="wb-panel-body" style={{ padding: 16 }}>
                <div style={{ maxWidth: 420 }}>
                  <p style={{ fontSize: 11.5, color: "var(--fg-dim)", lineHeight: 1.6, marginBottom: 10 }}>
                    The forest plot renders the studies a review pipeline has included. Create a
                    review project and run the pipeline, or pick an existing project in the toolbar.
                  </p>
                  <div className="wb-prop" style={{ gridTemplateColumns: "92px 1fr", padding: "3px 0" }}>
                    <span className="k">Project</span>
                    <input className="wb-input" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name" />
                  </div>
                  <div className="wb-prop" style={{ gridTemplateColumns: "92px 1fr", padding: "3px 0", alignItems: "start" }}>
                    <span className="k">Question</span>
                    <textarea className="wb-textarea" rows={3} value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="PICO is extracted from this at the protocol stage" style={{ width: "100%" }} />
                  </div>
                  <button className="wb-btn on" style={{ marginTop: 8 }} onClick={createReviewProject}>Create review project</button>
                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-faint)" }}>
                    Then open the Question tab: the PRISM decomposition written there is what the
                    search strategy and the pipeline compile from.
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* grid toolbar: the numbers that matter, always visible */}
              <div className="wb-panel-head">
                <input
                  className="wb-input"
                  value={outcome.name}
                  onChange={(e) => patchOutcome({ name: e.target.value })}
                  style={{ width: 240, textTransform: "none", letterSpacing: 0, color: "var(--fg-bright)" }}
                />
                <span className="wb-count">k={computed.ok ? computed.k : 0}</span>
                <span className="wb-count">
                  {computed.ok ? `${outcome.measure} ${computed.pooled.effect} (${computed.pooled.ci[0]}–${computed.pooled.ci[1]})` : "no pooled estimate"}
                </span>
                {het && <span className="wb-count">I2 {het.I2}% · Q {het.Q} · df {het.df} · p {het.pQ}</span>}
                <span className="wb-spacer" />
                <span className="wb-count">{computed.ok ? computed.modelName : outcome.model}</span>
              </div>

              {/* the plot */}
              <div style={{ flex: "1 1 auto", overflow: "auto", minHeight: 0, borderBottom: "1px solid var(--line)" }}>
                {!computed.ok ? (
                  <div style={{ padding: 16, fontSize: 11.5, color: "var(--fg-dim)", maxWidth: 620, lineHeight: 1.6 }}>
                    <div style={{ color: "var(--warn)", fontFamily: "var(--mono)", marginBottom: 6 }}>{computed.reason}</div>
                    {outcome.rows.length
                      ? "Rows are bound to the studies the pipeline included. Enter each study's 2x2 counts in the grid below or the inspector; the pool recomputes as soon as one row is complete."
                      : "Run the pipeline through full-text screening. Every included study lands here as a row."}
                  </div>
                ) : (
                  <table className="wb-grid">
                    <thead>
                      <tr>
                        <th style={{ width: "22%" }}>Study</th>
                        <th style={{ width: 60 }}>Ev T</th>
                        <th style={{ width: 60 }}>N T</th>
                        <th style={{ width: 60 }}>Ev C</th>
                        <th style={{ width: 60 }}>N C</th>
                        <th>{outcome.measure} IV, {outcome.model === "fixed" ? "fixed" : "random"}, 95% CI</th>
                        <th style={{ width: 168 }}>{outcome.measure} (95% CI)</th>
                        <th style={{ width: 62 }}>Weight</th>
                        <th style={{ width: 34 }}>RoB</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layers.studies && computed.rows.map((row) => (
                        <tr key={row.studyId} className={selectedRowId === row.studyId ? "sel" : ""} onClick={() => setSelectedRowId(row.studyId)}>
                          <td title={row.label}>{row.label}</td>
                          <td className="wb-num">{row.eventsT}</td>
                          <td className="wb-num">{row.totalT}</td>
                          <td className="wb-num">{row.eventsC}</td>
                          <td className="wb-num">{row.totalC}</td>
                          <td style={{ position: "relative", padding: 0 }}>
                            <div style={{ position: "relative", height: "var(--row-h)" }}>
                              {layers.nullLine && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${getXPos(1)}%`, width: 1, background: "var(--line-strong)" }} />}
                              <div style={{ position: "absolute", top: "50%", left: `${getXPos(row.lower)}%`, width: `${Math.max(0.4, getXPos(row.upper) - getXPos(row.lower))}%`, height: 1, background: "var(--fg-dim)" }} />
                              <div
                                style={{
                                  position: "absolute", top: "50%", left: `${getXPos(row.effect)}%`,
                                  width: Math.max(5, Math.min(13, 5 + row.weight / 5)),
                                  height: Math.max(5, Math.min(13, 5 + row.weight / 5)),
                                  transform: "translate(-50%, -50%)", background: robColor(row.rob),
                                }}
                              />
                            </div>
                          </td>
                          <td className="wb-num">{row.effect} ({row.lower}–{row.upper})</td>
                          <td className="wb-num">{row.weight?.toFixed(1)}</td>
                          <td style={{ textAlign: "center" }}>
                            <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: robColor(row.rob) }} title={`Risk of bias: ${row.rob}`} />
                          </td>
                        </tr>
                      ))}
                      {layers.summary && (
                        <tr style={{ background: "var(--bg-header)" }}>
                          <td style={{ fontWeight: 600, color: "var(--fg-bright)" }}>Total (95% CI)</td>
                          <td className="wb-num">{computed.totals.eventsT}</td>
                          <td className="wb-num">{computed.totals.totalT}</td>
                          <td className="wb-num">{computed.totals.eventsC}</td>
                          <td className="wb-num">{computed.totals.totalC}</td>
                          <td style={{ position: "relative", padding: 0 }}>
                            <div style={{ position: "relative", height: "var(--row-h)" }}>
                              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${getXPos(1)}%`, width: 1, background: "var(--line-strong)" }} />
                              <svg
                                viewBox="0 0 100 16" preserveAspectRatio="none"
                                style={{
                                  position: "absolute", top: "50%", transform: "translateY(-50%)",
                                  left: `${getXPos(computed.pooled.ci[0])}%`,
                                  width: `${Math.max(1, getXPos(computed.pooled.ci[1]) - getXPos(computed.pooled.ci[0]))}%`,
                                  height: 12,
                                }}
                              >
                                <polygon points="0,8 50,0 100,8 50,16" fill="var(--fg-dim)" stroke="var(--fg-bright)" strokeWidth="1" />
                              </svg>
                            </div>
                          </td>
                          <td className="wb-num" style={{ color: "var(--fg-bright)" }}>
                            {computed.pooled.effect} ({computed.pooled.ci[0]}–{computed.pooled.ci[1]})
                          </td>
                          <td className="wb-num" style={{ color: "var(--fg-bright)" }}>100.0</td>
                          <td />
                        </tr>
                      )}
                    </tbody>
                    {layers.axis && (
                      /* The axis lives in the table so its ticks cannot drift out
                         of register with the column the intervals are drawn in. */
                      <tfoot>
                        <tr>
                          <td colSpan={5} style={{ borderRight: "1px solid var(--line)" }} />
                          <td style={{ padding: 0, height: 34 }}>
                            <div style={{ position: "relative", height: 34, fontFamily: "var(--mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                              {ticks.map((t) => (
                                <div key={t} style={{ position: "absolute", left: `${getXPos(t)}%`, transform: "translateX(-50%)", textAlign: "center" }}>
                                  <div style={{ width: 1, height: 4, background: "var(--line-strong)", margin: "0 auto 2px" }} />
                                  {t}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td colSpan={3} />
                        </tr>
                        <tr>
                          <td colSpan={5} style={{ borderRight: "1px solid var(--line)" }} />
                          <td colSpan={4} style={{ padding: "0 8px 4px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "var(--fg-dim)" }}>
                              <span>{"<"} favours intervention</span>
                              <span>favours comparator {">"}</span>
                            </div>
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}

                {computed.excluded.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--line)", padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-faint)" }}>
                    <div style={{ textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 2 }}>Not in the pooled estimate ({computed.excluded.length})</div>
                    {computed.excluded.slice(0, 8).map((e, i) => <div key={i}>{e.label} — {e.reason}</div>)}
                    {computed.excluded.length > 8 && <div>…{computed.excluded.length - 8} more</div>}
                  </div>
                )}
              </div>

              {/* bottom dock */}
              <div style={{ height: 190, display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div className="wb-tabs">
                  {["DATA", "PROTOCOL", "RECORDS", "LOG", "PROVENANCE"].map((t) => (
                    <div key={t} className={`pt ${tableTab === t ? "active" : ""}`} onClick={() => setTableTab(t)}>{t}</div>
                  ))}
                  <span className="wb-spacer" />
                  <div className="pt" style={{ borderRight: "none", color: "var(--fg-faint)" }}>
                    {outcome.rows.length} rows · {computed.ok ? computed.k : 0} pooled
                  </div>
                </div>

                <div className="wb-panel-body">
                  {tableTab === "DATA" && (
                    <table className="wb-grid">
                      <thead>
                        <tr>
                          <th style={{ width: "26%" }}>Study</th>
                          <th style={{ width: 64 }}>Ev T</th>
                          <th style={{ width: 64 }}>N T</th>
                          <th style={{ width: 64 }}>Ev C</th>
                          <th style={{ width: 64 }}>N C</th>
                          <th style={{ width: 70 }}>{outcome.measure}</th>
                          <th style={{ width: 120 }}>95% CI</th>
                          <th style={{ width: 64 }}>Weight</th>
                          <th style={{ width: 70 }}>RoB</th>
                          <th style={{ width: 76 }}>State</th>
                          <th style={{ width: 76 }}>Origin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outcome.rows.map((r) => {
                          const calc = computed.rows.find((c) => c.studyId === r.studyId);
                          const cell = (field) => (
                            <input
                              className="wb-cell-input"
                              type="number"
                              value={r[field] ?? ""}
                              onChange={(e) => patchRow(r.studyId, { [field]: e.target.value === "" ? null : Number(e.target.value) })}
                            />
                          );
                          return (
                            <tr
                              key={r.studyId}
                              className={`${selectedRowId === r.studyId ? "sel" : ""} ${r.detached || !r.include ? "muted" : ""}`}
                              onClick={() => setSelectedRowId(r.studyId)}
                            >
                              <td title={r.label}>{r.label}</td>
                              <td>{cell("eventsT")}</td>
                              <td>{cell("totalT")}</td>
                              <td>{cell("eventsC")}</td>
                              <td>{cell("totalC")}</td>
                              <td className="wb-num">{calc ? calc.effect : "—"}</td>
                              <td className="wb-num">{calc ? `${calc.lower}–${calc.upper}` : "—"}</td>
                              <td className="wb-num">{calc ? calc.weight.toFixed(1) : "—"}</td>
                              <td><span className="wb-dec" style={{ background: "transparent", color: robColor(r.rob), border: "1px solid var(--line-strong)" }}>{r.rob}</span></td>
                              <td><span className={`wb-dec ${decisionClass(r)}`}>{decisionLabel(r)}</span></td>
                              <td style={{ color: "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{r.source}</td>
                            </tr>
                          );
                        })}
                        {outcome.rows.length === 0 && (
                          <tr><td colSpan={11} style={{ color: "var(--fg-faint)" }}>No rows — run the pipeline through full-text screening.</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {tableTab === "PROTOCOL" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: 8 }}>
                      <div>
                        <div className="wb-insp-title" style={{ background: "transparent", borderBottom: "none", padding: "0 0 4px" }}>Eligibility criteria — gates the protocol stage</div>
                        <textarea className="wb-textarea" style={{ width: "100%" }} rows={7} value={review.objects.eligibility || ""} onChange={(e) => setEligibility(e.target.value)} placeholder={"INCLUDE: …\nEXCLUDE: …"} />
                      </div>
                      <div>
                        <div className="wb-insp-title" style={{ background: "transparent", borderBottom: "none", padding: "0 0 4px" }}>PICO — from the protocol stage</div>
                        {review.protocol?.pico ? (
                          <>
                            {["population", "intervention", "comparator"].map((k) => (
                              <div className="wb-prop" key={k}><span className="k">{k}</span><span className="v">{review.protocol.pico[k] || "—"}</span></div>
                            ))}
                            <div className="wb-prop"><span className="k">outcomes</span><span className="v">{(review.protocol.pico.outcomes || []).join(", ") || "—"}</span></div>
                            <div className="wb-prop"><span className="k">concepts</span><span className="v mono">{(review.protocol.concepts || []).length} · {review.protocol.strategySource || "—"}</span></div>
                          </>
                        ) : (
                          <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>Not extracted yet — run the protocol stage.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {tableTab === "RECORDS" && (
                    <table className="wb-grid">
                      <thead>
                        <tr>
                          <th>Title</th><th style={{ width: 56 }}>Year</th><th style={{ width: 110 }}>Source</th>
                          <th style={{ width: 80 }}>TIAB</th><th style={{ width: 90 }}>Full text</th><th style={{ width: 52 }}>Dup</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(review.objects.records || []).slice(0, 400).map((rec) => (
                          <tr key={rec.id}>
                            <td title={rec.title}>{rec.title}</td>
                            <td className="wb-num">{rec.year || "—"}</td>
                            <td style={{ color: "var(--fg-faint)" }}>{rec.source || "—"}</td>
                            <td>{rec.tiab ? <span className={`wb-dec ${rec.tiab === "include" ? "inc" : rec.tiab === "exclude" ? "exc" : "maybe"}`}>{rec.tiab}</span> : <span className="wb-dec pend">pending</span>}</td>
                            <td>{rec.fulltext?.decision || "—"}</td>
                            <td>{rec.isDuplicate ? "dup" : ""}</td>
                          </tr>
                        ))}
                        {(review.objects.records || []).length === 0 && (
                          <tr><td colSpan={6} style={{ color: "var(--fg-faint)" }}>No records — run the search stage.</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}

                  {tableTab === "LOG" && (
                    <div className="wb-log">
                      {log.length === 0 && <div style={{ color: "var(--fg-faint)" }}>Nothing has run in this session yet.</div>}
                      {log.slice().reverse().map((l, i) => (
                        <div key={i} className={l.kind}>
                          <span className="t">{new Date(l.at).toLocaleTimeString()} </span>{l.msg}
                        </div>
                      ))}
                    </div>
                  )}

                  {tableTab === "PROVENANCE" && (
                    <table className="wb-grid">
                      <thead>
                        <tr><th style={{ width: 140 }}>Database</th><th>Executed query</th><th style={{ width: 80 }}>Records</th><th style={{ width: 90 }}>Status</th></tr>
                      </thead>
                      <tbody>
                        {(review.objects.searches || []).map((s, i) => (
                          <tr key={i}>
                            <td>{s.name || s.db}</td>
                            <td style={{ color: "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }} title={s.query}>{s.query}</td>
                            <td className="wb-num">{s.count ?? 0}</td>
                            <td style={{ color: s.status === "error" ? "var(--err)" : "var(--fg-dim)" }}>{s.status || "ok"}</td>
                          </tr>
                        ))}
                        {(review.objects.searches || []).length === 0 && (
                          <tr><td colSpan={4} style={{ color: "var(--fg-faint)" }}>No search has been executed. Mode: {review.searchSummary?.mode || "not run"}</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {rightDock.open && (
          <div
            className="wb-gutter"
            onMouseDown={() => { dragging.current = "right"; document.body.style.cursor = "col-resize"; }}
            onDoubleClick={() => setRightDock((d) => ({ ...d, open: false }))}
            title="Drag to resize, double-click to collapse (Cmd-2)"
          />
        )}

        {rightDock.open && (
          <div className="wb-panel" style={{ width: rightDock.width, flexShrink: 0 }}>
            <div className="wb-panel-head">
              <span className="title">Inspector</span>
              {selectedRow && <span className="wb-count">{selectedRow.source}</span>}
            </div>

            {!selectedRow ? (
              <div className="wb-panel-body" style={{ padding: "6px 8px", color: "var(--fg-faint)", fontSize: 11 }}>
                No element selected. J / K move the selection.
              </div>
            ) : (
              <div className="wb-panel-body">
                <div className="wb-insp-title">Identity</div>
                <div className="wb-prop">
                  <span className="k">Label</span>
                  <input className="wb-input" value={selectedRow.label} onChange={(e) => patchRow(selectedRow.studyId, { label: e.target.value })} />
                </div>
                <div className="wb-prop"><span className="k">Study id</span><span className="v mono">{selectedRow.studyId}</span></div>
                <div className="wb-prop"><span className="k">PMID</span><span className="v mono">{selectedRow.pmid || "—"}</span></div>
                <div className="wb-prop"><span className="k">DOI</span><span className="v mono">{selectedRow.doi || "—"}</span></div>
                <div className="wb-prop"><span className="k">Year</span><span className="v mono">{selectedRow.year || "—"}</span></div>

                <div className="wb-insp-title">2x2 contingency</div>
                {[["eventsT", "Events (T)"], ["totalT", "Total (T)"], ["eventsC", "Events (C)"], ["totalC", "Total (C)"]].map(([field, label]) => (
                  <div className="wb-prop" key={field}>
                    <span className="k">{label}</span>
                    <input
                      className="wb-input" type="number" value={selectedRow[field] ?? ""} placeholder="—"
                      onChange={(e) => patchRow(selectedRow.studyId, { [field]: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </div>
                ))}

                <div className="wb-insp-title">Derived</div>
                {selectedCalc ? (
                  <>
                    <div className="wb-prop"><span className="k">{outcome.measure}</span><span className="v mono">{selectedCalc.effect}</span></div>
                    <div className="wb-prop"><span className="k">95% CI</span><span className="v mono">{selectedCalc.lower} – {selectedCalc.upper}</span></div>
                    <div className="wb-prop"><span className="k">Weight</span><span className="v mono">{selectedCalc.weight}%</span></div>
                  </>
                ) : (
                  <div className="wb-prop"><span className="k">Status</span><span className="v" style={{ color: "var(--warn)" }}>{computed.excluded.find((e) => e.label === selectedRow.label)?.reason || "not pooled"}</span></div>
                )}

                <div className="wb-insp-title">Risk of bias</div>
                <div className="wb-prop">
                  <span className="k">Judgement</span>
                  <select className="wb-select" value={selectedRow.rob} onChange={(e) => patchRow(selectedRow.studyId, { rob: e.target.value, robOverride: true })}>
                    {ROB_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="wb-prop">
                  <span className="k">Source</span>
                  <span className="v" style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
                    {selectedRow.robOverride ? "operator override, the RoB stage will not overwrite" : "derived from the risk-of-bias stage"}
                  </span>
                </div>

                {selectedRow.detached && (
                  <div className="wb-prop"><span className="k">Warning</span><span className="v" style={{ color: "var(--warn)" }}>study no longer included by the pipeline</span></div>
                )}

                <div className="wb-decide">
                  <div className="db inc" onClick={() => patchRow(selectedRow.studyId, { include: true })}>Include<kbd>I</kbd></div>
                  <div className="db exc" onClick={() => patchRow(selectedRow.studyId, { include: false })}>Exclude<kbd>E</kbd></div>
                  <div className="db maybe" onClick={() => patchRow(selectedRow.studyId, { rob: "Some", robOverride: true })}>Maybe<kbd>M</kbd></div>
                </div>
                <div style={{ padding: "6px 8px" }}>
                  <button className="wb-btn danger" onClick={() => removeRow(selectedRow.studyId)}>
                    {selectedRow.source === "runtime" ? "Exclude row from analysis" : "Delete manual row"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* COMMAND DOCK: the question and the conversation, always in the same place */}
      {bottomDock.open && (
        <>
          <div
            className="wb-dock-gutter"
            onMouseDown={() => { dragging.current = "bottom"; document.body.style.cursor = "row-resize"; }}
            onDoubleClick={() => setBottomDock((d) => ({ ...d, open: false }))}
            title="Drag to resize, double-click to collapse (Cmd-3)"
          />
          <CommandDock
            projectId={pid}
            review={review}
            onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
            onNote={note}
            onOpenQuestion={() => { setActiveView("Question"); setActiveTab("QUESTION"); }}
            height={bottomDock.height}
          />
        </>
      )}

      {/* STATUS BAR */}
      <div className="wb-statusbar">
        {running ? (
          <span className="sb warn">{running.stage}: {running.msg} · {elapsed}s</span>
        ) : (
          <span className={`sb ${overall.pct === 100 ? "ok" : ""}`}>
            <span className="wb-meter"><i style={{ width: `${overall.pct}%` }} /></span>
            <b>{overall.done}</b>/{overall.total} stages
          </span>
        )}
        <span className="sb">project <b>{project?.name || "none"}</b></span>
        <span className="sb">records <b>{summary?.records ?? 0}</b></span>
        <span className="sb">screened in <b>{summary?.included ?? 0}</b></span>
        <span className="sb">extracted <b>{summary?.extracted ?? 0}</b></span>
        <span className="wb-spacer" />
        {computed.ok ? (
          <span className="sb ok">
            pooled {outcome.measure} <b>{computed.pooled.effect}</b> ({computed.pooled.ci[0]}–{computed.pooled.ci[1]}) · I2 <b>{het.I2}%</b> · k=<b>{computed.k}</b>
          </span>
        ) : (
          <span className="sb warn">no pooled estimate</span>
        )}
        <span className="sb">{llmRoute} route</span>
        <span className="sb" onClick={() => setBottomDock((d) => ({ ...d, open: !d.open }))}>dock</span>
        <span className="sb" onClick={() => setShowKeys((v) => !v)}>? keys</span>
      </div>

      {showKeys && (
        <div className="wb-kbd-hint" onClick={() => setShowKeys(false)}>
          <b>J</b> / <b>K</b> move selection &nbsp; <b>I</b> include &nbsp; <b>E</b> exclude &nbsp; <b>M</b> maybe (all auto-advance)<br />
          <b>Cmd-1</b> left dock &nbsp; <b>Cmd-2</b> right dock &nbsp; <b>Cmd-3</b> command dock &nbsp; <b>/</b> composer<br />
          <b>?</b> this map &nbsp; <b>Esc</b> close
        </div>
      )}
    </div>
  );
}
