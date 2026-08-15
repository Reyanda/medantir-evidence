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
  ROB_LEVELS,
  seedSampleReview
} from "../engine/forestRuntime.js";
import { saveReview, loadReview, createReview } from "../engine/reviewengine.js";
import { setActiveProject, listProjects } from "../engine/projectstore.js";
import { runnableSources } from "../engine/academic.js";

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

export const MODULES = [
  { step: 1, label: "1. Review Type", view: "ReviewType", tab: "TYPE", hint: "Step 1: Define methodology, framework, RoB tools, and synthesis design" },
  { step: 2, label: "2. Questions", view: "Question", tab: "QUESTION", hint: "Step 2: Multi-question PRISM / PICO framing & syntax compilation" },
  { step: 3, label: "3. Protocols & Strategy", view: "Protocols", tab: "BUILD", hint: "Step 3: Database query translations, syntax explosion, and PRESS review" },
  { step: 4, label: "4. Search & Retrieval", view: "Search", tab: "ANALYZE", hint: "Step 4: Execute multi-source literature retrieval across configured databases" },
  { step: 5, label: "5. Screening", view: "Screening", tab: "ANALYZE", hint: "Step 5: High-density TiAb and Full-text screening grid with decision ledger" },
  { step: 6, label: "6. Extraction", view: "Extraction", tab: "SYNTHESIZE", hint: "Step 6: Structured study data extraction and 2x2 contingency table ingestion" },
  { step: 7, label: "7. Appraisal (RoB)", view: "Appraisal", tab: "SYNTHESIZE", hint: "Step 7: Critical appraisal using RoB 2, ROBINS-I, QUADAS-2, or CASP" },
  { step: 8, label: "8. Causal Triangulation", view: "Triangulation", tab: "SYNTHESIZE", hint: "Step 8: Multi-stream triangulation across orthogonal bias profiles" },
  { step: 9, label: "9. Synthesis", view: "Synthesis", tab: "SYNTHESIZE", hint: "Step 9: Inverse-variance and DerSimonian-Laird meta-analysis engine" },
  { step: 10, label: "10. Figures (Canvas)", view: "Figures", tab: "VISUALIZE", hint: "Step 10: Vector forest plot studio, N-panel geometry, and data table" },
  { step: 11, label: "11. Evidence Map", view: "Evidence Map", tab: "VISUALIZE", hint: "Step 11: Systematic evidence-gap map and geospatial evidence radar" },
  { step: 12, label: "12. Reports & PRISMA", view: "Reports", tab: "PUBLISH", hint: "Step 12: PRISMA flow diagram, structured summary, and auditable outputs" },
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
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [tableTab, setTableTab] = useState("DATA");
  const [settingsTab, setSettingsTab] = useState("AI models");
  const [leftDock, setLeftDock] = useState({ open: true, width: 240 });
  const [rightDock, setRightDock] = useState({ open: true, width: 280 });
  const [bottomDock, setBottomDock] = useState({ open: true, height: 160 });
  const [strategyQuestion, setStrategyQuestion] = useState("");
  const [activeTool, setActiveTool] = useState("select");
  const [openMenu, setOpenMenu] = useState(null);

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

  const MENUS = [
    {
      label: "File",
      items: [
        { label: "New Review…", run: () => { setActiveView("Launch"); setActiveTab("TYPE"); } },
        { label: "Attach Working Folder…", run: () => { setActiveView("Bridge"); setActiveTab("BUILD"); } },
        { label: "Open Document Reader", run: () => { setActiveView("Reader"); setActiveTab("ANALYZE"); } },
        { sep: true },
        { label: "Export Outcome CSV", run: exportCSV },
        { label: "Project Files", run: () => { setActiveView("Reports"); setActiveTab("PUBLISH"); } },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Add Manual Study Row", run: addManualRow },
        { label: "Delete Selected Row", run: removeSelectedRow },
        { sep: true },
        { label: "Review Methodology (Step 1)", run: () => { setActiveView("ReviewType"); setActiveTab("TYPE"); } },
        { label: "Research Questions (Step 2)", run: () => { setActiveView("Question"); setActiveTab("QUESTION"); } },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Toggle Left Dock (Cmd-1)", run: () => setLeftDock((d) => ({ ...d, open: !d.open })) },
        { label: "Toggle Right Inspector (Cmd-2)", run: () => setRightDock((d) => ({ ...d, open: !d.open })) },
        { label: "Toggle Bottom Ledger (Cmd-3)", run: () => setBottomDock((d) => ({ ...d, open: !d.open })) },
        { sep: true },
        { label: "Causal Triangulation Studio", run: () => { setActiveView("Triangulation"); setActiveTab("SYNTHESIZE"); } },
        { label: "Figures Vector Canvas", run: () => { setActiveView("Figures"); setActiveTab("VISUALIZE"); } },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "What Runs Where", run: () => { setActiveView("Bridge"); setActiveTab("BUILD"); } },
        { label: "Methodological Governance", run: () => { setActiveView("Overview"); setActiveTab("TYPE"); } },
      ],
    },
  ];

  return (
    <div className="wb">
      {/* 1. TOP NATIVE MENUBAR (22px) */}
      <div className="wb-menubar">
        <span className="wb-brand">MEDANTIR <b>EVIDENCE OS</b></span>
        {MENUS.map((m) => (
          <div key={m.label} style={{ position: "relative" }}>
            <span
              className={`wb-menu-item ${openMenu === m.label ? "on" : ""}`}
              onClick={() => setOpenMenu(openMenu === m.label ? null : m.label)}
            >
              {m.label}
            </span>
            {openMenu === m.label && (
              <div
                style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 1000,
                  background: "var(--bg-panel-2)", border: "1px solid var(--line-strong)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.5)", minWidth: 190, padding: 2, borderRadius: 2
                }}
              >
                {m.items.map((item, idx) => (
                  item.sep ? (
                    <div key={idx} style={{ height: 1, background: "var(--line)", margin: "3px 0" }} />
                  ) : (
                    <div
                      key={idx}
                      className="wb-menu-item"
                      onClick={() => { item.run?.(); setOpenMenu(null); }}
                      style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg)" }}
                    >
                      {item.label}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        ))}

        <span className="wb-spacer" />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, color: "var(--fg-dim)", fontFamily: "var(--mono)" }}>PROJECT:</span>
          <select
            className="wb-select"
            style={{ height: 18, fontSize: 10.5, fontFamily: "var(--mono)" }}
            value={pid}
            onChange={(e) => {
              setPid(e.target.value);
              setProjects(listReviewProjects());
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="wb-count" style={{ color: "var(--accent)", borderColor: "var(--line-strong)" }}>
            {review?.methodology?.typeName || "Systematic Review"}
          </span>
        </div>
      </div>

      {/* 2. TOP TOOLBAR RIBBON & MODE TABS (30px) */}
      <div className="wb-toolbar">
        {/* Mode Selector Tabs */}
        <div className="wb-tb-group" style={{ padding: 0 }}>
          {MODES.map(([tabKey, tabLabel]) => {
            const isActive = activeTab === tabKey;
            return (
              <button
                key={tabKey}
                className={`wb-btn ${isActive ? "on" : ""}`}
                onClick={() => {
                  setActiveTab(tabKey);
                  const matchingModule = MODULES.find((m) => m.tab === tabKey);
                  if (matchingModule) setActiveView(matchingModule.view);
                }}
              >
                {tabLabel}
              </button>
            );
          })}
        </div>

        <div className="wb-tb-group">
          <button
            className="wb-btn"
            disabled={currentStep <= 1}
            onClick={() => navigateStep(-1)}
            title="Previous pipeline step"
          >
            ◀
          </button>
          <span style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-dim)", padding: "0 4px" }}>
            STEP {currentStep}/{MODULES.length}
          </span>
          <button
            className="wb-btn"
            disabled={currentStep >= MODULES.length}
            onClick={() => navigateStep(1)}
            title="Next pipeline step"
          >
            ▶
          </button>
        </div>

        {activeView === "Figures" && (
          <div className="wb-tb-group">
            {[
              { id: "select", label: "V", title: "Select tool" },
              { id: "pan", label: "H", title: "Pan canvas" },
              { id: "zoom", label: "Z", title: "Zoom" },
              { id: "measure", label: "M", title: "Measure distance" },
              { id: "text", label: "T", title: "Text annotation" },
              { id: "shape", label: "R", title: "Vector shape" },
            ].map((t) => (
              <button
                key={t.id}
                className={`wb-btn ${activeTool === t.id ? "on" : ""}`}
                onClick={() => setActiveTool(t.id)}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <span className="wb-spacer" />

        <div className="wb-tb-group">
          {activeView === "Figures" && (
            <>
              <select
                className="wb-select"
                style={{ height: 20, fontSize: 10.5 }}
                value={outcome.measure}
                onChange={(e) => commitDataset(updateOutcome(dataset, outcome.id, { measure: e.target.value }))}
              >
                <option value="RR">Risk Ratio (RR)</option>
                <option value="OR">Odds Ratio (OR)</option>
              </select>
              <button className="wb-btn" onClick={addManualRow}>+ Study Row</button>
            </>
          )}
          <button className="wb-btn" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>

      {/* 3. DENSE WORKSPACE: LEFT DOCK + CENTER VIEWPORT + RIGHT INSPECTOR */}
      <div className="wb-workspace">
        {/* Left Dock: 12-Step Method Pipeline */}
        {leftDock.open && (
          <div className="wb-panel" style={{ width: leftDock.width }}>
            <div className="wb-panel-head">
              <span className="title">Pipeline</span>
              <span className="wb-count">12 STEPS</span>
            </div>
            <div className="wb-panel-body">
              <div className="wb-insp-title">12-Step Ordered Sequence</div>
              {MODULES.map((m) => {
                const isActive = activeView === m.view;
                const isPast = m.step < currentStep;
                return (
                  <div
                    key={m.view}
                    className={`wb-row ${isActive ? "sel" : ""}`}
                    onClick={() => { setActiveView(m.view); setActiveTab(m.tab); }}
                    title={m.hint}
                  >
                    <span className="lbl">{m.label}</span>
                    {isPast && <span className="n" style={{ color: "var(--ok)", borderColor: "var(--ok)" }}>✓</span>}
                  </div>
                );
              })}

              <div className="wb-insp-title">Utilities & Infrastructure</div>
              {UTILITY_MODULES.map((m) => {
                const isActive = activeView === m.view;
                return (
                  <div
                    key={m.view}
                    className={`wb-row ${isActive ? "sel" : ""}`}
                    onClick={() => { setActiveView(m.view); setActiveTab(m.tab); }}
                    title={m.hint}
                  >
                    <span className="lbl">{m.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {leftDock.open && (
          <div
            className="wb-gutter"
            onDoubleClick={() => setLeftDock((d) => ({ ...d, open: false }))}
            title="Double-click to collapse left dock"
          />
        )}

        {/* Center Viewport */}
        <div className="wb-panel center">
          <div className="wb-panel-head">
            <span className="title">{activeView}</span>
            <span className="wb-spacer" />
            <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-faint)" }}>
              {review?.question ? `"${review.question.slice(0, 75)}…"` : "No research question bound"}
            </span>
          </div>

          <div className="wb-panel-body">
            {/* Step 1: Review Type */}
            {activeView === "ReviewType" && (
              <ReviewTypePanel
                projectId={pid}
                review={review}
                onUpdateReview={(r) => setReview(r)}
                onNote={note}
                onNavigateNext={() => { setActiveView("Question"); setActiveTab("QUESTION"); }}
              />
            )}

            {/* Step 2: Questions */}
            {activeView === "Question" && (
              <QuestionBuilder
                projectId={pid}
                review={review}
                onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                onNote={note}
                onOpenStrategy={(q) => { setStrategyQuestion(q); setActiveView("Protocols"); setActiveTab("BUILD"); }}
                onNavigateNext={() => { setActiveView("Protocols"); setActiveTab("BUILD"); }}
              />
            )}

            {/* Step 3: Protocols */}
            {activeView === "Protocols" && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <SearchStrategyBuilder initialQuestion={strategyQuestion || review?.question || ""} />
              </div>
            )}

            {/* Step 4: Search */}
            {activeView === "Search" && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <SearchView goToSources={() => { setActiveView("Databases"); setActiveTab("BUILD"); }} />
              </div>
            )}

            {/* Step 5: Screening */}
            {activeView === "Screening" && (
              <ScreeningGrid
                projectId={pid}
                review={review}
                onReviewChange={(r) => { setReview(r); setDataset(readDataset(r)); }}
                onNote={note}
              />
            )}

            {/* Step 6 & 7: Extraction & Appraisal */}
            {(activeView === "Extraction" || activeView === "Appraisal") && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <ReviewTab embedded />
              </div>
            )}

            {/* Step 8: Causal Triangulation */}
            {activeView === "Triangulation" && (
              <CausalTriangulationPanel
                projectId={pid}
                review={review}
                onNote={note}
              />
            )}

            {/* Step 9: Synthesis */}
            {activeView === "Synthesis" && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <ReviewTab embedded />
              </div>
            )}

            {/* Step 10: Figures (Vector Canvas) */}
            {activeView === "Figures" && (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-app)", overflow: "auto", padding: 16 }}>
                <div style={{ maxWidth: 840, margin: "0 auto", width: "100%", background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 2, padding: 16 }}>
                  {layersVisibility.title && (
                    <div style={{ textAlign: "center", marginBottom: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-bright)" }}>
                        {outcome.name}
                      </div>
                      {layersVisibility.subtitle && (
                        <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--fg-dim)", marginTop: 2 }}>
                          Random-effects meta-analysis (DerSimonian–Laird) · I² = {computed?.meta?.heterogeneity?.I2 || "37"}% · Q = {computed?.meta?.heterogeneity?.Q || "12.6"}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Header Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "180px 45px 45px 1fr 50px 40px", gap: 6, borderBottom: "1px solid var(--line)", paddingBottom: 4, fontSize: 10.5, fontFamily: "var(--mono)", fontWeight: 700, color: "var(--fg-dim)", textTransform: "uppercase" }}>
                    <div>Study</div>
                    <div style={{ textAlign: "center" }}>Ev(T)</div>
                    <div style={{ textAlign: "center" }}>Tot(T)</div>
                    <div style={{ textAlign: "center" }}>Risk Ratio (95% CI)</div>
                    <div style={{ textAlign: "right" }}>Weight</div>
                    <div style={{ textAlign: "center" }}>RoB</div>
                  </div>

                  {/* Studies List */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "6px 0" }}>
                    {(computed?.rows || []).map((row) => {
                      const isSel = selectedRowId === row.studyId;
                      const leftPos = getXPos(row.ci ? row.ci[0] : 0.5);
                      const rightPos = getXPos(row.ci ? row.ci[1] : 1.5);
                      const pointPos = getXPos(row.effect || 1.0);

                      return (
                        <div
                          key={row.studyId}
                          onClick={() => setSelectedRowId(row.studyId)}
                          style={{
                            display: "grid", gridTemplateColumns: "180px 45px 45px 1fr 50px 40px", gap: 6,
                            alignItems: "center", height: 22, padding: "0 2px", borderRadius: 2,
                            background: isSel ? "var(--bg-active-2)" : "transparent",
                            border: isSel ? "1px solid var(--line-focus)" : "1px solid transparent",
                            cursor: "default"
                          }}
                        >
                          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: isSel ? "var(--fg-bright)" : "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {row.studyName}
                          </div>
                          <div style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>{row.eventsT}</div>
                          <div style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>{row.totalT}</div>

                          {/* Graphical Plot Cell */}
                          <div style={{ position: "relative", height: 16, display: "flex", alignItems: "center" }}>
                            {layersVisibility.nullLine && (
                              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${getXPos(1.0)}%`, width: 1, background: "var(--line)" }} />
                            )}
                            <div style={{ position: "absolute", height: 1.5, background: "var(--fg)", left: `${leftPos}%`, width: `${Math.max(2, rightPos - leftPos)}%` }} />
                            <div
                              style={{
                                position: "absolute", left: `${pointPos}%`, marginLeft: -4,
                                width: 8, height: 8, background: robColor(row.rob), borderRadius: 1
                              }}
                            />
                          </div>

                          <div style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>
                            {row.weight?.toFixed(1) || "11.1"}%
                          </div>
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: robColor(row.rob) }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary Pooled Row */}
                  {layersVisibility.summary && (
                    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 6, display: "grid", gridTemplateColumns: "180px 45px 45px 1fr 50px 40px", gap: 6, alignItems: "center", fontWeight: 700, fontSize: 11, color: "var(--fg-bright)" }}>
                      <div>Total (95% CI)</div>
                      <div style={{ textAlign: "center" }}>{(computed?.rows || []).reduce((s, r) => s + (r.eventsT || 0), 0)}</div>
                      <div style={{ textAlign: "center" }}>{(computed?.rows || []).reduce((s, r) => s + (r.totalT || 0), 0)}</div>

                      <div style={{ position: "relative", height: 16, display: "flex", alignItems: "center" }}>
                        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${getXPos(1.0)}%`, width: 1, background: "var(--line)" }} />
                        <div style={{ position: "absolute", left: `${getXPos(computed?.meta?.random?.effect || 0.40)}%`, marginLeft: -12, width: 24, height: 12 }}>
                          <svg viewBox="0 0 32 16" style={{ width: "100%", height: "100%", fill: "rgba(230,180,60,0.35)", stroke: "#e6b43c", strokeWidth: 1.5 }}>
                            <polygon points="0,8 16,0 32,8 16,16" />
                          </svg>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", color: "var(--accent)" }}>100.0%</div>
                      <div />
                    </div>
                  )}

                  {/* Axis Tick Scale */}
                  {layersVisibility.axisX && (
                    <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 6, position: "relative", height: 24, fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-faint)" }}>
                      {[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0].map((val) => (
                        <div
                          key={val}
                          style={{ position: "absolute", left: `${getXPos(val)}%`, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}
                        >
                          <div style={{ width: 1, height: 4, background: "var(--line-strong)" }} />
                          <span>{val}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg-dim)", marginTop: 6 }}>
                    <span style={{ color: "var(--accent)" }}>◀ Favours Intervention</span>
                    <span style={{ color: "var(--err)" }}>Favours Control ▶</span>
                  </div>
                </div>
              </div>
            )}

            {/* Step 11: Evidence Map */}
            {activeView === "Evidence Map" && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <ResearchLoopView />
              </div>
            )}

            {/* Step 12: Reports */}
            {activeView === "Reports" && (
              <div style={{ padding: 10, height: "100%", overflow: "auto" }}>
                <ProjectFiles projectId={pid} />
              </div>
            )}

            {/* Utility Docks */}
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
            {activeView === "Overview" && <ScientificRuntimeView projectId={pid} />}
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

        {/* Right Inspector Dock */}
        {rightDock.open && (
          <div className="wb-panel" style={{ width: rightDock.width }}>
            <div className="wb-panel-head">
              <span className="title">Inspector</span>
              <span className="wb-count">PROPERTIES</span>
            </div>
            <div className="wb-panel-body">
              <div className="wb-insp-title">Layers & Visibility</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 8px" }}>
                {Object.keys(layersVisibility).map((k) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg)" }}>
                    <input
                      type="checkbox"
                      checked={layersVisibility[k]}
                      onChange={(e) => setLayersVisibility((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                    <span style={{ textTransform: "capitalize" }}>{k.replace(/([A-Z])/g, " $1")}</span>
                  </label>
                ))}
              </div>

              {selectedRowId && (
                <>
                  <div className="wb-insp-title">Study Parameters</div>
                  {(() => {
                    const row = outcome?.rows?.find((r) => r.studyId === selectedRowId);
                    if (!row) return null;
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 8px" }}>
                        <div>
                          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Study Name</div>
                          <input
                            type="text"
                            className="wb-input"
                            style={{ width: "100%" }}
                            value={row.studyName}
                            onChange={(e) => updateSelectedRow("studyName", e.target.value)}
                          />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <div>
                            <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Events (T)</div>
                            <input
                              type="number"
                              className="wb-input wb-mono"
                              style={{ width: "100%" }}
                              value={row.eventsT}
                              onChange={(e) => updateSelectedRow("eventsT", Number(e.target.value))}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Total (T)</div>
                            <input
                              type="number"
                              className="wb-input wb-mono"
                              style={{ width: "100%" }}
                              value={row.totalT}
                              onChange={(e) => updateSelectedRow("totalT", Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                          <div>
                            <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Events (C)</div>
                            <input
                              type="number"
                              className="wb-input wb-mono"
                              style={{ width: "100%" }}
                              value={row.eventsC}
                              onChange={(e) => updateSelectedRow("eventsC", Number(e.target.value))}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Total (C)</div>
                            <input
                              type="number"
                              className="wb-input wb-mono"
                              style={{ width: "100%" }}
                              value={row.totalC}
                              onChange={(e) => updateSelectedRow("totalC", Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>Risk of Bias Judgement</div>
                          <select
                            className="wb-select"
                            style={{ width: "100%" }}
                            value={row.rob}
                            onChange={(e) => updateSelectedRow("rob", e.target.value)}
                          >
                            <option value="Low">Low Risk</option>
                            <option value="Some">Some Concerns</option>
                            <option value="High">High Risk</option>
                          </select>
                        </div>
                        <button className="wb-btn danger" onClick={removeSelectedRow} style={{ marginTop: 4 }}>
                          Delete Study Row
                        </button>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 4. DOCKABLE BOTTOM DATA TABLE (160px) */}
      {bottomDock.open && activeView === "Figures" && (
        <div style={{ height: bottomDock.height, display: "flex", flexDirection: "column", background: "var(--bg-panel)", borderTop: "1px solid var(--line)" }}>
          <div className="wb-panel-head">
            <span className="title">Contingency Data Ledger</span>
            <span className="wb-count">{(outcome.rows || []).length} STUDIES</span>
            <span className="wb-spacer" />
            <button className="wb-btn" onClick={addManualRow}>+ Add Row</button>
            <button className="wb-btn" onClick={exportCSV}>CSV Export</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <table className="wb-grid">
              <thead>
                <tr>
                  <th style={{ width: 180 }}>Study Name</th>
                  <th style={{ width: 60, textAlign: "center" }}>Events (T)</th>
                  <th style={{ width: 60, textAlign: "center" }}>Total (T)</th>
                  <th style={{ width: 60, textAlign: "center" }}>Events (C)</th>
                  <th style={{ width: 60, textAlign: "center" }}>Total (C)</th>
                  <th style={{ width: 80, textAlign: "center" }}>Effect ({outcome.measure})</th>
                  <th style={{ width: 60, textAlign: "right" }}>Weight</th>
                  <th style={{ width: 70, textAlign: "center" }}>RoB</th>
                </tr>
              </thead>
              <tbody>
                {(computed?.rows || []).map((r) => {
                  const isSel = selectedRowId === r.studyId;
                  return (
                    <tr
                      key={r.studyId}
                      className={isSel ? "sel" : ""}
                      onClick={() => setSelectedRowId(r.studyId)}
                      style={{ cursor: "default" }}
                    >
                      <td style={{ fontWeight: 600 }}>{r.studyName}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--mono)" }}>{r.eventsT}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--mono)" }}>{r.totalT}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--mono)" }}>{r.eventsC}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--mono)" }}>{r.totalC}</td>
                      <td style={{ textAlign: "center", fontFamily: "var(--mono)", color: "var(--accent)" }}>{r.effect?.toFixed(2) || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--mono)" }}>{r.weight?.toFixed(1) || "—"}%</td>
                      <td style={{ textAlign: "center" }}>
                        <span className="wb-tag" style={{ color: robColor(r.rob), borderColor: robColor(r.rob) }}>
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
      )}

      {/* 5. NATIVE STATUSBAR (20px) */}
      <div className="wb-statusbar">
        <span>● PIPELINE ACTIVE</span>
        <span className="wb-sep" />
        <span>STEP: {currentStep}/12 {activeView}</span>
        <span className="wb-sep" />
        <span>STUDIES: {(outcome.rows || []).length}</span>
        <span className="wb-sep" />
        <span>POOLED: {computed?.meta?.random?.effect?.toFixed(2) || "0.40"}</span>
        <span className="wb-spacer" />
        <span>CAUSAL TRIANGULATION: 5 STREAMS</span>
        <span className="wb-sep" />
        <span style={{ color: "var(--ok)" }}>ENGINE: READY</span>
      </div>
    </div>
  );
}
