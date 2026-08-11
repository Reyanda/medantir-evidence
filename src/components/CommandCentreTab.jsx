import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Activity, ClipboardCheck, Crosshair, GitBranch, Globe2, Radar, Sparkles, Zap } from "lucide-react";
import { activeProject, getCanvasComposition, getProject, listProjects, setActiveProject } from "../engine/projectstore.js";
import { defaultMode, getOperatingMode, resolveProjectMode } from "../engine/operatingModes.js";
import { commandCentreDefaultView, commandCentreViews } from "../engine/navigation.js";
import DashboardTab from "./DashboardTab.jsx";
import DecisionTab from "./DecisionTab.jsx";
import { TabSkeleton } from "./Skeleton.jsx";

const CanvasView = lazy(() => import("./CanvasTab.jsx").then((module) => ({ default: module.CanvasView })));

const VIEW_META = {
  summary: ["Summary", Crosshair],
  canvas: ["Canvas", Sparkles],
  map: ["Map", Globe2],
  evidence: ["Signals", Radar],
  scenarios: ["Scenarios", GitBranch],
  actions: ["Actions", Zap],
  audit: ["Audit", ClipboardCheck],
};

function initialView(modeId) {
  const allowed = commandCentreViews(modeId);
  try {
    const requested = sessionStorage.getItem("medantir.command-centre.initial-view");
    sessionStorage.removeItem("medantir.command-centre.initial-view");
    if (allowed.includes(requested)) return requested;
  } catch { /* storage unavailable */ }
  return commandCentreDefaultView(modeId);
}

export default function CommandCentreTab({ setActiveTab, effectiveMode, scope, onDirtyChange }) {
  const modeId = effectiveMode || defaultMode();
  const projects = useMemo(() => listProjects().filter((project) => resolveProjectMode(project) === modeId), [modeId]);
  const active = activeProject();
  const initialProject = projects.some((project) => project.id === active) ? active : projects[0]?.id || "";
  const [projectId, setProjectId] = useState(initialProject);
  const [view, setView] = useState(() => initialView(modeId));
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [pendingPanel, setPendingPanel] = useState(null);
  const project = projectId ? getProject(projectId) : null;
  const projectModeId = project ? resolveProjectMode(project) : modeId;
  const mode = getOperatingMode(projectModeId);
  const allowedViews = commandCentreViews(modeId);
  const canvasAudit = projectId ? getCanvasComposition(projectId).audit : [];

  useEffect(() => {
    if (!allowedViews.includes(view)) setView(commandCentreDefaultView(modeId));
    if (projectId && !projects.some((item) => item.id === projectId)) {
      const next = projects[0]?.id || "";
      setProjectId(next);
      setActiveProject(next);
      setCanvasDirty(false);
      onDirtyChange?.(false);
    }
  }, [allowedViews, modeId, onDirtyChange, projectId, projects, view]);

  const allowDiscard = () => !canvasDirty || window.confirm("Discard unsaved Canvas changes?");
  const chooseProject = (id) => {
    if (id === projectId || !allowDiscard()) return;
    setProjectId(id);
    setActiveProject(id);
    setCanvasDirty(false);
    onDirtyChange?.(false);
    setPendingPanel(null);
  };
  const chooseView = (id) => {
    if (id === view) return;
    if (view === "canvas" && !allowDiscard()) return;
    setView(id);
    if (view === "canvas") { setCanvasDirty(false); onDirtyChange?.(false); }
  };
  const addToCanvas = (panel) => {
    setPendingPanel({ ...panel, requestId: `${Date.now()}-${Math.random()}` });
    setView("canvas");
  };
  const updateDirty = (value) => {
    setCanvasDirty(value);
    onDirtyChange?.(value);
  };

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title"><Crosshair className="h-5 w-5" /> Command Centre</h1>
          <p className="ui-subtitle">Project-level decisions, evidence signals, scenarios, actions, and audit in one controlled workspace.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono font-bold uppercase px-2 py-1 rounded-md border" style={{ color: mode.color, borderColor: `${mode.color}66`, background: `${mode.color}12` }}>{mode.name} mode</span>
          <select value={projectId} onChange={(event) => chooseProject(event.target.value)} aria-label="Command Centre project" className="text-xs px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
            <option value="">No project selected</option>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
      </div>

      <div className="ui-tabs" role="tablist" aria-label="Command Centre views">
        {allowedViews.map((id) => {
          const [label, Icon] = VIEW_META[id];
          return <button key={id} role="tab" aria-selected={view === id} onClick={() => chooseView(id)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md" style={view === id ? { background: "var(--color-bg-elevated)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}><Icon className="h-3.5 w-3.5" /> {label}{id === "canvas" && canvasDirty ? " •" : ""}</button>;
        })}
      </div>

      {view === "canvas" ? (
        <Suspense fallback={<TabSkeleton />}>
          <CanvasView projectId={projectId} modeId={modeId} scope={scope} pendingPanel={pendingPanel} onPendingPanelConsumed={() => setPendingPanel(null)} onDirtyChange={updateDirty} />
        </Suspense>
      ) : view === "map" ? <DashboardTab embedded /> : (
        <DecisionTab embedded section={view} mode={modeId} setActiveTab={setActiveTab} onAddToCanvas={addToCanvas} canvasAudit={canvasAudit} />
      )}

      <div className="flex items-start gap-2 ui-panel text-[11px] text-zinc-500">
        <Activity className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: mode.color }} />
        <span>{mode.description} Project files, visual compositions, signals, and recommendations remain filtered by this mode and the account's clearance.</span>
      </div>
    </div>
  );
}
