import React, { useEffect, useRef, useState } from "react";
import { BarChart3, Bot, Briefcase, GitBranch, Globe, Loader2, PanelRightClose, PanelRightOpen, RefreshCw, Terminal } from "lucide-react";
import { PROFILES } from "../engine/session.js";
import { getOperatingMode } from "../engine/operatingModes.js";
import { getRightPaneTab, onRightPaneTab, selectRightPaneTab } from "../engine/browserBus.js";
import { activeProject, getProject, onActiveProject } from "../engine/projectstore.js";
import { getAgentStream, getProjectTranscript, onAgentStream, onProjectTranscript } from "../engine/agentTranscript.js";
import { inspectProjectGit } from "../engine/projectGit.js";
import { CompanionDockButton } from "./OperatorCompanion.jsx";
// Charts pull in echarts, so the plot surface loads only when its tab is opened.
const PlotTool = React.lazy(() => import("./PlotTool.jsx"));
const OfficeTool = React.lazy(() => import("./OfficeTool.jsx"));

const BrowserTool = React.lazy(() => import("./BrowserTab.jsx"));
const TerminalTool = React.lazy(() => import("./TerminalTool.jsx"));

const clampWidth = (value) => Math.min(720, Math.max(320, Number(value) || 384));
const loadWidth = () => {
  try { return clampWidth(localStorage.getItem("medantir.right-pane.width")); } catch { return 384; }
};
const loadCollapsed = () => {
  try {
    const stored = localStorage.getItem("medantir.right-pane.collapsed");
    if (stored !== null) return stored === "true";
  } catch { return true; }
  return true;
};

