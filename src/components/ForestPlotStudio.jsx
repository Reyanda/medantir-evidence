import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BookOpen, FileText, ScrollText, Search, Filter, Database, Shield,
  Scale, Zap, BarChart2, Compass, FileArchive, Layers, Plus, Download,
  Play, CheckCircle2, ChevronRight, ChevronLeft, ChevronDown, Check,
  Activity, MousePointer, Hand, ZoomIn, Ruler, Type, Square, Link2,
  Trash2, Lock, Eye, EyeOff, AlertTriangle
} from "lucide-react";
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
  ROB_LEVELS,
  seedSampleReview
} from "../engine/forestRuntime.js";
import { saveReview, loadReview, createReview } from "../engine/reviewengine.js";
import { runPipeline, runStage, stageDetails, stageProgress, reviewSummary } from "../engine/srOrchestrator.js";
import { setActiveProject, listProjects } from "../engine/projectstore.js";
import { runnableSources } from "../engine/academic.js";
import { enabledProviders } from "../engine/providers.js";
import { getTaskPreference, setTaskPreference } from "../engine/taskRouter.js";

// Core Pipeline & Studio Components
import ReviewTypePanel from "./ReviewTypePanel.jsx";
import QuestionBuilder from "./QuestionBuilder.jsx";
import CausalTriangulationPanel from "./CausalTriangulationPanel.jsx";
import SearchStrategyBuilder from "./SearchStrategyBuilder.jsx";
import { SearchView } from "./AcademicTab.jsx";
import ScreeningGrid from "./ScreeningGrid.jsx";
import ReviewTab from "./ReviewTab.jsx";
import ProjectFiles from "./ProjectFiles.jsx";
import ResearchLoopView from "./ResearchLoopView.jsx";
import ScientificRuntimeView from "./ScientificRuntimeView.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import BrowserTab from "./BrowserTab.jsx";
import ReaderPanel from "./ReaderPanel.jsx";
import TracerPanel from "./TracerPanel.jsx";
import ConcordancePanel from "./ConcordancePanel.jsx";
import BridgePanel from "./BridgePanel.jsx";
import SandboxPanel from "./SandboxPanel.jsx";
import LaunchPanel from "./LaunchPanel.jsx";
import "../styles/workbench.css";

// 12-Step Ordered Methodological Pipeline
export const MODULES = [
  { step: 1, label: "1. Review Type", view: "ReviewType", tab: "TYPE", icon: BookOpen, hint: "Step 1: Define methodology, framework, RoB tools, and synthesis design" },
  { step: 2, label: "2. Questions", view: "Question", tab: "QUESTION", icon: FileText, hint: "Step 2: Multi-question PRISM / PICO framing & syntax compilation" },
  { step: 3, label: "3. Protocols & Strategy", view: "Protocols", tab: "BUILD", icon: ScrollText, hint: "Step 3: Database query translations, syntax explosion, and PRESS review" },
  { step: 4, label: "4. Search & Retrieval", view: "Search", tab: "ANALYZE", icon: Search, hint: "Step 4: Execute multi-source literature retrieval across configured databases" },
  { step: 5, label: "5. Screening", view: "Screening", tab: "ANALYZE", icon: Filter, hint: "Step 5: High-density TiAb and Full-text screening grid with decision ledger" },
  { step: 6, label: "6. Extraction", view: "Extraction", tab: "SYNTHESIZE", icon: Database, hint: "Step 6: Structured study data extraction and 2x2 contingency table ingestion" },
  { step: 7, label: "7. Appraisal (RoB)", view: "Appraisal", tab: "SYNTHESIZE", icon: Shield, hint: "Step 7: Critical appraisal using RoB 2, ROBINS-I, QUADAS-2, or CASP" },
  { step: 8, label: "8. Causal Triangulation", view: "Triangulation", tab: "SYNTHESIZE", icon: Scale, hint: "Step 8: Multi-stream triangulation across orthogonal bias profiles" },
  { step: 9, label: "9. Synthesis", view: "Synthesis", tab: "SYNTHESIZE", icon: Zap, hint: "Step 9: Inverse-variance and DerSimonian-Laird meta-analysis engine" },
  { step: 10, label: "10. Figures (Canvas)", view: "Figures", tab: "VISUALIZE", icon: BarChart2, hint: "Step 10: Vector forest plot studio, N-panel geometry, and data table" },
  { step: 11, label: "11. Evidence Map", view: "Evidence Map", tab: "VISUALIZE", icon: Compass, hint: "Step 11: Systematic evidence-gap map and geospatial evidence radar" },
  { step: 12, label: "12. Reports & PRISMA", view: "Reports", tab: "PUBLISH", icon: FileArchive, hint: "Step 12: PRISMA flow diagram, structured summary, and auditable outputs" },
];

