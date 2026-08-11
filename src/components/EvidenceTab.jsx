import React, { useState } from "react";
import { Activity, BookOpenCheck, BrainCircuit, Calculator, Database, FileArchive, GitBranch, Loader2, RefreshCw, Search, ScrollText } from "lucide-react";
import { activeProject, getProject, isReviewProject, listProjects, putFile, setActiveProject } from "../engine/projectstore.js";
import ReviewTab from "./ReviewTab.jsx";
import SearchStrategyBuilder from "./SearchStrategyBuilder.jsx";
import { SearchView, SourcesView } from "./AcademicTab.jsx";
import ProjectFiles from "./ProjectFiles.jsx";
import ResearchLoopView from "./ResearchLoopView.jsx";
import MetaAnalysisWorkbench from "./MetaAnalysisWorkbench.jsx";
import { reviewServiceHealth } from "../engine/reviewservice.js";
import ScientificRuntimeView from "./ScientificRuntimeView.jsx";

const VIEWS = [
  ["overview", "Overview", BookOpenCheck],
  ["runtime", "Runtime", BrainCircuit],
  ["quick", "Quick Search", Search],
  ["protocol", "Protocol & Strategy", ScrollText],
  ["pipeline", "Review Pipeline", GitBranch],
  ["refine", "Refinement Loop", RefreshCw],
  ["analysis", "Analysis", Calculator],
  ["sources", "Sources", Database],
  ["outputs", "Outputs", FileArchive],
];

