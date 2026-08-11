import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpenCheck,
  Boxes,
  CloudRain,
  Crosshair,
  FolderKanban,
  GitMerge,
  Globe,
  HeartPulse,
  KeyRound,
  LineChart,
  Lock,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  ScrollText,
  Settings,
  ShieldHalf,
  Sparkles,
  Swords,
  Wallet,
  Wand2,
  ChevronDown,
  ChevronRight,
  Code2,
  Files,
  MessageSquare,
  Blocks, ChartNoAxesGantt, Workflow,
} from "lucide-react";
import { groupedSurfacesForMode } from "../engine/navigation.js";
import { getOperatingMode } from "../engine/operatingModes.js";
import { activeProject, listProjects, onActiveProject, onProjectsChanged } from "../engine/projectstore.js";
import { askComposer } from "../engine/composerBus.js";

const ICONS = {
  decision: Crosshair,
  sentiment: Radar,
  power: Network,
  projects: FolderKanban,
  // Every surface needs its own glyph: anything absent here falls through to the
  // Boxes fallback, and several surfaces sharing one icon makes the rail
  // unreadable at a glance.
  openproject: ChartNoAxesGantt,
  ontology: Workflow,
  ide: Code2,
  modules: Blocks,
  climate: CloudRain,
  epi: Activity,
  conflict: Swords,
  cyber: ShieldHalf,
  financial: LineChart,
  review: BookOpenCheck,
  personal: Wallet,
  canvas: Sparkles,
  resources: BarChart3,
  triangulation: GitMerge,
  browser: Globe,
  skills: Wand2,
  vault: Lock,
  providers: KeyRound,
  protocols: ScrollText,
  interop: Settings,
};

const PROJECT_TREE_KEY = "medantir.sidebar.project-tree.v1";

function loadProjectTreeState() {
  try { return JSON.parse(localStorage.getItem(PROJECT_TREE_KEY) || "{}"); } catch { return {}; }
}