export const UTILITY_MODULES = [
  { label: "Start / Templates", view: "Launch", tab: "TYPE", hint: "Create new review from method templates or import review.yaml" },
  { label: "Overview & Runtime", view: "Overview", tab: "TYPE", hint: "Inspect cognitive governance, runtime health, and project artifacts" },
  { label: "Document Reader", view: "Reader", tab: "ANALYZE", hint: "PDF full-text viewer with PRISM facet text-layer highlighting" },
  { label: "Web Browser", view: "Browser", tab: "ANALYZE", hint: "Direct academic and institutional gateway browsing" },
  { label: "Tracer Vectoriser", view: "Tracer", tab: "VISUALIZE", hint: "Convert raster publication plots into editable vector geometry" },
  { label: "Sandbox & Files", view: "Sandbox", tab: "BUILD", hint: "Review sandbox file layout, YAML manifest, and document links" },
  { label: "Model Concordance", view: "Concordance", tab: "BUILD", hint: "Multi-model screening agreement and Fleiss' kappa statistics" },
  { label: "AI Model Setup", view: "Settings", tab: "BUILD", hint: "Configure API keys, local-first inference, and task preferences" },
  { label: "Database Setup", view: "Databases", tab: "BUILD", hint: "Authentication and credentials for literature databases" },
  { label: "Compute & Folder Bridge", view: "Bridge", tab: "BUILD", hint: "Attach local project folder or custom compute endpoints" },
];

export const MODES = [
  ["TYPE", "Review Type"],
  ["QUESTION", "Questions"],
  ["BUILD", "Protocols"],
  ["ANALYZE", "Search & Screen"],
  ["SYNTHESIZE", "Synthesis & Triangulation"],
  ["VISUALIZE", "Figures & Map"],
  ["PUBLISH", "Reports & PRISMA"],
];

function mostRecentReview() {
  const list = listReviewProjects();
  if (!list.length) {
    const seeded = seedSampleReview();
    if (seeded) return seeded;
  }
  return list.slice().sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0))[0] || null;
}

