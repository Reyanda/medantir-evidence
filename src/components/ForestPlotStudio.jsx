import React, { useState } from "react";
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
  RotateCcw,
  Sliders,
  Maximize2,
  Grid,
  Sun,
  Moon,
  Plus,
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
  Settings,
  Shield,
  Zap,
  Globe,
  Tag
} from "lucide-react";

export default function ForestPlotStudio({
  activeView = "Figures",
  setActiveView = () => {},
  activeTab = "VISUALIZE",
  setActiveTab = () => {}
}) {
  // Study Data State initialized matching exact benchmark data
  const [studies, setStudies] = useState([
    { id: "CORIMUNO-19", name: "CORIMUNO-19", eventsT: 3, totalT: 128, eventsC: 13, totalC: 130, rr: 0.23, lower: 0.07, upper: 0.74, weight: 8.7, rob: "Low", pmid: "32871097", shape: "Square", color: "#20C997" },
    { id: "SAVE-MORE", name: "SAVE-MORE", eventsT: 5, totalT: 180, eventsC: 12, totalC: 178, rr: 0.40, lower: 0.16, upper: 0.98, weight: 11.4, rob: "Low", pmid: "32871098", shape: "Square", color: "#20C997" },
    { id: "RCT-Szabo", name: "RCT-Szabo", eventsT: 2, totalT: 96, eventsC: 9, totalC: 94, rr: 0.22, lower: 0.05, upper: 0.92, weight: 6.1, rob: "Some", pmid: "32871099", shape: "Square", color: "#FCC419" },
    { id: "BACC Bay", name: "BACC Bay", eventsT: 6, totalT: 224, eventsC: 20, totalC: 219, rr: 0.30, lower: 0.13, upper: 0.71, weight: 12.3, rob: "Low", pmid: "32871100", shape: "Square", color: "#20C997" },
    { id: "JAK-COVID", name: "JAK-COVID", eventsT: 10, totalT: 211, eventsC: 20, totalC: 210, rr: 0.50, lower: 0.25, upper: 1.00, weight: 15.7, rob: "Low", pmid: "32871101", shape: "Square", color: "#20C997" },
    { id: "COVID STEROID 2", name: "COVID STEROID 2", eventsT: 8, totalT: 150, eventsC: 14, totalC: 150, rr: 0.57, lower: 0.24, upper: 1.35, weight: 13.1, rob: "Some", pmid: "32871102", shape: "Square", color: "#FCC419" },
    { id: "GLIMMER", name: "GLIMMER", eventsT: 4, totalT: 95, eventsC: 9, totalC: 95, rr: 0.44, lower: 0.14, upper: 1.38, weight: 8.8, rob: "Low", pmid: "32871103", shape: "Square", color: "#20C997" },
    { id: "FLARE", name: "FLARE", eventsT: 7, totalT: 118, eventsC: 12, totalC: 118, rr: 0.58, lower: 0.23, upper: 1.46, weight: 12.0, rob: "Low", pmid: "32871104", shape: "Square", color: "#20C997" },
    { id: "VENTILATE-JAK", name: "VENTILATE-JAK", eventsT: 3, totalT: 87, eventsC: 8, totalC: 87, rr: 0.38, lower: 0.10, upper: 1.44, weight: 7.9, rob: "High", pmid: "32871105", shape: "Square", color: "#FF6B6B" }
  ]);

  // Selected Study ID for Element Inspector
  const [selectedStudyId, setSelectedStudyId] = useState("SAVE-MORE");
  const selectedStudy = studies.find((s) => s.id === selectedStudyId) || studies[1];

  // Data Table Active Sub-tab
  const [tableTab, setTableTab] = useState("DATA TABLE");
  const [inspectorTab, setInspectorTab] = useState("PROPERTIES");

  // Scene Graph Layers Visibility State
  const [layersVisibility, setLayersVisibility] = useState({
    title: true,
    subtitle: true,
    layoutGrid: true,
    axisX: true,
    axisY: true,
    nullLine: true,
    studies: true,
    summary: true,
    favoursText: true,
    legend: true
  });

  // Scene Graph Layer Search Filter
  const [layerSearch, setLayerSearch] = useState("");

  const toggleLayer = (layerKey) => {
    setLayersVisibility((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  // Helper for updating selected study properties in real-time
  const updateSelectedStudy = (field, value) => {
    setStudies((prev) =>
      prev.map((s) => (s.id === selectedStudyId ? { ...s, [field]: value } : s))
    );
  };

  // RoB Badge Color Map
  const getRoBBadge = (rob) => {
    switch (rob) {
      case "Low":
        return { text: "Low", bg: "bg-emerald-500/10", border: "border-emerald-500/30", color: "text-emerald-400", dot: "bg-emerald-400" };
      case "Some":
        return { text: "Some", bg: "bg-amber-500/10", border: "border-amber-500/30", color: "text-amber-400", dot: "bg-amber-400" };
      case "High":
        return { text: "High", bg: "bg-rose-500/10", border: "border-rose-500/30", color: "text-rose-400", dot: "bg-rose-400" };
      default:
        return { text: rob, bg: "bg-slate-500/10", border: "border-slate-500/30", color: "text-slate-400", dot: "bg-slate-400" };
    }
  };

  // Log scale conversion function (mapping log(0.05) to log(10) to 0-100% SVG width)
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
    <div className="flex flex-col h-screen w-screen bg-[#0E1B28] text-slate-100 font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* 1. TOP HEADER BAR                                                         */}
      {/* ========================================================================= */}
      <header className="h-14 bg-[#0A1622] border-b border-slate-800 flex items-center justify-between px-4 z-20 shrink-0">
        {/* Left: Brand & Review Title */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400 font-black text-sm tracking-wider shadow-[0_0_12px_rgba(0,242,254,0.15)]">
              ◆
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-extrabold tracking-widest text-white text-base">MEDANTIR</span>
              <span className="text-[10px] text-cyan-400/80 font-medium tracking-wide">Evidence. Engineered.</span>
            </div>
          </div>

          <div className="h-5 w-[1px] bg-slate-800 mx-1" />

          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-white tracking-tight">JAK Inhibitors in COVID-19</h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              Living Review
            </span>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px]">Last saved 2 min ago • Auto-saved</span>
            </div>
          </div>
        </div>

        {/* Center: Mode Tabs */}
        <div className="flex items-center gap-1 bg-[#0E1B28] p-1 rounded-lg border border-slate-800">
          {["BUILD", "ANALYZE", "SYNTHESIZE", "VISUALIZE", "PUBLISH"].map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 text-xs font-semibold rounded tracking-wider transition-all relative ${
                  isActive
                    ? "text-white bg-[#121F2C] shadow-sm border border-slate-700/60"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                }`}
              >
                {tab}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-cyan-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Search, Actions, Profile */}
        <div className="flex items-center gap-3">
          <div className="relative w-52">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search across project..."
              className="w-full bg-[#121F2C] border border-slate-800 rounded-md pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <button className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
            <HelpCircle className="h-4 w-4" />
          </button>
          <button className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors relative">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-cyan-400 rounded-full" />
          </button>

          <div className="h-7 w-7 rounded-full bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-xs font-bold text-indigo-300">
            MA
          </div>

          <button className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#121F2C] border border-slate-700/70 rounded hover:bg-slate-800 transition-colors">
            <Share2 className="h-3.5 w-3.5 text-slate-400" />
            Share
          </button>

          <button className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-300 bg-[#121F2C] border border-slate-700/70 rounded hover:bg-slate-800 transition-colors">
            Export <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>

          <button className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 rounded shadow-md shadow-cyan-500/20 hover:brightness-110 active:scale-95 transition-all">
            <Play className="h-3.5 w-3.5 fill-slate-950" />
            Run Pipeline
          </button>
        </div>
      </header>

      {/* Sub-header Breadcrumb Bar */}
      <div className="h-8 bg-[#0E1B28] border-b border-slate-800/80 px-4 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">FIGURES</span>
          <span className="text-slate-600">/</span>
          <span className="text-white font-medium flex items-center gap-1">
            Forest Plot - Mortality (28d) <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span>Zoom: <strong className="text-white">100%</strong></span>
          <span className="text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Synthesis Engine Ready
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN 3-COLUMN STUDIO LAYOUT                                            */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden">
        {/* ----------------------------------------------------------------------- */}
        {/* LEFT COLUMN: WORKSPACE SIDEBAR & SCENE GRAPH                           */}
        {/* ----------------------------------------------------------------------- */}
        <div className="w-64 bg-[#0A1622] border-r border-slate-800 flex flex-col shrink-0 select-none">
          {/* Workspace Nav Section */}
          <div className="p-3 border-b border-slate-800/80 space-y-1">
            <div className="text-[10px] font-bold tracking-wider text-slate-500 uppercase px-2 mb-1">Workspace</div>
            {[
              { label: "Overview", icon: Layers, view: "Overview" },
              { label: "Protocols", icon: FileText, view: "Protocols" },
              { label: "Search", icon: Search, view: "Search" },
              { label: "Screening", icon: Filter, view: "Screening" },
              { label: "Extraction", icon: Database, view: "Extraction" },
              { label: "Synthesis", icon: Zap, view: "Synthesis" },
              { label: "Evidence Map", icon: Compass, view: "Evidence Map" },
              { label: "Figures", icon: BarChart2, view: "Figures" },
              { label: "Reports", icon: FileText, view: "Reports" }
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.view;
              return (
                <button
                  key={item.label}
                  onClick={() => setActiveView(item.view)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-semibold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? "text-cyan-400" : "text-slate-500"}`} />
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Scene Graph / Layers Tree */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="p-3 pb-2 border-b border-slate-800/60 flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">Scene Graph</span>
              <button className="text-[10px] text-cyan-400 hover:underline">Reset</button>
            </div>

            <div className="p-2 border-b border-slate-800/60">
              <div className="relative">
                <Search className="absolute left-2 top-2 h-3 w-3 text-slate-500" />
                <input
                  type="text"
                  value={layerSearch}
                  onChange={(e) => setLayerSearch(e.target.value)}
                  placeholder="Search layers..."
                  className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 pl-7 py-1 text-[11px] text-slate-300 placeholder-slate-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
              <div className="text-slate-300 font-semibold flex items-center justify-between py-1 px-1">
                <span>▾ Figure: forest-plot-mortality</span>
              </div>

              {/* Sub-group Canvas */}
              <div className="pl-3 space-y-0.5 border-l border-slate-800 ml-2">
                <div className="text-slate-400 flex items-center justify-between py-0.5 px-1 hover:bg-slate-800/30 rounded">
                  <span className="text-[11px]">▾ Canvas</span>
                </div>
                <div className="pl-3 space-y-0.5">
                  <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                    <span className="text-[11px]">Title</span>
                    <button onClick={() => toggleLayer("title")}>
                      {layersVisibility.title ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                    <span className="text-[11px]">Subtitle</span>
                    <button onClick={() => toggleLayer("subtitle")}>
                      {layersVisibility.subtitle ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                    <span className="text-[11px]">Layout Grid</span>
                    <button onClick={() => toggleLayer("layoutGrid")}>
                      {layersVisibility.layoutGrid ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Sub-group Plot Area */}
              <div className="pl-3 space-y-0.5 border-l border-slate-800 ml-2 mt-1">
                <div className="text-slate-400 flex items-center justify-between py-0.5 px-1 hover:bg-slate-800/30 rounded">
                  <span className="text-[11px]">▾ Plot Area</span>
                </div>
                <div className="pl-3 space-y-0.5">
                  <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                    <span className="text-[11px]">Axis X (Risk Ratio)</span>
                    <button onClick={() => toggleLayer("axisX")}>
                      {layersVisibility.axisX ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                    <span className="text-[11px]">Null Line (1.0)</span>
                    <button onClick={() => toggleLayer("nullLine")}>
                      {layersVisibility.nullLine ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Sub-group Studies */}
              <div className="pl-3 space-y-0.5 border-l border-slate-800 ml-2 mt-1">
                <div className="text-slate-400 flex items-center justify-between py-0.5 px-1 hover:bg-slate-800/30 rounded">
                  <span className="text-[11px]">▾ Studies ({studies.length})</span>
                  <button onClick={() => toggleLayer("studies")}>
                    {layersVisibility.studies ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                  </button>
                </div>
                <div className="pl-3 space-y-0.5 max-h-36 overflow-y-auto">
                  {studies.map((study) => (
                    <div
                      key={study.id}
                      onClick={() => setSelectedStudyId(study.id)}
                      className={`flex items-center justify-between py-0.5 px-1 rounded cursor-pointer ${
                        selectedStudyId === study.id
                          ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                          : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
                      }`}
                    >
                      <span className="text-[10px] truncate">Study Row - {study.name}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: study.color }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Sub-group Summary */}
              <div className="pl-3 space-y-0.5 border-l border-slate-800 ml-2 mt-1">
                <div className="flex items-center justify-between py-0.5 text-slate-400 hover:text-slate-200">
                  <span className="text-[11px]">▾ Diamond (Pooled)</span>
                  <button onClick={() => toggleLayer("summary")}>
                    {layersVisibility.summary ? <Eye className="h-3 w-3 text-cyan-400" /> : <EyeOff className="h-3 w-3 text-slate-600" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* System Status Panel (Bottom of Sidebar) */}
          <div className="p-3 border-t border-slate-800/80 bg-[#07131E] space-y-2 shrink-0 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Status</span>
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Operational
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-[#0A1622] p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">Active Tasks</div>
                <div className="text-white font-bold">3</div>
              </div>
              <div className="bg-[#0A1622] p-1.5 rounded border border-slate-800">
                <div className="text-slate-500 text-[10px]">Evidence Objects</div>
                <div className="text-cyan-400 font-bold">1,248</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1 flex items-center justify-between">
              <span>MEDANTIR v1.0.0</span>
              <span>5 min ago</span>
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------------------------- */}
        {/* CENTER COLUMN: CANVAS TOOLBAR, FOREST PLOT SVG, DATA TABLE SPLIT VIEW   */}
        {/* ----------------------------------------------------------------------- */}
        <div className="flex-1 flex flex-col bg-[#0E1B28] min-w-0 overflow-hidden">
          {/* Canvas Top Toolbar */}
          <div className="h-10 bg-[#0A1622] border-b border-slate-800 px-4 flex items-center justify-between text-xs shrink-0 select-none">
            <div className="flex items-center gap-1">
              {["Select", "Pan", "Zoom", "Measure", "Annotate", "Text", "Shape", "Link"].map((tool, idx) => (
                <button
                  key={tool}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    idx === 0
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
                  }`}
                >
                  {tool}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-slate-400">
              <button className="p-1 hover:text-white rounded hover:bg-slate-800">
                <Grid className="h-3.5 w-3.5" />
              </button>
              <button className="p-1 hover:text-white rounded hover:bg-slate-800">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <div className="h-4 w-[1px] bg-slate-800" />
              <button className="p-1 hover:text-white rounded hover:bg-slate-800">
                <Sun className="h-3.5 w-3.5" />
              </button>
              <button className="p-1 text-cyan-400 rounded bg-slate-800/60">
                <Moon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Center Split 1: Forest Plot Interactive Canvas */}
          <div className="flex-1 bg-[#0A1622] p-6 overflow-auto flex flex-col items-center justify-start border-b border-slate-800 relative">
            <div className="w-full max-w-4xl bg-[#0E1B28] rounded-xl border border-slate-800/80 p-6 shadow-2xl space-y-6">
              {/* Forest Plot Header */}
              {layersVisibility.title && (
                <div className="text-center space-y-1">
                  <h2 className="text-lg font-bold text-white tracking-tight">All-cause Mortality (28-day)</h2>
                  {layersVisibility.subtitle && (
                    <p className="text-xs text-slate-400">Random-effects (DerSimonian–Laird)</p>
                  )}
                  <div className="flex items-center justify-center gap-6 text-xs text-slate-400 pt-1">
                    <span className="font-semibold text-cyan-400">Risk Ratio (RR)</span>
                    <span>I² = 37%</span>
                    <span>Q = 12.6 (df = 8, p = 0.13)</span>
                  </div>
                </div>
              )}

              {/* Table Column Headers */}
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-400 border-b border-slate-800 pb-2 px-2">
                <div className="col-span-3">Study</div>
                <div className="col-span-1 text-center">Events</div>
                <div className="col-span-1 text-center">Total</div>
                <div className="col-span-5 text-center">Risk Ratio IV, Random, 95% CI</div>
                <div className="col-span-1 text-right">Weight (%)</div>
                <div className="col-span-1 text-center">RoB</div>
              </div>

              {/* Study Rows */}
              {layersVisibility.studies && (
                <div className="space-y-2">
                  {studies.map((study) => {
                    const isSelected = selectedStudyId === study.id;
                    const leftPos = getXPos(study.lower);
                    const rightPos = getXPos(study.upper);
                    const pointPos = getXPos(study.rr);
                    const robBadge = getRoBBadge(study.rob);

                    return (
                      <div
                        key={study.id}
                        onClick={() => setSelectedStudyId(study.id)}
                        className={`grid grid-cols-12 gap-2 items-center text-xs py-1.5 px-2 rounded-lg transition-all cursor-pointer ${
                          isSelected
                            ? "bg-cyan-500/15 border border-cyan-500/40 shadow-sm"
                            : "hover:bg-slate-800/30 border border-transparent"
                        }`}
                      >
                        <div className="col-span-3 font-medium text-white truncate flex items-center gap-2">
                          {study.name}
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                        </div>
                        <div className="col-span-1 text-center text-slate-300">{study.eventsT}</div>
                        <div className="col-span-1 text-center text-slate-400">{study.totalT}</div>

                        {/* Forest Plot CI Bar SVG */}
                        <div className="col-span-5 relative h-6 flex items-center px-2">
                          <div className="w-full relative h-full flex items-center">
                            {/* Null Line (RR=1.0) */}
                            {layersVisibility.nullLine && (
                              <div
                                className="absolute top-0 bottom-0 w-[1px] bg-slate-600/70 z-0"
                                style={{ left: `${getXPos(1.0)}%` }}
                              />
                            )}

                            {/* CI Horizontal Bar */}
                            <div
                              className="absolute h-[2px] bg-slate-300 rounded-full z-10"
                              style={{
                                left: `${leftPos}%`,
                                width: `${Math.max(2, rightPos - leftPos)}%`
                              }}
                            />

                            {/* Point Estimate Square */}
                            <div
                              className="absolute w-3 h-3 -ml-1.5 rounded-sm z-20 shadow"
                              style={{
                                left: `${pointPos}%`,
                                backgroundColor: study.color
                              }}
                            />
                          </div>
                        </div>

                        <div className="col-span-1 text-right font-mono text-slate-300">{study.weight.toFixed(1)}</div>
                        <div className="col-span-1 flex justify-center">
                          <span className={`w-2.5 h-2.5 rounded-full ${robBadge.dot}`} title={`Risk of Bias: ${study.rob}`} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pooled Summary Row */}
              {layersVisibility.summary && (
                <div className="border-t border-slate-700 pt-3">
                  <div className="grid grid-cols-12 gap-2 items-center text-xs font-bold text-white px-2">
                    <div className="col-span-3">Total (95% CI)</div>
                    <div className="col-span-1 text-center">48</div>
                    <div className="col-span-1 text-center">1,289</div>

                    {/* Summary Diamond SVG */}
                    <div className="col-span-5 relative h-6 flex items-center px-2">
                      <div className="w-full relative h-full flex items-center">
                        <div
                          className="absolute top-0 bottom-0 w-[1px] bg-slate-600/70"
                          style={{ left: `${getXPos(1.0)}%` }}
                        />
                        <div
                          className="absolute h-4 w-8 -ml-4 z-20"
                          style={{ left: `${getXPos(0.40)}%` }}
                        >
                          <svg viewBox="0 0 32 16" className="w-full h-full fill-amber-200/40 stroke-amber-400 stroke-2">
                            <polygon points="0,8 16,0 32,8 16,16" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    <div className="col-span-1 text-right font-mono text-cyan-400">100.0</div>
                    <div className="col-span-1" />
                  </div>
                </div>
              )}

              {/* Axis Log Scale & Annotations */}
              {layersVisibility.axisX && (
                <div className="pt-2 border-t border-slate-800/60 space-y-2">
                  <div className="relative h-6 text-[10px] text-slate-400 font-mono">
                    {[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0].map((val) => (
                      <div
                        key={val}
                        className="absolute transform -translate-x-1/2 flex flex-col items-center"
                        style={{ left: `${getXPos(val)}%` }}
                      >
                        <div className="h-1.5 w-[1px] bg-slate-600 mb-0.5" />
                        <span>{val}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-xs font-semibold px-4 pt-1">
                    <span className="text-cyan-400">◄ Favours Treatment</span>
                    <span className="text-slate-500 font-normal text-[11px]">Risk Ratio (log scale)</span>
                    <span className="text-rose-400">Favours Control ►</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center Split 2: Bottom Tabbed Data Table */}
          <div className="h-56 bg-[#0A1622] flex flex-col shrink-0 select-none">
            <div className="h-9 bg-[#0E1B28] border-b border-slate-800 px-4 flex items-center justify-between">
              <div className="flex items-center gap-1">
                {["DATA TABLE", "ACCESSIBILITY", "NOTES", "PROVENANCE"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTableTab(tab)}
                    className={`px-3 py-1 text-[11px] font-semibold rounded tracking-wider transition-colors ${
                      tableTab === tab
                        ? "text-cyan-400 bg-[#0A1622] border-t border-x border-slate-800"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">{studies.length} rows</span>
                <button className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-300 bg-[#121F2C] border border-slate-700 rounded hover:bg-slate-800">
                  <Download className="h-3 w-3 text-slate-400" /> Export CSV
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800 text-[11px]">
                    <th className="py-1.5 px-3">Study ID</th>
                    <th className="py-1.5 px-2 text-center">Events (T)</th>
                    <th className="py-1.5 px-2 text-center">Total (T)</th>
                    <th className="py-1.5 px-2 text-center">Events (C)</th>
                    <th className="py-1.5 px-2 text-center">Total (C)</th>
                    <th className="py-1.5 px-2 text-center">Risk Ratio</th>
                    <th className="py-1.5 px-2 text-center">Lower CI</th>
                    <th className="py-1.5 px-2 text-center">Upper CI</th>
                    <th className="py-1.5 px-2 text-right">Weight (%)</th>
                    <th className="py-1.5 px-3 text-center">RoB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50 text-slate-300">
                  {studies.map((s) => {
                    const isSelected = selectedStudyId === s.id;
                    const badge = getRoBBadge(s.rob);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedStudyId(s.id)}
                        className={`hover:bg-slate-800/40 cursor-pointer transition-colors ${
                          isSelected ? "bg-cyan-500/10 font-semibold text-white" : ""
                        }`}
                      >
                        <td className="py-1.5 px-3 font-medium">{s.name}</td>
                        <td className="py-1.5 px-2 text-center">{s.eventsT}</td>
                        <td className="py-1.5 px-2 text-center">{s.totalT}</td>
                        <td className="py-1.5 px-2 text-center">{s.eventsC}</td>
                        <td className="py-1.5 px-2 text-center">{s.totalC}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{s.rr.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{s.lower.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{s.upper.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{s.weight.toFixed(1)}</td>
                        <td className="py-1.5 px-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${badge.bg} ${badge.color} ${badge.border}`}>
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
        </div>

        {/* ----------------------------------------------------------------------- */}
        {/* RIGHT COLUMN: ELEMENT INSPECTOR                                        */}
        {/* ----------------------------------------------------------------------- */}
        <div className="w-72 bg-[#0A1622] border-l border-slate-800 flex flex-col shrink-0 overflow-y-auto select-none">
          {/* Header */}
          <div className="p-3 border-b border-slate-800 flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wider uppercase text-slate-400">Element Inspector</span>
            <button className="text-slate-500 hover:text-white text-xs">✕</button>
          </div>

          {/* Active Node Info */}
          <div className="p-3 border-b border-slate-800/80 bg-[#0E1B28]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: selectedStudy.color }} />
              <div>
                <div className="text-xs font-bold text-white">Study Row - {selectedStudy.name}</div>
                <div className="text-[10px] text-slate-500 font-mono">ID: node_1_4</div>
              </div>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex border-b border-slate-800 bg-[#0A1622]">
            {["PROPERTIES", "STYLE", "DATA"].map((t) => (
              <button
                key={t}
                onClick={() => setInspectorTab(t)}
                className={`flex-1 py-1.5 text-[11px] font-semibold tracking-wider text-center transition-colors ${
                  inspectorTab === t
                    ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-800/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Inspector Form Sections */}
          <div className="p-3 space-y-4 text-xs">
            {/* Identity Group */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Identity</div>
              <div className="space-y-1.5">
                <div>
                  <label className="text-[10px] text-slate-400">Label</label>
                  <input
                    type="text"
                    value={selectedStudy.name}
                    onChange={(e) => updateSelectedStudy("name", e.target.value)}
                    className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400">Type</label>
                    <input
                      type="text"
                      disabled
                      value="StudyRow"
                      className="w-full bg-[#0E1B28] border border-slate-800 rounded px-2 py-1 text-slate-500 text-xs cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400">Source</label>
                    <span className="block text-cyan-400 underline cursor-pointer text-xs pt-1 truncate">
                      PMID: {selectedStudy.pmid}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Geometry Group */}
            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Geometry</div>
              <div className="grid grid-cols-2 gap-2 text-slate-400">
                <div className="flex items-center justify-between bg-[#121F2C] p-1.5 rounded border border-slate-800">
                  <span className="text-[10px]">X</span>
                  <span className="text-white font-mono">120.5</span>
                </div>
                <div className="flex items-center justify-between bg-[#121F2C] p-1.5 rounded border border-slate-800">
                  <span className="text-[10px]">Y</span>
                  <span className="text-white font-mono">184.2</span>
                </div>
                <div className="flex items-center justify-between bg-[#121F2C] p-1.5 rounded border border-slate-800">
                  <span className="text-[10px]">Width</span>
                  <span className="text-white font-mono">742.0</span>
                </div>
                <div className="flex items-center justify-between bg-[#121F2C] p-1.5 rounded border border-slate-800">
                  <span className="text-[10px]">Height</span>
                  <span className="text-white font-mono">24.0</span>
                </div>
              </div>
            </div>

            {/* Data Binding Group */}
            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Data Binding</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400">Estimate (RR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedStudy.rr}
                    onChange={(e) => updateSelectedStudy("rr", parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Weight (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedStudy.weight}
                    onChange={(e) => updateSelectedStudy("weight", parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Lower CI</label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedStudy.lower}
                    onChange={(e) => updateSelectedStudy("lower", parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400">Upper CI</label>
                  <input
                    type="number"
                    step="0.01"
                    value={selectedStudy.upper}
                    onChange={(e) => updateSelectedStudy("upper", parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Rendering Group */}
            <div className="space-y-2 border-t border-slate-800/80 pt-3">
              <div className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Rendering</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Marker Shape</span>
                  <select
                    value={selectedStudy.shape}
                    onChange={(e) => updateSelectedStudy("shape", e.target.value)}
                    className="bg-[#121F2C] border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
                  >
                    <option value="Square">Square</option>
                    <option value="Circle">Circle</option>
                    <option value="Diamond">Diamond</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Color</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedStudy.color}
                      onChange={(e) => updateSelectedStudy("color", e.target.value)}
                      className="w-6 h-6 rounded bg-transparent cursor-pointer border-none"
                    />
                    <span className="font-mono text-slate-300 text-xs uppercase">{selectedStudy.color}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="border-t border-slate-800/80 pt-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button className="flex items-center justify-center gap-1 px-2.5 py-1.5 text-slate-300 bg-[#121F2C] border border-slate-700/60 rounded hover:bg-slate-800 text-xs">
                  <Copy className="h-3 w-3 text-slate-400" /> Duplicate
                </button>
                <button className="flex items-center justify-center gap-1 px-2.5 py-1.5 text-slate-300 bg-[#121F2C] border border-slate-700/60 rounded hover:bg-slate-800 text-xs">
                  <Lock className="h-3 w-3 text-slate-400" /> Lock
                </button>
              </div>
              <button className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded hover:bg-rose-500/20 text-xs font-semibold">
                <Trash2 className="h-3.5 w-3.5" /> Delete Element
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. GLOBAL STATUS FOOTER BAR                                               */}
      {/* ========================================================================= */}
      <footer className="h-7 bg-[#07131E] border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-400 z-20 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-emerald-400 font-semibold flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Pipeline: Complete
          </span>
          <span className="text-slate-600">|</span>
          <span>Evidence Objects: <strong className="text-white">1,248</strong></span>
          <span>Studies: <strong className="text-white">142</strong></span>
          <span>Outcomes: <strong className="text-white">28</strong></span>
          <span>Figures: <strong className="text-white">18</strong></span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-slate-300">Verification: <strong className="text-emerald-400">Passed</strong></span>
          <span className="text-slate-600">|</span>
          <span className="text-cyan-400 font-medium flex items-center gap-1">
            <Activity className="h-3 w-3 animate-pulse" /> Cognitive Runtime: Active
          </span>
        </div>
      </footer>
    </div>
  );
}
