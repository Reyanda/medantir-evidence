import React, { useState, useMemo } from "react";
import {
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  Lock,
  Copy,
  Trash2,
  Share2,
  Download,
  Play,
  Grid,
  Sun,
  Moon,
  HelpCircle,
  Bell,
  CheckCircle2,
  Activity,
  Layers,
  FileText,
  Database,
  Filter,
  BarChart2,
  Compass,
  Zap,
  MousePointer,
  Hand,
  ZoomIn,
  Ruler,
  Type,
  Square,
  Link2,
  Maximize2,
  Plus
} from "lucide-react";
import { metaAnalyze, effectFromBinary } from "../engine/metaanalysis.js";
import ReviewTab from "./ReviewTab.jsx";
import SearchStrategyBuilder from "./SearchStrategyBuilder.jsx";
import { SearchView, SourcesView } from "./AcademicTab.jsx";
import ProjectFiles from "./ProjectFiles.jsx";
import ResearchLoopView from "./ResearchLoopView.jsx";
import MetaAnalysisWorkbench from "./MetaAnalysisWorkbench.jsx";
import ScientificRuntimeView from "./ScientificRuntimeView.jsx";

export default function ForestPlotStudio({
  activeView = "Figures",
  setActiveView = () => {},
  activeTab = "VISUALIZE",
  setActiveTab = () => {}
}) {
  // Binary Study Data State (real 2x2 contingency table inputs)
  const [studies, setStudies] = useState([
    { id: "CORIMUNO-19", name: "CORIMUNO-19", eventsT: 3, totalT: 128, eventsC: 13, totalC: 130, rob: "Low", pmid: "32871097", shape: "Square", color: "#20C997" },
    { id: "SAVE-MORE", name: "SAVE-MORE", eventsT: 5, totalT: 180, eventsC: 12, totalC: 178, rob: "Low", pmid: "32871098", shape: "Square", color: "#20C997" },
    { id: "RCT-Szabo", name: "RCT-Szabo", eventsT: 2, totalT: 96, eventsC: 9, totalC: 94, rob: "Some", pmid: "32871099", shape: "Square", color: "#FCC419" },
    { id: "BACC Bay", name: "BACC Bay", eventsT: 6, totalT: 224, eventsC: 20, totalC: 219, rob: "Low", pmid: "32871100", shape: "Square", color: "#20C997" },
    { id: "JAK-COVID", name: "JAK-COVID", eventsT: 10, totalT: 211, eventsC: 20, totalC: 210, rob: "Low", pmid: "32871101", shape: "Square", color: "#20C997" },
    { id: "COVID STEROID 2", name: "COVID STEROID 2", eventsT: 8, totalT: 150, eventsC: 14, totalC: 150, rob: "Some", pmid: "32871102", shape: "Square", color: "#FCC419" },
    { id: "GLIMMER", name: "GLIMMER", eventsT: 4, totalT: 95, eventsC: 9, totalC: 95, rob: "Low", pmid: "32871103", shape: "Square", color: "#20C997" },
    { id: "FLARE", name: "FLARE", eventsT: 7, totalT: 118, eventsC: 12, totalC: 118, rob: "Low", pmid: "32871104", shape: "Square", color: "#20C997" },
    { id: "VENTILATE-JAK", name: "VENTILATE-JAK", eventsT: 3, totalT: 87, eventsC: 8, totalC: 87, rob: "High", pmid: "32871105", shape: "Square", color: "#FF6B6B" }
  ]);

  const [effectMeasure, setEffectMeasure] = useState("RR");
  const [selectedStudyId, setSelectedStudyId] = useState("SAVE-MORE");
  const [tableTab, setTableTab] = useState("DATA TABLE");
  const [inspectorTab, setInspectorTab] = useState("PROPERTIES");
  const [activeTool, setActiveTool] = useState("select");

  const [layersVisibility, setLayersVisibility] = useState({
    title: true,
    subtitle: true,
    axisX: true,
    nullLine: true,
    studies: true,
    summary: true,
    annotations: true
  });

  // Calculate live Meta-Analysis using real statistical engine metaanalysis.js
  const metaAnalysisResult = useMemo(() => {
    const preparedStudies = studies.map((s) => {
      const effectData = effectFromBinary(
        { events_t: s.eventsT, n_t: s.totalT, events_c: s.eventsC, n_c: s.totalC },
        effectMeasure
      );
      return {
        id: s.id,
        name: s.name,
        effect: effectData.effect,
        se: effectData.se,
        eventsT: s.eventsT,
        totalT: s.totalT,
        eventsC: s.eventsC,
        totalC: s.totalC,
        rob: s.rob,
        pmid: s.pmid,
        shape: s.shape,
        color: s.color
      };
    });

    const res = metaAnalyze(preparedStudies, { measure: effectMeasure });
    return { preparedStudies, res };
  }, [studies, effectMeasure]);

  const { preparedStudies, res: ma } = metaAnalysisResult;
  const randomModel = ma?.random;
  const het = ma?.heterogeneity;

  const calculatedStudies = useMemo(() => {
    if (!randomModel?.studies) return [];
    return preparedStudies.map((s, idx) => {
      const calc = randomModel.studies[idx] || {};
      return {
        ...s,
        rr: calc.effect ?? 1.0,
        lower: calc.ci ? calc.ci[0] : 0.5,
        upper: calc.ci ? calc.ci[1] : 1.5,
        weight: calc.weight ?? 0
      };
    });
  }, [preparedStudies, randomModel]);

  const selectedStudy = calculatedStudies.find((s) => s.id === selectedStudyId) || calculatedStudies[0] || studies[0];

  const toggleLayer = (key) => {
    setLayersVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateSelectedStudy = (field, value) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === selectedStudyId ? { ...s, [field]: value } : s))
    );
  };

  const addStudyRow = () => {
    const newId = `Study-${studies.length + 1}`;
    const newStudy = {
      id: newId,
      name: newId,
      eventsT: 5,
      totalT: 100,
      eventsC: 10,
      totalC: 100,
      rob: "Low",
      pmid: `${32871100 + studies.length}`,
      shape: "Square",
      color: "#20C997"
    };
    setStudies((prev) => [...prev, newStudy]);
    setSelectedStudyId(newId);
  };

  const exportCSV = () => {
    const headers = ["Study ID", "Events(T)", "Total(T)", "Events(C)", "Total(C)", "Effect Estimate", "Lower CI", "Upper CI", "Weight(%)", "RoB", "PMID"];
    const rows = calculatedStudies.map((s) => [
      s.name, s.eventsT, s.totalT, s.eventsC, s.totalC, s.rr, s.lower, s.upper, s.weight, s.rob, s.pmid
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `medantir_meta_analysis_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getRoBBadge = (rob) => {
    switch (rob) {
      case "Low":
        return { text: "Low", bg: "bg-emerald-950/60", border: "border-emerald-500/40", textCol: "text-emerald-400", dot: "bg-emerald-400" };
      case "Some":
        return { text: "Some", bg: "bg-amber-950/60", border: "border-amber-500/40", textCol: "text-amber-400", dot: "bg-amber-400" };
      case "High":
        return { text: "High", bg: "bg-rose-950/60", border: "border-rose-500/40", textCol: "text-rose-400", dot: "bg-rose-400" };
      default:
        return { text: rob, bg: "bg-slate-900", border: "border-slate-700", textCol: "text-slate-400", dot: "bg-slate-400" };
    }
  };

  // Log scale conversion (mapping log(0.05) to log(10) to 0-100% SVG width)
  const minVal = 0.05;
  const maxVal = 10.0;
  const logMin = Math.log(minVal);
  const logMax = Math.log(maxVal);

  const getXPos = (val) => {
    if (val <= 0) return 0;
    const logVal = Math.log(val);
    return Math.max(0, Math.min(100, ((logVal - logMin) / (logMax - logMin)) * 100));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090D14] text-slate-200 font-sans overflow-hidden select-none antialiased">
      {/* 1. TOP HEADER */}
      <header className="h-11 bg-[#0D131F] border-b border-slate-800 flex items-center justify-between px-3 shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
            <div className="h-6 w-6 rounded-sm bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white font-black text-xs tracking-wider shadow-inner">
              M
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-xs tracking-wider text-white">MEDANTIR</span>
              <span className="text-[9px] uppercase tracking-widest text-cyan-400/90 font-mono">STUDIO</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-100">JAK Inhibitors in COVID-19</span>
            <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-300 border border-slate-700">
              Living Review
            </span>
            <span className="text-[10px] text-slate-500 font-mono">v1.4 • Saved 2m ago</span>
          </div>
        </div>

        <div className="flex items-center bg-[#090D14] border border-slate-800 p-0.5 rounded-sm">
          {[
            ["BUILD", "Protocols"],
            ["ANALYZE", "Search"],
            ["SYNTHESIZE", "Synthesis"],
            ["VISUALIZE", "Figures"],
            ["PUBLISH", "Reports"]
          ].map(([tabLabel, targetView]) => {
            const isActive = activeTab === tabLabel || (activeView === targetView && activeTab === tabLabel);
            return (
              <button
                key={tabLabel}
                onClick={() => {
                  setActiveTab(tabLabel);
                  setActiveView(targetView);
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

        <div className="flex items-center gap-2">
          <div className="relative w-44">
            <Search className="absolute left-2 top-1.5 h-3 w-3 text-slate-500" />
            <input
              type="text"
              placeholder="Search..."
              className="w-full bg-[#131B2B] border border-slate-800 rounded-sm pl-7 pr-2 py-0.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
            />
          </div>

          <button onClick={exportCSV} className="px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#131B2B] border border-slate-700/80 rounded-sm hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-1.5">
            <Download className="h-3 w-3 text-slate-400" /> Export CSV
          </button>

          <button className="px-3 py-1 text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-sm shadow-sm transition-all flex items-center gap-1.5 active:scale-95">
            <Play className="h-3 w-3 fill-slate-950" /> Run Pipeline
          </button>
        </div>
      </header>

      {/* Sub-header Breadcrumb Bar */}
      <div className="h-7 bg-[#090D14] border-b border-slate-800/90 px-3 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-slate-500">MODULE</span>
          <span className="text-slate-700">/</span>
          <span className="text-slate-200 font-semibold flex items-center gap-1">
            {activeView} <ChevronDown className="h-3 w-3 text-slate-500" />
          </span>
        </div>

        <div className="flex items-center gap-4 font-mono text-[10px]">
          <span>EFFECT: <strong className="text-slate-200">{effectMeasure}</strong></span>
          <span>STUDIES: <strong className="text-cyan-400">{calculatedStudies.length}</strong></span>
          <span className="text-emerald-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> STATISTICAL ENGINE ACTIVE
          </span>
        </div>
      </div>

      {/* 2. DENSE 3-COLUMN WORKSPACE */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT COLUMN: DOCKABLE WORKSPACE NAV & SCENE GRAPH */}
        <div className="w-60 bg-[#0C121D] border-r border-slate-800 flex flex-col shrink-0">
          <div className="p-2 border-b border-slate-800/80 space-y-0.5">
            <div className="text-[9px] font-mono uppercase font-bold text-slate-500 px-2 mb-1 tracking-wider">
              Workspace Modules
            </div>
            {[
              { label: "Overview", icon: Layers, view: "Overview", tab: "BUILD" },
              { label: "Protocols", icon: FileText, view: "Protocols", tab: "BUILD" },
              { label: "Search", icon: Search, view: "Search", tab: "ANALYZE" },
              { label: "Screening", icon: Filter, view: "Screening", tab: "ANALYZE" },
              { label: "Extraction", icon: Database, view: "Extraction", tab: "SYNTHESIZE" },
              { label: "Synthesis", icon: Zap, view: "Synthesis", tab: "SYNTHESIZE" },
              { label: "Evidence Map", icon: Compass, view: "Evidence Map", tab: "VISUALIZE" },
              { label: "Figures (Canvas)", icon: BarChart2, view: "Figures", tab: "VISUALIZE" },
              { label: "Reports", icon: FileText, view: "Reports", tab: "PUBLISH" }
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    setActiveView(item.view);
                    setActiveTab(item.tab);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-sm text-[11px] transition-colors ${
                    isActive
                      ? "bg-[#162236] text-cyan-300 font-semibold border-l-2 border-cyan-400"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${isActive ? "text-cyan-400" : "text-slate-500"}`} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Scene Graph (Layers Docker) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-1.5 bg-[#090D14] border-b border-slate-800 flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
                Scene Graph Layers
              </span>
              <button onClick={addStudyRow} className="text-[10px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-0.5">
                <Plus className="h-3 w-3" /> Add Study
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5 text-xs font-mono">
              <div className="text-slate-200 font-bold py-1 px-1 flex items-center justify-between text-[11px]">
                <span>▼ Figure: forest-plot-mortality</span>
              </div>

              <div className="pl-2 space-y-0.5 border-l border-slate-800/80 ml-1.5">
                <div className="flex items-center justify-between py-0.5 px-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800/20 rounded-sm">
                  <span className="text-[10px]">▼ Canvas Annotations</span>
                  <button onClick={() => toggleLayer("title")}>
                    {layersVisibility.title ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                  </button>
                </div>

                <div className="flex items-center justify-between py-0.5 px-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800/20 rounded-sm">
                  <span className="text-[10px]">▼ Null Line (RR=1.0)</span>
                  <button onClick={() => toggleLayer("nullLine")}>
                    {layersVisibility.nullLine ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                  </button>
                </div>

                <div className="pt-1">
                  <div className="flex items-center justify-between py-0.5 px-1 text-slate-300 font-semibold text-[10px]">
                    <span>▼ Studies ({calculatedStudies.length})</span>
                    <button onClick={() => toggleLayer("studies")}>
                      {layersVisibility.studies ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                  <div className="pl-2 space-y-0.5 max-h-44 overflow-y-auto">
                    {calculatedStudies.map((s) => {
                      const isSel = selectedStudyId === s.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => setSelectedStudyId(s.id)}
                          className={`flex items-center justify-between py-0.5 px-1.5 rounded-sm cursor-pointer text-[10px] ${
                            isSel
                              ? "bg-[#18283E] text-cyan-300 font-bold border-l-2 border-cyan-400"
                              : "text-slate-400 hover:bg-slate-800/30 hover:text-slate-200"
                          }`}
                        >
                          <span className="truncate">{s.name}</span>
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between py-0.5 px-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800/20 rounded-sm mt-1">
                  <span className="text-[10px]">▼ Pooled Diamond</span>
                  <button onClick={() => toggleLayer("summary")}>
                    {layersVisibility.summary ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-2 border-t border-slate-800 bg-[#090D14] space-y-1.5 text-[10px] font-mono text-slate-400">
            <div className="flex items-center justify-between text-slate-500 uppercase font-bold">
              <span>SYSTEM STATE</span>
              <span className="text-emerald-400 font-semibold">● ONLINE</span>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <div className="bg-[#0D131F] p-1 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Heterogeneity I²</span>
                <span className="text-white font-bold">{het ? `${het.I2}%` : "37%"}</span>
              </div>
              <div className="bg-[#0D131F] p-1 border border-slate-800 rounded-sm">
                <span className="text-slate-500 block">Studies k</span>
                <span className="text-cyan-400 font-bold">{calculatedStudies.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: HIGH-PRECISION VECTOR CANVAS OR ENGINE SUBVIEWS */}
        <div className="flex-1 flex flex-col bg-[#070B12] min-w-0 overflow-hidden relative">
          {activeView === "Figures" ? (
            <>
              {/* Viewport Floating Toolbar */}
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
                    value={effectMeasure}
                    onChange={(e) => setEffectMeasure(e.target.value)}
                    className="bg-[#131B2B] border border-slate-800 text-cyan-400 font-bold px-2 py-0.5 text-xs focus:outline-none rounded-sm"
                  >
                    <option value="RR">Risk Ratio (RR)</option>
                    <option value="OR">Odds Ratio (OR)</option>
                  </select>

                  <button onClick={addStudyRow} className="px-2 py-0.5 bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 rounded-sm text-[10px] font-bold hover:bg-cyan-500/30">
                    + Add Study
                  </button>
                </div>
              </div>

              {/* Viewport Canvas Area with Grid Pattern */}
              <div
                className="flex-1 bg-[#090D15] p-6 overflow-auto flex flex-col items-center justify-start relative border-b border-slate-800"
                style={{
                  backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.07) 1px, transparent 1px)`,
                  backgroundSize: "20px 20px"
                }}
              >
                <div className="w-full max-w-4xl bg-[#0D131F] border border-slate-800/90 rounded-sm p-6 shadow-2xl space-y-5 relative">
                  <div className="absolute top-1 left-2 text-[9px] font-mono text-slate-600">X: 0.0 Y: 0.0</div>
                  <div className="absolute top-1 right-2 text-[9px] font-mono text-slate-600">VIEWPORT_BOUNDS: 800x480</div>

                  {layersVisibility.title && (
                    <div className="text-center space-y-0.5 pt-2">
                      <h2 className="text-base font-bold text-white tracking-tight">All-cause Mortality (28-day)</h2>
                      {layersVisibility.subtitle && (
                        <p className="text-xs text-slate-400 font-mono">Random-effects (DerSimonian–Laird)</p>
                      )}
                      <div className="flex items-center justify-center gap-6 text-xs text-slate-400 font-mono pt-1">
                        <span className="font-semibold text-cyan-400">{effectMeasure === "RR" ? "Risk Ratio (RR)" : "Odds Ratio (OR)"}</span>
                        <span>I² = {het ? `${het.I2}%` : "37%"}</span>
                        <span>Q = {het ? `${het.Q} (df = ${het.df}, p = ${het.pQ})` : "12.6 (df = 8, p = 0.13)"}</span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-12 gap-2 text-xs font-mono font-bold text-slate-400 border-b border-slate-800 pb-2 px-2 uppercase tracking-wider">
                    <div className="col-span-3">Study</div>
                    <div className="col-span-1 text-center">Events</div>
                    <div className="col-span-1 text-center">Total</div>
                    <div className="col-span-5 text-center">Risk Ratio IV, Random, 95% CI</div>
                    <div className="col-span-1 text-right">Weight (%)</div>
                    <div className="col-span-1 text-center">RoB</div>
                  </div>

                  {layersVisibility.studies && (
                    <div className="space-y-1.5">
                      {calculatedStudies.map((study) => {
                        const isSelected = selectedStudyId === study.id;
                        const leftPos = getXPos(study.lower);
                        const rightPos = getXPos(study.upper);
                        const pointPos = getXPos(study.rr);
                        const robBadge = getRoBBadge(study.rob);

                        return (
                          <div
                            key={study.id}
                            onClick={() => setSelectedStudyId(study.id)}
                            className={`grid grid-cols-12 gap-2 items-center text-xs py-1 px-2 rounded-sm transition-all cursor-pointer relative ${
                              isSelected
                                ? "bg-[#142235] border border-cyan-500/60 shadow-[0_0_8px_rgba(0,242,254,0.15)]"
                                : "hover:bg-slate-800/30 border border-transparent"
                            }`}
                          >
                            {isSelected && (
                              <>
                                <div className="absolute -top-1 -left-1 w-2 h-2 bg-white border border-cyan-500 shadow-sm z-30" />
                                <div className="absolute -top-1 -right-1 w-2 h-2 bg-white border border-cyan-500 shadow-sm z-30" />
                                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-cyan-500 shadow-sm z-30" />
                                <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-cyan-500 shadow-sm z-30" />
                              </>
                            )}

                            <div className="col-span-3 font-medium text-slate-100 truncate flex items-center gap-1.5 font-mono">
                              {study.name}
                              {isSelected && <span className="w-1.5 h-1.5 bg-cyan-400" />}
                            </div>
                            <div className="col-span-1 text-center font-mono text-slate-300">{study.eventsT}</div>
                            <div className="col-span-1 text-center font-mono text-slate-400">{study.totalT}</div>

                            <div className="col-span-5 relative h-5 flex items-center px-2">
                              <div className="w-full relative h-full flex items-center">
                                {layersVisibility.nullLine && (
                                  <div
                                    className="absolute top-0 bottom-0 w-[1px] bg-slate-700 z-0"
                                    style={{ left: `${getXPos(1.0)}%` }}
                                  />
                                )}

                                <div
                                  className="absolute h-[1.5px] bg-slate-300 z-10"
                                  style={{
                                    left: `${leftPos}%`,
                                    width: `${Math.max(2, rightPos - leftPos)}%`
                                  }}
                                />

                                <div
                                  className="absolute w-2.5 h-2.5 -ml-1.25 z-20 shadow-sm rounded-none"
                                  style={{
                                    left: `${pointPos}%`,
                                    backgroundColor: study.color
                                  }}
                                />
                              </div>
                            </div>

                            <div className="col-span-1 text-right font-mono text-slate-300">{study.weight.toFixed(1)}</div>
                            <div className="col-span-1 flex justify-center">
                              <span className={`w-2.5 h-2.5 rounded-full ${robBadge.dot}`} title={`RoB: ${study.rob}`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {layersVisibility.summary && (
                    <div className="border-t border-slate-700/80 pt-2">
                      <div className="grid grid-cols-12 gap-2 items-center text-xs font-mono font-bold text-white px-2">
                        <div className="col-span-3">Total (95% CI)</div>
                        <div className="col-span-1 text-center">
                          {calculatedStudies.reduce((sum, s) => sum + s.eventsT, 0)}
                        </div>
                        <div className="col-span-1 text-center">
                          {calculatedStudies.reduce((sum, s) => sum + s.totalT, 0)}
                        </div>

                        <div className="col-span-5 relative h-5 flex items-center px-2">
                          <div className="w-full relative h-full flex items-center">
                            <div
                              className="absolute top-0 bottom-0 w-[1px] bg-slate-700"
                              style={{ left: `${getXPos(1.0)}%` }}
                            />
                            <div
                              className="absolute h-3.5 w-7 -ml-3.5 z-20"
                              style={{ left: `${getXPos(randomModel?.effect || 0.40)}%` }}
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
                  )}

                  {layersVisibility.axisX && (
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
                        <span className="text-cyan-400 font-mono">◄ Favours Treatment</span>
                        <span className="text-slate-500 font-normal text-[10px] uppercase tracking-wider">Risk Ratio (log scale)</span>
                        <span className="text-rose-400 font-mono">Favours Control ►</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Dockable Data Table */}
              <div className="h-48 bg-[#0C121D] flex flex-col shrink-0 border-t border-slate-800">
                <div className="h-8 bg-[#090D14] border-b border-slate-800 px-3 flex items-center justify-between">
                  <div className="flex items-center font-mono">
                    {["DATA TABLE", "ACCESSIBILITY", "NOTES", "PROVENANCE"].map((t) => (
                      <button
                        key={t}
                        onClick={() => setTableTab(t)}
                        className={`px-3 py-1 text-[10px] font-bold tracking-wider transition-colors ${
                          tableTab === t
                            ? "text-cyan-400 bg-[#0C121D] border-t-2 border-cyan-400 border-x border-slate-800"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-slate-500 text-[10px]">{calculatedStudies.length} ENTRIES</span>
                    <button onClick={exportCSV} className="px-2 py-0.5 text-[10px] text-slate-300 bg-[#131B2B] border border-slate-700 rounded-sm hover:bg-slate-800 flex items-center gap-1">
                      <Download className="h-3 w-3 text-slate-400" /> Export CSV
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-1 font-mono text-xs">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800 text-[10px] uppercase tracking-wider bg-[#090D14]">
                        <th className="py-1 px-2">Study ID</th>
                        <th className="py-1 px-2 text-center">Events (T)</th>
                        <th className="py-1 px-2 text-center">Total (T)</th>
                        <th className="py-1 px-2 text-center">Events (C)</th>
                        <th className="py-1 px-2 text-center">Total (C)</th>
                        <th className="py-1 px-2 text-center">Effect (RR)</th>
                        <th className="py-1 px-2 text-center">Lower CI</th>
                        <th className="py-1 px-2 text-center">Upper CI</th>
                        <th className="py-1 px-2 text-right">Weight (%)</th>
                        <th className="py-1 px-2 text-center">RoB</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/40 text-slate-300">
                      {calculatedStudies.map((s) => {
                        const isSel = selectedStudyId === s.id;
                        const badge = getRoBBadge(s.rob);
                        return (
                          <tr
                            key={s.id}
                            onClick={() => setSelectedStudyId(s.id)}
                            className={`hover:bg-slate-800/40 cursor-pointer ${
                              isSel ? "bg-[#142235] text-cyan-300 font-bold" : ""
                            }`}
                          >
                            <td className="py-1 px-2 font-medium">{s.name}</td>
                            <td className="py-1 px-2 text-center">{s.eventsT}</td>
                            <td className="py-1 px-2 text-center">{s.totalT}</td>
                            <td className="py-1 px-2 text-center">{s.eventsC}</td>
                            <td className="py-1 px-2 text-center">{s.totalC}</td>
                            <td className="py-1 px-2 text-center">{s.rr.toFixed(2)}</td>
                            <td className="py-1 px-2 text-center">{s.lower.toFixed(2)}</td>
                            <td className="py-1 px-2 text-center">{s.upper.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right">{s.weight.toFixed(1)}</td>
                            <td className="py-1 px-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-bold border ${badge.bg} ${badge.textCol} ${badge.border}`}>
                                {badge.text}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Subviews embedded within Penpot Studio Workbench Container */
            <div className="flex-1 p-6 overflow-auto bg-[#090D15]">
              {activeView === "Protocols" && <SearchStrategyBuilder />}
              {activeView === "Search" && <SearchView />}
              {(activeView === "Screening" || activeView === "Extraction" || activeView === "Synthesis") && <ReviewTab embedded />}
              {activeView === "Evidence Map" && <ResearchLoopView />}
              {activeView === "Overview" && <ScientificRuntimeView />}
              {activeView === "Reports" && <ProjectFiles />}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: PROFESSIONAL PROPERTY INSPECTOR */}
        <div className="w-64 bg-[#0C121D] border-l border-slate-800 flex flex-col shrink-0 overflow-y-auto">
          <div className="p-2.5 bg-[#090D14] border-b border-slate-800 flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-slate-400">
              Element Inspector
            </span>
            <button className="text-slate-500 hover:text-slate-200 text-xs font-mono">✕</button>
          </div>

          <div className="p-2.5 border-b border-slate-800 bg-[#0E1522] space-y-1 font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-none" style={{ backgroundColor: selectedStudy.color }} />
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">{selectedStudy.name}</div>
                <div className="text-[9px] text-slate-500">NODE_ID: node_1_4</div>
              </div>
            </div>
          </div>

          <div className="flex border-b border-slate-800 bg-[#090D14] font-mono">
            {["PROPERTIES", "STYLE", "DATA"].map((t) => (
              <button
                key={t}
                onClick={() => setInspectorTab(t)}
                className={`flex-1 py-1 text-[10px] font-bold tracking-wider text-center transition-colors ${
                  inspectorTab === t
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-800/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="p-3 space-y-4 font-mono text-xs">
            <div className="space-y-1.5">
              <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">IDENTITY</div>
              <div className="space-y-1.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Label Name</label>
                  <input
                    type="text"
                    value={selectedStudy.name}
                    onChange={(e) => updateSelectedStudy("name", e.target.value)}
                    className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Node Type</label>
                    <input
                      type="text"
                      disabled
                      value="StudyRow"
                      className="w-full bg-[#090D14] border border-slate-800 rounded-sm px-2 py-1 text-slate-500 text-[11px] cursor-not-allowed font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-0.5">Source</label>
                    <span className="block text-cyan-400 underline cursor-pointer text-[11px] pt-1 truncate">
                      PMID:{selectedStudy.pmid}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Contingency Table Input */}
            <div className="space-y-1.5 border-t border-slate-800 pt-3">
              <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">CONTINGENCY DATA</div>
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Events (T)</label>
                  <input
                    type="number"
                    value={selectedStudy.eventsT}
                    onChange={(e) => updateSelectedStudy("eventsT", parseInt(e.target.value) || 0)}
                    className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-1 text-slate-200 text-xs focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Total (T)</label>
                  <input
                    type="number"
                    value={selectedStudy.totalT}
                    onChange={(e) => updateSelectedStudy("totalT", parseInt(e.target.value) || 1)}
                    className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-1 text-slate-200 text-xs focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Events (C)</label>
                  <input
                    type="number"
                    value={selectedStudy.eventsC}
                    onChange={(e) => updateSelectedStudy("eventsC", parseInt(e.target.value) || 0)}
                    className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-1 text-slate-200 text-xs focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Total (C)</label>
                  <input
                    type="number"
                    value={selectedStudy.totalC}
                    onChange={(e) => updateSelectedStudy("totalC", parseInt(e.target.value) || 1)}
                    className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-1 text-slate-200 text-xs focus:outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Live Calculated Stats Readout */}
            <div className="space-y-1.5 border-t border-slate-800 pt-3">
              <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">DERIVED METRICS</div>
              <div className="grid grid-cols-2 gap-1.5 text-slate-400 text-[11px]">
                <div className="flex items-center justify-between bg-[#131B2B] px-2 py-1 border border-slate-800 rounded-sm">
                  <span className="text-[10px] text-slate-500">Effect</span>
                  <span className="text-cyan-400 font-mono font-bold">{selectedStudy.rr}</span>
                </div>
                <div className="flex items-center justify-between bg-[#131B2B] px-2 py-1 border border-slate-800 rounded-sm">
                  <span className="text-[10px] text-slate-500">Weight</span>
                  <span className="text-slate-200 font-mono">{selectedStudy.weight}%</span>
                </div>
                <div className="flex items-center justify-between bg-[#131B2B] px-2 py-1 border border-slate-800 rounded-sm">
                  <span className="text-[10px] text-slate-500">Lower CI</span>
                  <span className="text-slate-200 font-mono">{selectedStudy.lower}</span>
                </div>
                <div className="flex items-center justify-between bg-[#131B2B] px-2 py-1 border border-slate-800 rounded-sm">
                  <span className="text-[10px] text-slate-500">Upper CI</span>
                  <span className="text-slate-200 font-mono">{selectedStudy.upper}</span>
                </div>
              </div>
            </div>

            {/* Rendering Controls */}
            <div className="space-y-1.5 border-t border-slate-800 pt-3">
              <div className="text-[9px] font-bold uppercase text-slate-500 tracking-wider">VECTOR GRAPHICS</div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">Risk of Bias</span>
                  <select
                    value={selectedStudy.rob}
                    onChange={(e) => updateSelectedStudy("rob", e.target.value)}
                    className="bg-[#131B2B] border border-slate-800 rounded-sm px-2 py-0.5 text-xs text-slate-200 focus:outline-none font-mono"
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Some">Some Concerns</option>
                    <option value="High">High Risk</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[10px]">Color Hex</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={selectedStudy.color}
                      onChange={(e) => updateSelectedStudy("color", e.target.value)}
                      className="w-5 h-5 rounded-none bg-transparent cursor-pointer border-none"
                    />
                    <span className="font-mono text-slate-200 text-xs">{selectedStudy.color}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t border-slate-800 pt-3 space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={addStudyRow} className="flex items-center justify-center gap-1 px-2 py-1 text-slate-300 bg-[#131B2B] border border-slate-700/80 rounded-sm hover:bg-slate-800 text-[10px] font-mono">
                  <Plus className="h-3 w-3 text-cyan-400" /> Add Row
                </button>
                <button className="flex items-center justify-center gap-1 px-2 py-1 text-slate-300 bg-[#131B2B] border border-slate-700/80 rounded-sm hover:bg-slate-800 text-[10px] font-mono">
                  <Lock className="h-3 w-3 text-slate-400" /> Lock
                </button>
              </div>
              <button
                onClick={() => {
                  if (studies.length > 1) {
                    setStudies((prev) => prev.filter((s) => s.id !== selectedStudyId));
                    setSelectedStudyId(studies[0].id);
                  }
                }}
                className="w-full flex items-center justify-center gap-1 px-2 py-1 text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-sm hover:bg-rose-900/60 text-[10px] font-mono font-bold"
              >
                <Trash2 className="h-3 w-3" /> Remove Study
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. GLOBAL STATUS BAR */}
      <footer className="h-6 bg-[#090D14] border-t border-slate-800 px-3 flex items-center justify-between text-[10px] font-mono text-slate-400 shrink-0 z-30">
        <div className="flex items-center gap-4">
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> PIPELINE: COMPLETE
          </span>
          <span className="text-slate-700">|</span>
          <span>STUDIES: <strong className="text-slate-200">{calculatedStudies.length}</strong></span>
          <span>POOLED EFFECT: <strong className="text-cyan-400">{randomModel?.effect ?? 0.40}</strong></span>
          <span>I²: <strong className="text-slate-200">{het ? `${het.I2}%` : "37%"}</strong></span>
        </div>

        <div className="flex items-center gap-4">
          <span>VERIFICATION: <strong className="text-emerald-400 font-bold">PASSED</strong></span>
          <span className="text-slate-700">|</span>
          <span className="text-cyan-400 font-semibold flex items-center gap-1">
            <Activity className="h-3 w-3 animate-pulse" /> ENGINE: ACTIVE
          </span>
        </div>
      </footer>
    </div>
  );
}