export default function Sidebar({ activeTab, setActiveTab, onOpenProject, prefetch, mobileOpen, onClose, effectiveMode, policy, shellControls }) {
  const asideRef = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(() => loadProjectTreeState().projectsOpen !== false);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set(loadProjectTreeState().expandedProjects || []));
  const [projectVersion, setProjectVersion] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState(activeProject());
  const mode = getOperatingMode(effectiveMode);
  const groups = groupedSurfacesForMode(effectiveMode, policy);
  const projects = listProjects();

  useEffect(() => onProjectsChanged(() => setProjectVersion((value) => value + 1)), []);
  useEffect(() => onActiveProject(setActiveProjectId), []);
  useEffect(() => {
    try { localStorage.setItem(PROJECT_TREE_KEY, JSON.stringify({ projectsOpen, expandedProjects: [...expandedProjects] })); } catch { /* storage unavailable */ }
  }, [projectsOpen, expandedProjects]);
  useEffect(() => { if (activeTab === "projects") setProjectsOpen(true); }, [activeTab]);
  void projectVersion;

  const toggleProject = (id) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openProject = (project, view = "overview") => {
    onOpenProject?.(project.id, view);
    onClose?.();
  };

  // The mobile drawer is a modal navigation surface: trap focus, support Escape,
  // and return focus to the trigger on close.
  useEffect(() => {
    if (!mobileOpen) return;
    const aside = asideRef.current;
    if (!aside) return;
    const prevFocus = document.activeElement;
    const focusable = () => Array.from(aside.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.disabled && element.offsetParent !== null);
    focusable()[0]?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose?.(); return; }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [mobileOpen, onClose]);

  return (
    <aside
      ref={asideRef}
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen ? "true" : undefined}
      aria-label={`${mode.name} navigation`}
      data-collapsed={collapsed ? "true" : "false"}
      className={`${collapsed ? "md:w-16" : "md:w-64"} workspace-left-rail chrome-surface chrome-shell-sidebar w-64 border-r flex flex-col h-screen fixed md:sticky top-0 left-0 z-50 md:z-30 transform ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 transition-transform md:transition-[width] duration-200`}
    >
      <div className={`${collapsed ? "p-2" : "p-3"} border-b`} style={{ borderColor: "var(--color-border-subtle)" }}>
        <div className={`w-full flex ${collapsed ? "flex-col items-center gap-1.5 p-1.5" : "items-center gap-2.5 p-2"} rounded-lg`} style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)", borderWidth: "var(--surface-border-width)" }}>
          <div className="p-1.5 rounded border shrink-0" style={{ color: "var(--color-brand-primary)", borderColor: "var(--color-border-subtle)", background: "var(--color-bg-surface)" }}><HeartPulse className="h-4.5 w-4.5" /></div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h2 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight leading-none">MEDANTIR</h2>
              <span className="text-[10px] mt-1 block truncate" style={{ color: "var(--color-text-secondary)" }}>{mode.short} mode</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? "Expand" : "Collapse to icons"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
            aria-expanded={!collapsed}
            className={`${collapsed ? "" : "ml-auto"} h-7 w-7 rounded-md flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 shrink-0`}
          >
            {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-4 overflow-y-auto" aria-label={`${mode.name} surfaces`}>
        {groups.map((group) => (
          <div key={group.id} className="space-y-0.5">
            {!collapsed && <h3 className="px-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-mono mb-2">{group.label}</h3>}
            {group.surfaces.map((surface) => {
              const Icon = ICONS[surface.id] || Boxes;
              const active = activeTab === surface.id;
              return (
                <React.Fragment key={surface.id}>
                <div className="flex items-center">
                <button
                  onClick={() => { setActiveTab(surface.id); onClose?.(); }}
                  onMouseEnter={() => prefetch?.(surface.id)}
                  onFocus={() => prefetch?.(surface.id)}
                  title={surface.label}
                  aria-label={surface.label}
                  aria-current={active ? "page" : undefined}
                  className={`min-w-0 flex-1 flex items-center gap-3 ${collapsed ? "justify-center px-0" : "px-4"} py-2.5 rounded-lg text-xs font-medium transition-all ${active ? "text-[var(--color-brand-primary)]" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                  style={active ? { background: "var(--color-bg-elevated)", color: "var(--color-brand-primary)" } : undefined}
                >
                  <Icon className="h-4.5 w-4.5 shrink-0" />
                  {!collapsed && surface.label}
                </button>
                {!collapsed && surface.id === "projects" && <button onClick={() => setProjectsOpen((value) => !value)} aria-label={projectsOpen ? "Collapse project list" : "Expand project list"} aria-expanded={projectsOpen} className="p-2 rounded-md" style={{ color: "var(--color-text-secondary)" }}>{projectsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>}
                </div>
                {!collapsed && surface.id === "projects" && projectsOpen && <div className="ml-5 mt-0.5 mb-1 border-l pl-2 space-y-0.5" style={{ borderColor: "var(--color-border-subtle)" }} aria-label="Project list">
                  {projects.map((project) => {
                    const expanded = expandedProjects.has(project.id);
                    const selected = activeProjectId === project.id;
                    const projectMode = getOperatingMode(project.mode);
                    return <div key={project.id}>
                      <div className="flex items-center rounded-md" style={selected ? { background: "color-mix(in srgb, var(--color-brand-primary) 10%, transparent)" } : undefined}>
                        <button onClick={() => toggleProject(project.id)} aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`} aria-expanded={expanded} className="p-1.5 shrink-0" style={{ color: "var(--color-text-secondary)" }}>{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</button>
                        <button onClick={() => openProject(project)} title={project.name} className="min-w-0 flex-1 py-1.5 pr-1 text-left text-[11px] font-medium truncate" style={{ color: selected ? "var(--color-brand-primary)" : "var(--color-text-primary)" }}>{project.name}</button>
                        <span className="h-1.5 w-1.5 rounded-full mr-2 shrink-0" title={projectMode.name} style={{ background: projectMode.color }} />
                      </div>
                      {expanded && <div className="ml-6 flex flex-wrap gap-0.5 pb-1" aria-label={`${project.name} shortcuts`}>
                        <button onClick={() => openProject(project)} className="project-tree-action">Overview</button>
                        <button onClick={() => openProject(project, "files")} className="project-tree-action"><Files className="h-2.5 w-2.5" /> Files</button>
                        <button onClick={() => { openProject(project); askComposer("", { autofill: false, mode: "chat" }); }} className="project-tree-action"><MessageSquare className="h-2.5 w-2.5" /> Chat</button>
                        <button onClick={() => { openProject(project); askComposer("", { autofill: false, mode: "code" }); }} className="project-tree-action"><Code2 className="h-2.5 w-2.5" /> Code</button>
                      </div>}
                    </div>;
                  })}
                  {!projects.length && <div className="px-2 py-1.5 text-[10px]" style={{ color: "var(--color-text-secondary)" }}>No active projects</div>}
                </div>}
                </React.Fragment>
              );
            })}
          </div>
        ))}
      </nav>

      {!collapsed && <div className="p-3 border-t" style={{ borderColor: "var(--color-border-subtle)", background: "color-mix(in srgb, var(--color-bg-elevated) 58%, transparent)" }}>{shellControls}</div>}
    </aside>
  );
}
