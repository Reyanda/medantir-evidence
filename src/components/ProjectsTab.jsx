import React, { useEffect, useState } from "react";
import { Archive, Boxes, Plus, Calendar, RotateCcw, CheckSquare, Square, GitBranch, ListChecks, Files, LayoutList, FolderOpen, FolderX, Link2, Unlink2, Code2, Plug } from "lucide-react";
import {
  STATUSES,
  PROJECT_TYPES,
  PROJECT_LANGUAGES,
  addTask,
  activeProject,
  archiveProject,
  attachFolderToProject,
  createProject,
  detachFolderFromProject,
  getProject,
  getProjectType,
  linkGitHubToProject,
  listArchivedProjects,
  listProjects,
  refreshFolderListing,
  scheduleProject,
  setActiveProject,
  restoreProject,
  setProjectType,
  setProjectLanguage,
  toggleTask,
  unlinkGitHubFromProject,
  updateProject,
} from "../engine/projectstore.js";
import { consumeProjectSurface, onOpenProjectSurface } from "../engine/projectSurfaceBus.js";
import { isFolderApiAvailable } from "../engine/folderSource.js";
import { allowedContentModes, getOperatingMode } from "../engine/operatingModes.js";
import IdeTab from "./IdeTab.jsx";
import ProjectFiles from "./ProjectFiles.jsx";
import ProjectOrchestrator from "./ProjectOrchestrator.jsx";
import { askComposer } from "../engine/composerBus.js";

const ProjectIntegrations = React.lazy(() => import("./ProjectIntegrations.jsx"));

const STATUS_COLOR = { backlog: "#94a3b8", scoping: "#f59e0b", active: "var(--color-brand-primary)", blocked: "#f43f5e", done: "#10b981" };