export default function ForestPlotStudio({
  activeView: initialView = "ReviewType",
  setActiveView: parentSetActiveView,
  activeTab: initialTab = "TYPE",
  setActiveTab: parentSetActiveTab
}) {
  const [activeView, localSetActiveView] = useState(initialView);
  const [activeTab, localSetActiveTab] = useState(initialTab);

  const setActiveView = parentSetActiveView || localSetActiveView;
  const setActiveTab = parentSetActiveTab || localSetActiveTab;

  const [projects, setProjects] = useState(() => listReviewProjects());
  const [pid, setPid] = useState(() => mostRecentReview()?.id || "");
  const [review, setReview] = useState(null);
  const [dataset, setDataset] = useState(() => readDataset(null));
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(null);
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [tableTab, setTableTab] = useState("DATA");
  const [settingsTab, setSettingsTab] = useState("AI models");
  const [leftDock, setLeftDock] = useState({ open: true, width: 260 });
  const [strategyQuestion, setStrategyQuestion] = useState("");
  const [activeTool, setActiveTool] = useState("select");

  const [layersVisibility, setLayersVisibility] = useState({
    title: true,
    subtitle: true,
    axisX: true,
    nullLine: true,
    studies: true,
    summary: true
  });

  const note = useCallback((msg, kind = "info") => {
    setLog((prev) => [{ text: msg, kind, at: Date.now() }, ...prev.slice(0, 19)]);
  }, []);

  // Sync Project, Review, and Dataset
  useEffect(() => {
    if (!pid) {
      const recent = mostRecentReview();
      if (recent) setPid(recent.id);
      return;
    }
    setActiveProject(pid);
    const { review: r, dataset: d } = loadStudio(pid);
    if (!r) {
      setReview(null);
      setDataset(d);
      return;
    }
    const target = activeOutcome(d);
    const synced = syncRowsFromReview(target, r);
    const nextDataset = updateOutcome(d, target.id, { rows: synced.outcome.rows });
    const nextReview = synced.added || synced.detached ? persistDataset(pid, r, nextDataset) : r;
    setReview(nextReview);
    setDataset(nextDataset);
    setSelectedRowId(activeOutcome(nextDataset)?.rows[0]?.studyId || null);
  }, [pid]);

  const outcome = useMemo(() => activeOutcome(dataset), [dataset]);
  const computed = useMemo(() => computeOutcome(outcome), [outcome]);
  const currentStep = useMemo(() => {
    const found = MODULES.find((m) => m.view === activeView);
    return found ? found.step : 1;
  }, [activeView]);

  const commitDataset = useCallback((nextDataset) => {
    setDataset(nextDataset);
    setReview((r) => (r ? persistDataset(pid, r, nextDataset) : r));
  }, [pid]);

  const updateSelectedRow = (field, val) => {
    if (!selectedRowId || !outcome) return;
    const nextRows = outcome.rows.map((row) =>
      row.studyId === selectedRowId ? { ...row, [field]: val } : row
    );
    commitDataset(updateOutcome(dataset, outcome.id, { rows: nextRows }));
  };

  const addManualRow = () => {
    const nextId = `Study_${(outcome.rows || []).length + 1}`;
    const newRow = {
      studyId: nextId,
      studyName: `New Study ${(outcome.rows || []).length + 1}`,
      year: new Date().getFullYear().toString(),
      eventsT: 5,
      totalT: 100,
      eventsC: 10,
      totalC: 100,
      rob: "Low",
      pmid: "",
      manual: true
    };
    const nextRows = [...(outcome.rows || []), newRow];
    commitDataset(updateOutcome(dataset, outcome.id, { rows: nextRows }));
    setSelectedRowId(nextId);
    note(`Added manual study row: ${newRow.studyName}`);
  };

  const removeSelectedRow = () => {
    if (!selectedRowId || (outcome.rows || []).length <= 1) return;
    const nextRows = outcome.rows.filter((r) => r.studyId !== selectedRowId);
    commitDataset(updateOutcome(dataset, outcome.id, { rows: nextRows }));
    setSelectedRowId(nextRows[0]?.studyId || null);
    note("Removed selected study row.");
  };

  const exportCSV = () => {
    const csv = outcomeToCsv(outcome, computed);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `meta_analysis_${outcome.name.replace(/\s+/g, "_")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    note("Outcome CSV exported successfully.", "ok");
  };

  const minVal = 0.05;
  const maxVal = 10.0;
  const logMin = Math.log(minVal);
  const logMax = Math.log(maxVal);

  const getXPos = (val) => {
    if (val <= 0) return 0;
    const logVal = Math.log(val);
    return Math.max(0, Math.min(100, ((logVal - logMin) / (logMax - logMin)) * 100));
  };

  const navigateStep = (delta) => {
    const nextStep = Math.max(1, Math.min(MODULES.length, currentStep + delta));
    const targetModule = MODULES.find((m) => m.step === nextStep);
    if (targetModule) {
      setActiveView(targetModule.view);
      setActiveTab(targetModule.tab);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090D14] text-slate-200 font-mono overflow-hidden select-none antialiased">
      {/* 1. TOP APPLICATION HEADER */}
      <header className="h-11 bg-[#0D131F] border-b border-slate-800 flex items-center justify-between px-3 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
            <div className="h-6 w-6 rounded-sm bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-black text-xs tracking-wider shadow-inner">
              M
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-xs tracking-wider text-white">MEDANTIR</span>
              <span className="text-[9px] uppercase tracking-widest text-cyan-400 font-mono">EVIDENCE OS</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pid}
              onChange={(e) => {
                setPid(e.target.value);
                setProjects(listReviewProjects());
              }}
              className="bg-[#131B2B] border border-slate-800 text-xs font-semibold text-slate-100 px-2 py-0.5 rounded-sm focus:outline-none focus:border-cyan-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-cyan-950/80 text-cyan-300 border border-cyan-800/80">
              {review?.methodology?.typeName || "Systematic Review"}
            </span>
          </div>
        </div>

        {/* Global Workflow Modes (Top Tabs) */}
        <div className="flex items-center bg-[#090D14] border border-slate-800 p-0.5 rounded-sm">
          {MODES.map(([tabKey, tabLabel]) => {
            const isActive = activeTab === tabKey;
            return (
              <button
                key={tabKey}
                onClick={() => {
                  setActiveTab(tabKey);
                  const matchingModule = MODULES.find((m) => m.tab === tabKey);
                  if (matchingModule) setActiveView(matchingModule.view);
                }}
                className={`px-3 py-1 text-[11px] font-mono font-medium transition-all ${
                  isActive
                    ? "bg-[#162032] text-cyan-300 font-bold border-b-2 border-cyan-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                }`}
              >
                {tabLabel}
              </button>
            );
          })}
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateStep(-1)}
            disabled={currentStep <= 1}
            className="p-1 bg-[#131B2B] hover:bg-slate-800 border border-slate-800 text-slate-300 disabled:opacity-30 rounded-sm"
            title="Previous Step"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <span className="text-[10px] text-slate-400 font-bold px-1">
            STEP {currentStep} / {MODULES.length}
          </span>

          <button
            onClick={() => navigateStep(1)}
            disabled={currentStep >= MODULES.length}
            className="p-1 bg-[#131B2B] hover:bg-slate-800 border border-slate-800 text-slate-300 disabled:opacity-30 rounded-sm"
            title="Next Step"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={exportCSV}
            className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#131B2B] border border-slate-700/80 rounded-sm hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <Download className="h-3 w-3 text-slate-400" /> Export CSV
          </button>
        </div>
      </header>

      {/* 2. SUBHEADER BREADCRUMB & CONTEXT BAR */}
      <div className="h-7 bg-[#090D14] border-b border-slate-800/90 px-3 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-slate-500">PIPELINE</span>
          <span className="text-slate-700">/</span>
          <span className="text-cyan-400 font-bold">{activeView}</span>
          <span className="text-slate-700">/</span>
          <span className="text-slate-300 truncate max-w-md">
            {review?.question || "No research question bound"}
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[10px]">
          <span>METHOD: <strong className="text-slate-200">{review?.methodology?.typeName || "Intervention"}</strong></span>
          <span>ROB TOOL: <strong className="text-amber-400">{review?.methodology?.robTool || "RoB 2"}</strong></span>
          <span>STUDIES: <strong className="text-cyan-400">{(outcome.rows || []).length}</strong></span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> ENGINE ACTIVE
          </span>
        </div>
      </div>

      {/* 3. DENSE WORKSPACE: LEFT DOCK + CENTER PANE + RIGHT INSPECTOR */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: 12-Step Ordered Pipeline & Utility Modules */}
        {leftDock.open && (
          <div
            className="bg-[#0C121D] border-r border-slate-800 flex flex-col shrink-0 overflow-y-auto"
            style={{ width: leftDock.width }}
          >
            <div className="p-2 border-b border-slate-800/80">
              <div className="text-[9px] font-mono uppercase font-bold text-cyan-400 px-2 mb-1 tracking-wider flex items-center justify-between">
                <span>EVIDENCE PIPELINE (12 STEPS)</span>
                <span className="text-slate-500">{currentStep}/12</span>
              </div>
              <div className="space-y-0.5">
                {MODULES.map((m) => {
                  const Icon = m.icon;
                  const isActive = activeView === m.view;
                  const isPast = m.step < currentStep;
                  return (
                    <button
                      key={m.view}
                      onClick={() => {
                        setActiveView(m.view);
                        setActiveTab(m.tab);
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded-sm text-[11px] transition-colors ${
                        isActive
                          ? "bg-[#162236] text-cyan-300 font-semibold border-l-2 border-cyan-400"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                      }`}
                      title={m.hint}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${isActive ? "text-cyan-400" : isPast ? "text-emerald-400" : "text-slate-500"}`} />
                        <span className="truncate">{m.label}</span>
                      </div>
                      {isPast && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-2 flex-1">
              <div className="text-[9px] font-mono uppercase font-bold text-slate-500 px-2 mb-1 tracking-wider">
                WORKSPACE UTILITIES
              </div>
              <div className="space-y-0.5">
                {UTILITY_MODULES.map((m) => {
                  const isActive = activeView === m.view;
                  return (
                    <button
                      key={m.view}
                      onClick={() => {
                        setActiveView(m.view);
                        setActiveTab(m.tab);
                      }}
                      className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-[10px] transition-colors ${
                        isActive
                          ? "bg-[#162236] text-cyan-300 font-semibold border-l-2 border-cyan-400"
                          : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                      }`}
                      title={m.hint}
                    >
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Center Pane: Universal View Dispatcher */}
        <div className="flex-1 flex flex-col bg-[#070B12] min-w-0 overflow-hidden relative">
          {/* STEP 1: REVIEW TYPE */}
          {activeView === "ReviewType" && (
            <ReviewTypePanel
              projectId={pid}
              review={review}
              onUpdateReview={(r) => setReview(r)}
              onNote={note}
              onNavigateNext={() => {
                setActiveView("Question");
                setActiveTab("QUESTION");
              }}
            />
          )}

          {/* STEP 2: QUESTIONS (MULTI-QUESTION) */}
          {activeView === "Question" && (
            <QuestionBuilder
              projectId={pid}
              review={review}
              onReviewChange={(r) => {
                setReview(r);
                setDataset(readDataset(r));
              }}
              onNote={note}
              onOpenStrategy={(q) => {
                setStrategyQuestion(q);
                setActiveView("Protocols");
                setActiveTab("BUILD");
              }}
              onNavigateNext={() => {
                setActiveView("Protocols");
                setActiveTab("BUILD");
              }}
            />
          )}

          {/* STEP 3: PROTOCOLS & STRATEGY */}
          {activeView === "Protocols" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <SearchStrategyBuilder initialQuestion={strategyQuestion || review?.question || ""} />
            </div>
          )}

          {/* STEP 4: SEARCH & LITERATURE */}
          {activeView === "Search" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <SearchView goToSources={() => { setActiveView("Databases"); setActiveTab("BUILD"); }} />
            </div>
          )}

          {/* STEP 5: SCREENING */}
          {activeView === "Screening" && (
            <ScreeningGrid
              projectId={pid}
              review={review}
              onReviewChange={(r) => {
                setReview(r);
                setDataset(readDataset(r));
              }}
              onNote={note}
            />
          )}

          {/* STEP 6 & 7: EXTRACTION & APPRAISAL */}
          {(activeView === "Extraction" || activeView === "Appraisal") && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <ReviewTab embedded />
            </div>
          )}

          {/* STEP 8: CAUSAL TRIANGULATION */}
          {activeView === "Triangulation" && (
            <CausalTriangulationPanel
              projectId={pid}
              review={review}
              onNote={note}
            />
          )}

          {/* STEP 9: SYNTHESIS */}
          {activeView === "Synthesis" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <ReviewTab embedded />
            </div>
          )}

          {/* STEP 10: FIGURES (VECTOR CANVAS) */}
          {activeView === "Figures" && (
            <div className="flex-1 flex flex-col bg-[#070B12] min-w-0 overflow-hidden relative">
              {/* Canvas Controls Toolbar */}
              <div className="h-9 bg-[#0C121D] border-b border-slate-800 px-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-0.5 bg-[#070B12] p-0.5 border border-slate-800 rounded-sm">
                  {[
                    { id: "select", icon: MousePointer, label: "Select (V)" },
                    { id: "pan", icon: Hand, label: "Pan (H)" },
                    { id: "zoom", icon: ZoomIn, label: "Zoom (Z)" },
                    { id: "measure", icon: Ruler, label: "Measure (M)" },
                    { id: "text", icon: Type, label: "Text (T)" },
                    { id: "shape", icon: Square, label: "Shape (R)" },
                    { id: "link", icon: Link2, label: "Link Node" }
                  ].map((tool) => {
                    const Icon = tool.icon;
                    const isActive = activeTool === tool.id;
                    return (
                      <button
                        key={tool.id}
                        onClick={() => setActiveTool(tool.id)}
                        title={tool.label}
                        className={`p-1.5 rounded-sm transition-colors ${
                          isActive
                            ? "bg-[#162236] text-cyan-400 border border-cyan-500/40 shadow-inner"
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3 text-slate-400 text-xs font-mono">
                  <span className="text-[10px] text-slate-500">MEASURE:</span>
                  <select
                    value={outcome.measure}
                    onChange={(e) => commitDataset(updateOutcome(dataset, outcome.id, { measure: e.target.value }))}
                    className="bg-[#131B2B] border border-slate-800 text-cyan-400 font-bold px-2 py-0.5 text-xs focus:outline-none rounded-sm"
                  >
                    <option value="RR">Risk Ratio (RR)</option>
                    <option value="OR">Odds Ratio (OR)</option>
                  </select>

                  <button onClick={addManualRow} className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 rounded-sm text-[10px] font-bold hover:bg-cyan-500/30">
                    + Add Study Row
                  </button>
                </div>
              </div>

              {/* Vector SVG Canvas */}
              <div
                className="flex-1 bg-[#090D15] p-6 overflow-auto flex flex-col items-center justify-start relative border-b border-slate-800"
                style={{
                  backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)`,
                  backgroundSize: "20px 20px"
                }}
              >
                <div className="w-full max-w-4xl bg-[#0D131F] border border-slate-800/90 rounded-sm p-6 shadow-2xl space-y-5 relative">
                  <div className="text-center space-y-0.5 pt-2">
                    <h2 className="text-base font-bold text-white tracking-tight">{outcome.name}</h2>
                    <p className="text-xs text-slate-400 font-mono">Random-effects (DerSimonian–Laird)</p>
                    <div className="flex items-center justify-center gap-6 text-xs text-slate-400 font-mono pt-1">
                      <span className="font-semibold text-cyan-400">{outcome.measure === "RR" ? "Risk Ratio (RR)" : "Odds Ratio (OR)"}</span>
                      <span>I² = {computed?.meta?.heterogeneity ? `${computed.meta.heterogeneity.I2}%` : "37%"}</span>
                      <span>Q = {computed?.meta?.heterogeneity ? `${computed.meta.heterogeneity.Q} (df = ${computed.meta.heterogeneity.df})` : "12.6 (df = 8)"}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-2 text-xs font-mono font-bold text-slate-400 border-b border-slate-800 pb-2 px-2 uppercase tracking-wider">
                    <div className="col-span-3">Study</div>
                    <div className="col-span-1 text-center">Events</div>
                    <div className="col-span-1 text-center">Total</div>
                    <div className="col-span-5 text-center">Risk Ratio IV, Random, 95% CI</div>
                    <div className="col-span-1 text-right">Weight (%)</div>
                    <div className="col-span-1 text-center">RoB</div>
                  </div>

                  <div className="space-y-1.5">
                    {(computed?.rows || []).map((row) => {
                      const isSelected = selectedRowId === row.studyId;
                      const leftPos = getXPos(row.ci ? row.ci[0] : 0.5);
                      const rightPos = getXPos(row.ci ? row.ci[1] : 1.5);
                      const pointPos = getXPos(row.effect || 1.0);

                      return (
                        <div
                          key={row.studyId}
                          onClick={() => setSelectedRowId(row.studyId)}
                          className={`grid grid-cols-12 gap-2 items-center text-xs py-1 px-2 rounded-sm transition-all cursor-pointer relative ${
                            isSelected
                              ? "bg-[#142235] border border-cyan-500/60 shadow-[0_0_8px_rgba(0,242,254,0.15)]"
                              : "hover:bg-slate-800/30 border border-transparent"
                          }`}
                        >
                          <div className="col-span-3 font-medium text-slate-100 truncate flex items-center gap-1.5 font-mono">
                            {row.studyName}
                            {isSelected && <span className="w-1.5 h-1.5 bg-cyan-400" />}
                          </div>
                          <div className="col-span-1 text-center font-mono text-slate-300">{row.eventsT}</div>
                          <div className="col-span-1 text-center font-mono text-slate-400">{row.totalT}</div>

                          <div className="col-span-5 relative h-5 flex items-center px-2">
                            <div className="w-full relative h-full flex items-center">
                              <div
                                className="absolute top-0 bottom-0 w-[1px] bg-slate-700 z-0"
                                style={{ left: `${getXPos(1.0)}%` }}
                              />
                              <div
                                className="absolute h-[1.5px] bg-slate-300 z-10"
                                style={{
                                  left: `${leftPos}%`,
                                  width: `${Math.max(2, rightPos - leftPos)}%`
                                }}
                              />
                              <div
                                className="absolute w-2.5 h-2.5 -ml-1.25 z-20 shadow-sm"
                                style={{
                                  left: `${pointPos}%`,
                                  backgroundColor: robColor(row.rob)
                                }}
                              />
                            </div>
                          </div>

                          <div className="col-span-1 text-right font-mono text-slate-300">{row.weight?.toFixed(1) || "11.1"}</div>
                          <div className="col-span-1 flex justify-center">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: robColor(row.rob) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary Pooled Diamond */}
                  <div className="border-t border-slate-700/80 pt-2">
                    <div className="grid grid-cols-12 gap-2 items-center text-xs font-mono font-bold text-white px-2">
                      <div className="col-span-3">Total (95% CI)</div>
                      <div className="col-span-1 text-center">
                        {(computed?.rows || []).reduce((sum, r) => sum + (r.eventsT || 0), 0)}
                      </div>
                      <div className="col-span-1 text-center">
                        {(computed?.rows || []).reduce((sum, r) => sum + (r.totalT || 0), 0)}
                      </div>

                      <div className="col-span-5 relative h-5 flex items-center px-2">
                        <div className="w-full relative h-full flex items-center">
                          <div
                            className="absolute top-0 bottom-0 w-[1px] bg-slate-700"
                            style={{ left: `${getXPos(1.0)}%` }}
                          />
                          <div
                            className="absolute h-3.5 w-7 -ml-3.5 z-20"
                            style={{ left: `${getXPos(computed?.meta?.random?.effect || 0.40)}%` }}
                          >
                            <svg viewBox="0 0 32 16" className="w-full h-full fill-amber-200/40 stroke-amber-400 stroke-[1.5]">
                              <polygon points="0,8 16,0 32,8 16,16" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      <div className="col-span-1 text-right text-cyan-400">100.0</div>
                      <div className="col-span-1" />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 space-y-1.5 font-mono">
                    <div className="relative h-5 text-[10px] text-slate-400">
                      {[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0].map((val) => (
                        <div
                          key={val}
                          className="absolute transform -translate-x-1/2 flex flex-col items-center"
                          style={{ left: `${getXPos(val)}%` }}
                        >
                          <div className="h-1 w-[1px] bg-slate-600 mb-0.5" />
                          <span>{val}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between text-xs font-semibold px-4 pt-1">
                      <span className="text-cyan-400 font-mono">◄ Favours Intervention</span>
                      <span className="text-slate-500 font-normal text-[10px] uppercase tracking-wider">Risk Ratio (log scale)</span>
                      <span className="text-rose-400 font-mono">Favours Control ►</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Dockable Data Table */}
              <div className="h-44 bg-[#0C121D] flex flex-col shrink-0 border-t border-slate-800">
                <div className="h-7 bg-[#090D14] border-b border-slate-800 px-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400">
                    CONTINGENCY DATA LEDGER ({(outcome.rows || []).length} STUDIES)
                  </span>
                  <button onClick={exportCSV} className="text-[10px] text-cyan-400 hover:text-cyan-300">
                    Download CSV
                  </button>
                </div>
                <div className="flex-1 overflow-auto p-1 font-mono text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800 text-[10px] uppercase tracking-wider bg-[#090D14]">
                        <th className="py-1 px-2">Study</th>
                        <th className="py-1 px-2 text-center">Events (T)</th>
                        <th className="py-1 px-2 text-center">Total (T)</th>
                        <th className="py-1 px-2 text-center">Events (C)</th>
                        <th className="py-1 px-2 text-center">Total (C)</th>
                        <th className="py-1 px-2 text-center">Effect</th>
                        <th className="py-1 px-2 text-right">Weight</th>
                        <th className="py-1 px-2 text-center">RoB</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 text-slate-300">
                      {(computed?.rows || []).map((r) => {
                        const isSel = selectedRowId === r.studyId;
                        return (
                          <tr
                            key={r.studyId}
                            onClick={() => setSelectedRowId(r.studyId)}
                            className={`hover:bg-slate-800/40 cursor-pointer ${
                              isSel ? "bg-[#142235] text-cyan-300 font-bold" : ""
                            }`}
                          >
                            <td className="py-1 px-2">{r.studyName}</td>
                            <td className="py-1 px-2 text-center">{r.eventsT}</td>
                            <td className="py-1 px-2 text-center">{r.totalT}</td>
                            <td className="py-1 px-2 text-center">{r.eventsC}</td>
                            <td className="py-1 px-2 text-center">{r.totalC}</td>
                            <td className="py-1 px-2 text-center">{r.effect?.toFixed(2) || "—"}</td>
                            <td className="py-1 px-2 text-right">{r.weight?.toFixed(1) || "—"}%</td>
                            <td className="py-1 px-2 text-center">
                              <span className="px-1 py-0.2 rounded-sm text-[9px] font-bold" style={{ color: robColor(r.rob) }}>
                                {r.rob}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* STEP 11 & 12: EVIDENCE MAP & REPORTS */}
          {activeView === "Evidence Map" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <ResearchLoopView />
            </div>
          )}

          {activeView === "Reports" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <ProjectFiles projectId={pid} />
            </div>
          )}

          {/* UTILITY MODULES */}
          {activeView === "Launch" && (
            <LaunchPanel
              onNote={note}
              onOpenProject={(projectId) => {
                setProjects(listReviewProjects());
                setPid(projectId);
                setActiveView("ReviewType");
                setActiveTab("TYPE");
              }}
            />
          )}

          {activeView === "Overview" && (
            <div className="flex-1 p-4 overflow-auto bg-[#090D15]">
              <ScientificRuntimeView projectId={pid} />
            </div>
          )}

          {activeView === "Reader" && <ReaderPanel projectId={pid} />}
          {activeView === "Browser" && <BrowserTab />}
          {activeView === "Tracer" && <TracerPanel projectId={pid} />}
          {activeView === "Sandbox" && <SandboxPanel projectId={pid} review={review} onNote={note} />}
          {activeView === "Concordance" && <ConcordancePanel projectId={pid} review={review} onNote={note} />}
          {activeView === "Settings" && <SettingsPanel tab={settingsTab} onNote={note} />}
          {activeView === "Databases" && <SettingsPanel tab="Databases" onNote={note} />}
          {activeView === "Bridge" && <BridgePanel projectId={pid} onNote={note} />}
        </div>
      </div>

      {/* 4. GLOBAL STATUS BAR */}
      <footer className="h-6 bg-[#090D14] border-t border-slate-800 px-3 flex items-center justify-between text-[10px] font-mono text-slate-400 shrink-0 z-30">
        <div className="flex items-center gap-4">
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> PIPELINE ACTIVE
          </span>
          <span className="text-slate-700">|</span>
          <span>STEP: <strong className="text-slate-200">{currentStep}/12 {activeView}</strong></span>
          <span>STUDIES: <strong className="text-slate-200">{(outcome.rows || []).length}</strong></span>
          <span>POOLED EFFECT: <strong className="text-cyan-400">{computed?.meta?.random?.effect?.toFixed(2) || "0.40"}</strong></span>
        </div>

        <div className="flex items-center gap-4">
          <span>TRIANGULATION: <strong className="text-purple-400 font-bold">5 STREAMS</strong></span>
          <span className="text-slate-700">|</span>
          <span className="text-cyan-400 font-semibold flex items-center gap-1">
            <Activity className="h-3 w-3 animate-pulse" /> ENGINE: READY
          </span>
        </div>
      </footer>
    </div>
  );
}