export default function EvidenceTab() {
  const projects = listProjects().filter(isReviewProject);
  const [view, setView] = useState("overview");
  const [question, setQuestion] = useState("");
  const [projectId, setProjectId] = useState(() => projects.some((item) => item.id === activeProject()) ? activeProject() : (projects[0]?.id || ""));
  const [health, setHealth] = useState(null);
  const [healthBusy, setHealthBusy] = useState(false);
  const [promotionNote, setPromotionNote] = useState("");
  const project = projectId ? getProject(projectId) : null;

  const chooseProject = (id) => {
    setProjectId(id);
    setActiveProject(id);
  };

  const promote = (payload) => {
    const value = typeof payload === "string" ? { question: payload } : payload;
    setQuestion(value.question);
    if (projectId) {
      const path = `evidence/quick-search-${Date.now()}.json`;
      putFile(projectId, { path, type: "json", content: JSON.stringify({ ...value, promotedAt: new Date().toISOString() }, null, 2), meta: { kind: "search-provenance" } });
      setPromotionNote(`Quick Search evidence and source provenance saved to ${path}.`);
    } else {
      setPromotionNote("Question promoted. Select a project to persist search provenance.");
    }
    setView("protocol");
  };

  return (
    <div className="ui-page">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-title"><BookOpenCheck className="h-5 w-5" /> Evidence</h1>
          <p className="ui-subtitle">From question and source retrieval through document reading, screening, synthesis, verification, and auditable outputs.</p>
        </div>
        <label className="text-[10px] font-mono uppercase text-zinc-400">Active project
          <select value={projectId} onChange={(event) => chooseProject(event.target.value)} className="ml-2 text-xs normal-case px-2 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
            <option value="">No systematic / evidence review selected</option>
            {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {!projects.length && <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.03] p-3 text-xs text-zinc-600 dark:text-zinc-300">No project is classified as a systematic / evidence review. In Projects, create one with that purpose or change an existing project's purpose to enable the review machinery.</div>}

      <div className="ui-tabs" role="tablist" aria-label="Evidence workflow">
        {VIEWS.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2" style={view === id ? { background: "var(--color-bg-elevated)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ["runtime", BrainCircuit, "Scientific runtime", "Inspect cognitive governance, evidence capabilities, service status, and project audit artifacts."],
            ["quick", Search, "Discover", "Run a fast multi-source search, inspect results, and promote the question into a protocol."],
            ["protocol", ScrollText, "Design", "Build the protocol and exact database strategies together, including explosion review and Word export."],
            ["pipeline", GitBranch, "Execute", "Run the gated review pipeline; persist searches, screening, appraisal, synthesis, and verification in the project."],
          ].map(([id, Icon, title, description]) => (
            <button key={id} onClick={() => setView(id)} className="ui-card text-left hover:border-[var(--color-brand-primary)] transition-colors">
              <Icon className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
              <div className="mt-3 text-sm font-semibold">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</div>
            </button>
          ))}
          {/* PRISM example question — shows all 8 dimensions */}
          <div className="md:col-span-2 xl:col-span-4 ui-panel">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Example PRISM question (edit to start)</span>
              <span className="text-[9px] font-mono text-zinc-400">P · R · I · S · M · T · G · D</span>
            </div>
            <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-3">
              "In children aged 6–59 months with severe acute malnutrition in Sub-Saharan Africa, how do ready-to-use therapeutic foods compared to standard F-100 rehabilitation affect recovery rates, mortality, and relapse at 6-month follow-up in randomised controlled trials?"
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] mb-3">
              {[
                ['P', 'Population', 'Children 6–59 mo, SAM'],
                ['I', 'Intervention', 'RUTF (Plumpy\'Nut, etc.)'],
                ['S', 'Comparator', 'F-100 / standard care'],
                ['M', 'Outcome', 'Recovery, mortality, relapse'],
                ['T', 'Time', '6-month follow-up'],
                ['G', 'Geography', 'Sub-Saharan Africa'],
                ['D', 'Design', 'RCTs only'],
                ['R', 'Realm', 'Clinical medicine, nutrition'],
              ].map(([code, label, value]) => (
                <div key={code} className="rounded border border-zinc-200 dark:border-zinc-700 p-1.5">
                  <span className="font-mono font-bold" style={{ color: "var(--color-brand-primary)" }}>{code}</span>
                  <span className="text-zinc-400 ml-1">{label}</span>
                  <div className="text-zinc-600 dark:text-zinc-300 mt-0.5 truncate">{value}</div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setQuestion("In children aged 6–59 months with severe acute malnutrition in Sub-Saharan Africa, how do ready-to-use therapeutic foods compared to standard F-100 rehabilitation affect recovery rates, mortality, and relapse at 6-month follow-up in randomised controlled trials?");
                setView("quick");
              }}
              className="ui-primary-button text-xs px-3 py-2"
            >
              Edit this example → Quick Search
            </button>
          </div>

          <div className="md:col-span-2 xl:col-span-4 ui-panel flex items-center justify-between gap-3 flex-wrap">
            <div><div className="text-sm font-semibold">{project ? project.name : "Select a project to persist the workflow"}</div><div className="text-xs text-zinc-500 mt-1">Mode: {project?.mode || "none"} · outputs stay project-scoped and auditable.</div></div>
            <div className="flex items-center gap-2"><button onClick={async () => { setHealthBusy(true); setHealth(await reviewServiceHealth()); setHealthBusy(false); }} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700">{healthBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Pipeline service{health == null ? "" : health ? " · online" : " · offline"}</button><button onClick={() => setView("sources")} className="text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">Configure evidence sources</button></div>
          </div>
        </div>
      )}
      {view === "runtime" && <ScientificRuntimeView projectId={projectId} />}
      {view === "quick" && <SearchView key={question} initialQuestion={question} goToSources={() => setView("sources")} onPromote={promote} />}
      {view === "protocol" && <div className="space-y-3">{promotionNote && <div className="text-[11px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{promotionNote}</div>}<SearchStrategyBuilder key={question} initialQuestion={question} /></div>}
      {view === "pipeline" && <ReviewTab embedded />}
      {view === "refine" && <ResearchLoopView />}
      {view === "analysis" && <MetaAnalysisWorkbench />}
      {view === "sources" && <SourcesView />}
      {view === "outputs" && (projectId ? <ProjectFiles projectId={projectId} /> : <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">Select a project to view and retrieve its evidence outputs.</div>)}
    </div>
  );
}