export function ProjectDetail({ projectId, onArchive, onModeChanged }) {
  const project = getProject(projectId);
  const [, force] = useState(0);
  const bump = () => force((value) => value + 1);
  const requestedView = consumeProjectSurface("overview");
  const initialView = requestedView === "workbench" ? "overview" : requestedView;
  const [view, setView] = useState(initialView);
  const [openedViews, setOpenedViews] = useState(() => new Set(["overview", initialView]));
  const [task, setTask] = useState("");
  const [when, setWhen] = useState("");
  const [scheduled, setScheduled] = useState(null);
  const [githubUrl, setGithubUrl] = useState(project.githubRepo?.url || "");
  const [githubMsg, setGithubMsg] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMsg, setFolderMsg] = useState("");
  useEffect(() => onOpenProjectSurface((next) => { setView(next); setOpenedViews((current) => new Set([...current, next])); }), []);
  if (!project) return <div className="text-sm text-zinc-500">Project not found.</div>;

  const mode = getOperatingMode(project.mode);
  const projectType = getProjectType(project.projectType);
  const done = project.tasks.filter((item) => item.done).length;
  const selectView = (next) => { setView(next); setOpenedViews((current) => new Set([...current, next])); };

  const schedule = async () => {
    if (!when) return;
    setScheduled(await scheduleProject(project.id, when, project.name));
    bump();
  };

  const attachFolder = async () => {
    setFolderBusy(true); setFolderMsg("");
    const r = await attachFolderToProject(project.id);
    setFolderBusy(false);
    if (r.ok) { setFolderMsg(`${r.name} · ${r.fileCount} files`); bump(); }
    else if (r.error) setFolderMsg(r.error);
  };
  const detachFolder = async () => {
    setFolderBusy(true);
    await detachFolderFromProject(project.id);
    setFolderBusy(false); setFolderMsg("");
    bump();
  };
  const refreshFolder = async () => {
    setFolderBusy(true); setFolderMsg("");
    const r = await refreshFolderListing(project.id);
    setFolderBusy(false);
    if (r.ok) setFolderMsg(`${r.name} · ${r.fileCount} files`);
    else setFolderMsg(r.error);
  };
  const linkGithub = () => {
    const r = linkGitHubToProject(project.id, githubUrl);
    if (r.ok) { setGithubMsg(`${r.owner}/${r.repo} linked`); bump(); }
    else setGithubMsg(r.error);
  };
  const unlinkGithub = () => {
    unlinkGitHubFromProject(project.id);
    setGithubUrl(""); setGithubMsg("");
    bump();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[project.status] }} />
            <h2 className="text-lg font-bold">{project.name}</h2>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${mode.color}1a`, color: mode.color }}>{mode.short}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{projectType.short}</span>
          </div>
          <div className="text-[11px] font-mono text-zinc-400 mt-0.5">{project.domain} · {project.files ? Object.keys(project.files).length : 0} files</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={project.projectType} onChange={(event) => { setProjectType(project.id, event.target.value); bump(); }} aria-label="Project purpose" className="text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1.5 outline-none">
            {PROJECT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={project.workingLanguage || "auto"} onChange={(event) => { setProjectLanguage(project.id, event.target.value); bump(); }} aria-label="Project working language" className="text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1.5 outline-none">
            {PROJECT_LANGUAGES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={project.mode} onChange={(event) => { updateProject(project.id, { mode: event.target.value }); onModeChanged?.(event.target.value); bump(); }} aria-label="Project operating mode" className="text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1.5 outline-none">
            {allowedContentModes().map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select value={project.status} onChange={(event) => { updateProject(project.id, { status: event.target.value }); bump(); }} aria-label="Project status" className="text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2 py-1.5 outline-none">
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          {onArchive && (
            <button aria-label="Archive project" onClick={() => { archiveProject(project.id); onArchive(project.id); }} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-secondary)" }}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
          )}
        </div>
      </div>

      <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs w-fit">
        <button onClick={() => selectView("overview")} className={`flex items-center gap-1.5 px-3 py-1.5 ${view === "overview" ? "bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]" : "text-zinc-500"}`}><LayoutList className="h-3.5 w-3.5" /> Overview</button>
        <button onClick={() => selectView("files")} className={`flex items-center gap-1.5 px-3 py-1.5 ${view === "files" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}><Files className="h-3.5 w-3.5" /> Files</button>
        <button onClick={() => selectView("workbench")} className={`flex items-center gap-1.5 px-3 py-1.5 ${view === "workbench" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}><Files className="h-3.5 w-3.5" /> Workbench</button>
        <button onClick={() => askComposer("", { autofill: false, mode: "code" })} className="flex items-center gap-1.5 px-3 py-1.5 text-zinc-500 hover:text-[var(--color-brand-primary)]"><Code2 className="h-3.5 w-3.5" /> Open code composer</button>
        <button onClick={() => selectView("integrations")} className={`flex items-center gap-1.5 px-3 py-1.5 ${view === "integrations" ? "bg-cyan-500/10 text-cyan-600" : "text-zinc-500"}`}><Plug className="h-3.5 w-3.5" /> Integrations</button>
        <button onClick={() => selectView("orchestration")} className={`flex items-center gap-1.5 px-3 py-1.5 ${view === "orchestration" ? "bg-violet-500/10 text-violet-500" : "text-zinc-500"}`}><GitBranch className="h-3.5 w-3.5" /> Orchestration</button>
      </div>

      {openedViews.has("files") && <div className={view === "files" ? "" : "hidden"}><ProjectFiles projectId={project.id} onChange={bump} /></div>}
      {openedViews.has("workbench") && <div className={view === "workbench" ? "" : "hidden"}><IdeTab projectId={project.id} embedded /></div>}
      {openedViews.has("integrations") && <div className={view === "integrations" ? "" : "hidden"}><React.Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading project integrations…</div>}><ProjectIntegrations projectId={project.id} onOpenView={selectView} onChange={bump} /></React.Suspense></div>}
      {openedViews.has("orchestration") && <div className={view === "orchestration" ? "" : "hidden"}><ProjectOrchestrator projectId={project.id} mode={mode} onChange={bump} /></div>}
      {view === "overview" && (
        <>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex items-start justify-between gap-3">
            <div className="text-xs font-semibold">{projectType.name}</div>
            {project.projectType === "systematic-review" && <span className="text-[9px] font-mono uppercase text-teal-600 bg-teal-500/10 px-2 py-1 rounded">Evidence machinery enabled</span>}
          </div>
          {project.note && <div className="text-xs text-zinc-500">{project.note}</div>}
          {project.capabilities?.length > 0 && <div className="flex flex-wrap gap-1">{project.capabilities.map((capability) => <span key={capability} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{capability}</span>)}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" /> Tasks {project.tasks.length ? `(${done}/${project.tasks.length})` : ""}</span></div>
              <div className="space-y-1 max-h-48 overflow-y-auto mb-2">
                {project.tasks.map((item) => (
                  <button key={item.id} onClick={() => { toggleTask(project.id, item.id); bump(); }} className="w-full flex items-start gap-2 text-left text-xs py-0.5">
                    {item.done ? <CheckSquare className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Square className="h-3.5 w-3.5 text-zinc-400 mt-0.5 shrink-0" />}
                    <span className={item.done ? "line-through text-zinc-400" : "text-zinc-700 dark:text-zinc-300"}>{item.text}</span>
                  </button>
                ))}
                {!project.tasks.length && <div className="text-[11px] text-zinc-400">No tasks</div>}
              </div>
              <input value={task} onChange={(event) => setTask(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && task.trim()) { addTask(project.id, task); setTask(""); bump(); } }} placeholder="add task…" className="w-full text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none" />
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> Orchestration</div>
                <div className="text-[11px] text-zinc-500 mb-2">{project.runs.length} run{project.runs.length === 1 ? "" : "s"}</div>
                <button onClick={() => selectView("orchestration")} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg"><GitBranch className="h-3.5 w-3.5" /> Open orchestrator</button>
              </div>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Schedule</div>
                <div className="flex gap-1.5">
                  <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} className="flex-1 text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none" />
                  <button onClick={schedule} className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">Set</button>
                </div>
                {project.schedule && <div className="mt-1 text-[10px] font-mono text-zinc-400">scheduled: {new Date(project.schedule).toLocaleString()}</div>}
                {scheduled && <div className={`mt-1 text-[10px] font-mono ${scheduled.ok ? "text-emerald-500" : "text-amber-500"}`}>{scheduled.ok ? "pushed to Ascent calendar" : "saved locally (Ascent offline)"}</div>}
              </div>
            </div>
          </div>

          {/* Sources: local folder + GitHub */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Local folder</div>
              {project.localFolder ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">{project.localFolder.name}</div>
                    <span className="text-[10px] font-mono text-zinc-400 shrink-0">{project.localFolder.fileCount} files</span>
                  </div>
                  <div className="text-[9px] font-mono text-zinc-400">Attached {new Date(project.localFolder.attachedAt).toLocaleString()}</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => selectView("files")} className="text-[10px] px-2 py-1 rounded border border-amber-500/30 text-amber-600 hover:bg-amber-500/10"><Files className="h-3 w-3 inline mr-1" />Browse files</button>
                    <button onClick={refreshFolder} disabled={folderBusy} className="text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"><FolderOpen className="h-3 w-3 inline mr-1" />Refresh</button>
                    <button onClick={detachFolder} className="text-[10px] px-2 py-1 rounded border border-rose-500/30 text-rose-500 hover:bg-rose-500/5"><FolderX className="h-3 w-3 inline mr-1" />Disconnect</button>
                  </div>
                  {folderMsg && <div className="text-[10px] font-mono text-emerald-500">{folderMsg}</div>}
                </div>
              ) : (
                <div className="space-y-2">
                  {!isFolderApiAvailable() && <div className="text-[11px] text-zinc-500">Local folder access unavailable</div>}
                  <button onClick={attachFolder} disabled={folderBusy || !isFolderApiAvailable()} className="flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-50"><FolderOpen className="h-3.5 w-3.5" /> {folderBusy ? "Opening…" : "Attach folder"}</button>
                  {folderMsg && <div className="text-[10px] font-mono text-rose-500">{folderMsg}</div>}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg> GitHub repository</div>
              {project.githubRepo ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-zinc-700 dark:text-zinc-300 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                    <a href={project.githubRepo.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[var(--color-brand-primary)] hover:underline truncate">{project.githubRepo.owner}/{project.githubRepo.repo}</a>
                  </div>
                  <div className="text-[9px] font-mono text-zinc-400">Linked {new Date(project.githubRepo.linkedAt).toLocaleString()}</div>
                  <button onClick={unlinkGithub} className="text-[10px] px-2 py-1 rounded border border-rose-500/30 text-rose-500 hover:bg-rose-500/5"><Unlink2 className="h-3 w-3 inline mr-1" />Unlink</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && linkGithub()} placeholder="https://github.com/owner/repo" className="flex-1 text-[11px] font-mono px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]" />
                    <button onClick={linkGithub} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)] border border-[var(--color-brand-primary)]/30 hover:bg-[var(--color-brand-primary)]/20"><Link2 className="h-3.5 w-3.5" /> Link</button>
                  </div>
                  {githubMsg && <div className={`text-[10px] font-mono ${githubMsg.includes("linked") ? "text-emerald-500" : "text-rose-500"}`}>{githubMsg}</div>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ArchivedProjectDetail({ project, onRestore }) {
  const mode = getOperatingMode(project.mode);
  const projectType = getProjectType(project.projectType);
  return (
    <div className="chrome-surface rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} />
            <h2 className="text-lg font-bold">{project.name}</h2>
            <span className="text-[9px] font-mono" style={{ color: mode.color }}>{mode.short}</span>
            <span className="text-[9px] font-mono text-zinc-400">{projectType.short}</span>
          </div>
          <div className="mt-1 text-[10px] font-mono text-zinc-400">
            {project.files} files · {project.tasks.length} tasks · {project.runs.length} runs
          </div>
        </div>
        <button aria-label="Restore project" onClick={() => onRestore(project.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-brand-primary)" }}>
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </button>
      </div>
      <div className="text-[10px] font-mono text-zinc-400">Archived {new Date(project.archivedAt).toLocaleString()}</div>
    </div>
  );
}

export default function ProjectsTab({ effectiveMode }) {
  const [, force] = useState(0);
  const bump = () => force((value) => value + 1);
  const [collection, setCollection] = useState("active");
  const active = listProjects().filter((project) => project.mode === effectiveMode);
  const archived = listArchivedProjects().filter((project) => project.mode === effectiveMode);
  const scoped = collection === "archive" ? archived : active;
  const [selected, setSelected] = useState(() => scoped.some((project) => project.id === activeProject()) ? activeProject() : (scoped[0]?.id || null));
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("general");
  const mode = getOperatingMode(effectiveMode);

  useEffect(() => {
    setSelected((current) => scoped.some((project) => project.id === current) ? current : (scoped[0]?.id || null));
  }, [collection, effectiveMode, scoped.map((project) => project.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (collection === "active" && selected) setActiveProject(selected); }, [collection, selected]);

  const create = () => {
    if (!newName.trim()) return;
    const project = createProject(newName.trim(), { mode: effectiveMode, projectType: newType });
    setCollection("active");
    setNewName("");
    setSelected(project.id);
    setActiveProject(project.id);
    bump();
  };

  const archive = () => {
    setSelected(null);
    bump();
  };

  const restore = (id) => {
    restoreProject(id);
    setCollection("active");
    setSelected(id);
    setActiveProject(id);
    bump();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Boxes className="h-6 w-6" style={{ color: "var(--color-brand-primary)" }} /> Projects</h1>
          <div role="tablist" aria-label="Project collections" className="flex items-center rounded-lg border p-0.5" style={{ borderColor: "var(--color-border-subtle)" }}>
            <button role="tab" aria-selected={collection === "active"} onClick={() => setCollection("active")} className="px-2.5 py-1 rounded-md text-[11px] font-medium" style={collection === "active" ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}>Active {active.length}</button>
            <button role="tab" aria-selected={collection === "archive"} onClick={() => setCollection("archive")} className="px-2.5 py-1 rounded-md text-[11px] font-medium" style={collection === "archive" ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}>Archive {archived.length}</button>
          </div>
        </div>
        {collection === "active" && <div className="flex items-center gap-2 flex-wrap">
          <input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && create()} placeholder="new project…" className="text-xs px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none w-40" />
          <select value={newType} onChange={(event) => setNewType(event.target.value)} aria-label="New project purpose" className="text-xs px-2 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
            {PROJECT_TYPES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button onClick={create} className="flex items-center gap-1 bg-[var(--color-brand-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-2 rounded-lg"><Plus className="h-3.5 w-3.5" /> New</button>
        </div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {scoped.map((project) => {
            const mode = getOperatingMode(project.mode);
            const projectType = getProjectType(project.projectType);
            return (
              <button key={project.id} onClick={() => { setSelected(project.id); if (collection === "active") setActiveProject(project.id); }} className={`w-full text-left rounded-lg border p-3 transition-colors ${selected === project.id ? "border-[var(--color-brand-primary)]/40 bg-[var(--color-brand-primary)]/[0.04]" : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}`}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[project.status] }} />
                  <span className="text-xs font-semibold truncate flex-1">{project.name}</span>
                  <span className="text-[9px] font-mono" style={{ color: mode.color }}>{mode.short}</span>
                  <span className="text-[9px] font-mono text-zinc-400">{projectType.short}</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{collection === "archive" ? `archived · ${project.files} files` : `${project.status} · ${project.tasks.filter((item) => item.done).length}/${project.tasks.length} tasks · ${project.files} files`}</div>
              </button>
            );
          })}
          {!scoped.length && <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">{collection === "archive" ? "Archive empty" : `No ${mode.name} projects`}</div>}
        </div>
        <div className="lg:col-span-2">
          {selected && scoped.some((project) => project.id === selected) ? (
            collection === "archive"
              ? <ArchivedProjectDetail project={scoped.find((project) => project.id === selected)} onRestore={restore} />
              : <div className="chrome-surface rounded-xl border border-zinc-200/70 dark:border-zinc-800/70 p-3"><ProjectDetail projectId={selected} onArchive={archive} onModeChanged={(nextMode) => { if (nextMode !== effectiveMode) setSelected(null); bump(); }} /></div>
          ) : <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{collection === "archive" ? "Select an archived project" : "Select a project"}</div>}
        </div>
      </div>
    </div>
  );
}