export default function RightPane({ profile, effectiveMode }) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [width, setWidth] = useState(loadWidth);
  const [paneTab, setPaneTab] = useState(getRightPaneTab);
  const [projectId, setProjectId] = useState(activeProject);
  const [agentSteps, setAgentSteps] = useState(getAgentStream);
  const [transcript, setTranscript] = useState(() => getProjectTranscript(activeProject()));
  const [git, setGit] = useState(null);
  const [gitBusy, setGitBusy] = useState(false);
  const resizeCleanupRef = useRef(null);
  const project = projectId ? getProject(projectId) : null;
  const prof = PROFILES.find((item) => item.id === profile) || PROFILES[0];
  const mode = getOperatingMode(effectiveMode);

  useEffect(() => onRightPaneTab((tab) => {
    setPaneTab(tab);
    setCollapsed(false);
  }), []);
  useEffect(() => onActiveProject((id) => { setProjectId(id); setTranscript(getProjectTranscript(id)); setGit(null); }), []);
  useEffect(() => onAgentStream(setAgentSteps), []);
  useEffect(() => onProjectTranscript((id, entries) => { if (id === projectId) setTranscript(entries); }), [projectId]);

  const refreshGit = async () => {
    if (!projectId) return;
    setGitBusy(true);
    setGit(await inspectProjectGit(projectId));
    setGitBusy(false);
  };

  useEffect(() => { if (paneTab === "git" && projectId && !git) refreshGit(); }, [paneTab, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const beginResize = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent) => setWidth(clampWidth(startWidth + startX - moveEvent.clientX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      document.documentElement.classList.remove("is-resizing-right-pane");
      resizeCleanupRef.current = null;
    };
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = stop;
    document.documentElement.classList.add("is-resizing-right-pane");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("blur", stop, { once: true });
  };

  const resizeWithKeyboard = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") setWidth(320);
    else if (event.key === "End") setWidth(720);
    else setWidth((current) => clampWidth(current + (event.key === "ArrowLeft" ? 24 : -24)));
  };

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    try { localStorage.setItem("medantir.right-pane.width", String(width)); } catch { /* storage unavailable */ }
  }, [width]);

  useEffect(() => {
    try { localStorage.setItem("medantir.right-pane.collapsed", String(collapsed)); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const tabs = [
    ["browser", "Browser", Globe],
    ["terminal", "Terminal", Terminal],
    ["git", "Git", GitBranch],
    ["agents", "Agents", Bot],
    ["plots", "Plots", BarChart3],
    ["office", "Office", Briefcase],
  ];
  const liveForProject = agentSteps.filter((step) => !step.projectId || step.projectId === projectId).slice(-30);

  return (
    // The collapsed tool rail now reserves a narrow, explicit layout column. The
    // previous floating rail sat on top of evidence tables and browser controls;
    // this version never overlaps the workspace at supported desktop widths.
    <aside data-collapsed={collapsed ? "true" : "false"} aria-label={`${mode.name} tools`} className={`workspace-right-rail hidden lg:flex flex-col h-screen sticky top-0 z-20 relative shrink-0 chrome-surface`} style={collapsed ? { width: 44, minWidth: 44, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderRadius: 0, boxShadow: "none" } : { width, minWidth: width, borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderRadius: 0, boxShadow: "none" }}>
      {!collapsed && <div role="separator" tabIndex={0} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={720} aria-valuenow={Math.round(width)} aria-label="Resize right tool pane" onPointerDown={beginResize} onKeyDown={resizeWithKeyboard} className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize z-30 group focus:outline-none"><div className="h-full w-px opacity-0 group-hover:opacity-100 group-focus:opacity-100" style={{ background: "var(--color-brand-primary)" }} /></div>}
      {collapsed ? (
        <div className="h-full w-full flex flex-col items-center justify-center gap-1 border-l" style={{ borderColor: "var(--color-border-subtle)", background: "var(--color-bg-surface)" }}>
          <button onClick={() => setCollapsed(false)} title="Expand tools" aria-label="Expand right tool pane" className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ color: "var(--color-text-secondary)" }}><PanelRightOpen className="h-3.5 w-3.5" /></button>
          {tabs.map(([id, label, Icon]) => <button key={id} onClick={() => { selectRightPaneTab(id); setCollapsed(false); }} title={label} aria-label={`Open ${label} tool`} className="h-7 w-7 rounded-lg flex items-center justify-center" style={paneTab === id ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}><Icon className="h-4 w-4" /></button>)}
          {/* The companion when docked — it lives in the rail's own surface, so
              putting it away actually puts it somewhere rather than hiding it. */}
          <CompanionDockButton compact />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex border-b" role="tablist" aria-label="Right tool pane" style={{ borderColor: "var(--color-border-subtle)" }}><button onClick={() => setCollapsed(true)} title="Collapse tools" aria-label="Collapse right tool pane" className="w-9 shrink-0 flex items-center justify-center" style={{ color: "var(--color-text-secondary)" }}><PanelRightClose className="h-3.5 w-3.5" /></button>{tabs.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={paneTab === id} onClick={() => selectRightPaneTab(id)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium border-b-2" style={paneTab === id ? { borderColor: "var(--color-brand-primary)", color: "var(--color-brand-primary)" } : { borderColor: "transparent", color: "var(--color-text-secondary)" }}><Icon className="h-3.5 w-3.5" /> {label}</button>)}</div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {paneTab === "browser" && <React.Suspense fallback={<Empty text="Loading browser…" />}><BrowserTool compact /></React.Suspense>}
            {paneTab === "terminal" && <React.Suspense fallback={<Empty text="Loading terminal…" />}><TerminalTool project={project} /></React.Suspense>}
            {paneTab === "plots" && <React.Suspense fallback={<Empty text="Loading plots…" />}><PlotTool project={project} /></React.Suspense>}
            {paneTab === "office" && <React.Suspense fallback={<Empty text="Loading office…" />}><OfficeTool project={project} /></React.Suspense>}

            {paneTab === "git" && <div className="h-full overflow-y-auto p-3 space-y-3">
              <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-semibold">{project?.name || "No active project"}</div><div className="text-[10px] text-zinc-500">Truthful comparison against the linked GitHub default branch.</div></div><button onClick={refreshGit} disabled={!projectId || gitBusy} aria-label="Refresh Git comparison" className="h-7 w-7 rounded border flex items-center justify-center disabled:opacity-40" style={{ borderColor: "var(--color-border-subtle)" }}>{gitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</button></div>
              {!project ? <Empty text="Select a project in the centre pane." /> : !project.githubRepo ? <Empty text="Link a GitHub repository from Project Overview to compare project files." /> : gitBusy && !git ? <Empty text="Comparing project files…" /> : git?.ok ? <>
                <a href={git.url} target="_blank" rel="noreferrer" className="block text-[11px] font-mono hover:underline" style={{ color: "var(--color-brand-primary)" }}>{project.githubRepo.owner}/{project.githubRepo.repo} · {git.branch}</a>
                <div className="space-y-1">{git.files.length ? git.files.map((file) => <div key={file.path} className="rounded border px-2 py-1.5 flex items-center gap-2 text-[10px]" style={{ borderColor: "var(--color-border-subtle)" }}><span className={`font-mono uppercase w-14 ${file.status === "modified" ? "text-amber-500" : file.status === "added" ? "text-emerald-500" : file.status === "unchanged" ? "text-zinc-400" : "text-rose-500"}`}>{file.status}</span><span className="font-mono truncate">{file.path}</span></div>) : <Empty text="No project-owned files to compare." />}</div>
                {git.truncated && <div className="text-[10px] text-amber-600">Showing the first 40 project files.</div>}
              </> : git ? <Empty text={git.state === "rate-limited" ? "GitHub rate limit reached. Retry later or configure authenticated GitHub access." : git.state === "offline" ? "GitHub is offline or unreachable." : "Repository comparison is unavailable."} /> : <button onClick={refreshGit} className="text-xs px-3 py-2 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>Compare with GitHub</button>}
            </div>}

            {paneTab === "agents" && <div className="h-full overflow-y-auto p-3 space-y-3">
              <div className="text-xs font-semibold">{project ? `${project.name} agents` : "Agent transcript"}</div>
              {liveForProject.length > 0 && <div className="space-y-1"><div className="text-[9px] font-mono font-bold uppercase text-emerald-500">Live</div>{liveForProject.map((step, index) => <div key={`${step.ts}:${index}`} className="rounded border p-2 text-[10px]" style={{ borderColor: "var(--color-border-subtle)" }}><div className="font-mono text-emerald-500">{step.tool || step.status || "working"}</div>{step.args && <div className="font-mono text-zinc-500 break-all mt-1">{JSON.stringify(step.args).slice(0, 400)}</div>}</div>)}</div>}
              {!project ? <Empty text="Select a project to keep a durable agent transcript." /> : transcript.length === 0 ? <Empty text="No project transcript yet. Ask the Composer or use the project Workbench." /> : <div className="space-y-1.5">{transcript.slice().reverse().map((entry) => <div key={entry.id} className="rounded border p-2 text-[10px]" style={{ borderColor: "var(--color-border-subtle)", background: entry.role === "user" ? "color-mix(in srgb, var(--color-brand-primary) 5%, transparent)" : "transparent" }}><div className="flex items-center justify-between gap-2 mb-1"><span className="font-mono uppercase text-zinc-400">{entry.tool || entry.role}</span><span className="font-mono text-zinc-400">{new Date(entry.at).toLocaleTimeString()}</span></div><div className="whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-300">{entry.content}</div></div>)}</div>}
            </div>}
          </div>

          <div className="px-2 py-1.5 border-t flex items-center gap-2 text-[9px] font-mono text-zinc-400" style={{ borderColor: "var(--color-border-subtle)" }}>
            <span className="flex-1 truncate text-center">{mode.name} · {prof.name} · {Math.round(width)}px</span>
            <CompanionDockButton compact />
          </div>
        </div>
      )}
    </aside>
  );
}

function Empty({ text }) {
  return <div className="rounded border border-dashed p-4 text-center text-[10px] text-zinc-500" style={{ borderColor: "var(--color-border-subtle)" }}>{text}</div>;
}
