import React, { useState } from "react";
import { ArrowRight, CheckCircle2, GitBranch, Loader2, Play, ShieldCheck, UserCheck, XCircle } from "lucide-react";
import { HARNESSES, routeHarness } from "../engine/harness.js";
import { activeProvider } from "../engine/providers.js";
import { approveOrchestration, cancelOrchestration, executeOrchestration, listOrchestrations, proposeOrchestration } from "../engine/orchestration.js";

const STATE_COLOR = { planned: "text-amber-500", approved: "text-[var(--color-brand-primary)]", running: "text-violet-500", qc: "text-teal-500", complete: "text-emerald-500", failed: "text-rose-500", cancelled: "text-zinc-400" };

export default function ProjectOrchestrator({ projectId, mode, onChange }) {
  const [, force] = useState(0);
  const refresh = () => { force((value) => value + 1); onChange?.(); };
  const [task, setTask] = useState("");
  const [override, setOverride] = useState("");
  const [selectedRun, setSelectedRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const runs = listOrchestrations(projectId);
  const current = runs.find((run) => run.id === selectedRun) || runs[0] || null;
  const routed = routeHarness(task);
  const provider = activeProvider();

  const propose = () => {
    if (!task.trim()) return;
    const run = proposeOrchestration(projectId, task, { harnessId: override || undefined });
    setSelectedRun(run.id);
    setTask("");
    setNote("Plan created. Review roles and scopes before approval.");
    refresh();
  };

  const approve = () => {
    const result = approveOrchestration(projectId, current.id);
    setNote(result.ok ? "Approved for this run only. Execution remains a separate action." : result.reason);
    refresh();
  };

  const execute = async () => {
    setBusy(true);
    setNote("");
    const result = await executeOrchestration(projectId, current.id);
    setNote(result.ok ? "Execution and independent QC completed." : result.reason);
    setBusy(false);
    refresh();
  };

  const cancel = () => {
    const result = cancelOrchestration(projectId, current.id);
    setNote(result.ok ? "Run cancelled before execution." : result.reason);
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.03] p-4 space-y-3">
        <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-violet-500" /><span className="text-sm font-semibold">Project orchestration</span><span className="text-[9px] font-mono uppercase text-zinc-400">{mode.name} mode</span></div>
        <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={2} aria-label="Project orchestration task" placeholder="Describe the outcome this project needs…" className="w-full text-sm px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-violet-500 resize-none" />
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-zinc-500">Routed to <strong style={{ color: routed.harness.color }}>{routed.harness.name}</strong></span>
          <select value={override} onChange={(event) => setOverride(event.target.value)} aria-label="Harness override" className="text-[11px] px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
            <option value="">automatic routing</option>
            {HARNESSES.map((harness) => <option key={harness.id} value={harness.id}>{harness.name}</option>)}
          </select>
          <button onClick={propose} disabled={!task.trim()} className="ml-auto flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg"><GitBranch className="h-3.5 w-3.5" /> Create plan</button>
        </div>
      </div>

      {runs.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">
        {runs.map((run) => <button key={run.id} onClick={() => setSelectedRun(run.id)} className={`shrink-0 text-left rounded-lg border px-3 py-2 ${current?.id === run.id ? "border-violet-500/50 bg-violet-500/5" : "border-zinc-200 dark:border-zinc-800"}`}><div className="text-[11px] font-medium max-w-52 truncate">{run.task}</div><div className={`text-[9px] font-mono uppercase mt-0.5 ${STATE_COLOR[run.state]}`}>{run.state}</div></button>)}
      </div>}

      {current && <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3"><div><div className="text-sm font-semibold">{current.task}</div><div className="text-[10px] font-mono text-zinc-400 mt-1">{current.harnessId} · {current.mode} · human-gated run</div></div><span className={`text-[10px] font-mono font-bold uppercase ${STATE_COLOR[current.state]}`}>{current.state}</span></div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {current.roles.map((role, index) => <div key={role.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"><div className="flex items-center gap-1.5 text-[11px] font-semibold"><span className="text-zinc-400">{index + 1}</span><ArrowRight className="h-3 w-3 text-violet-400" />{role.name}</div><div className="text-[10px] text-zinc-500 mt-1">{role.responsibility}</div><div className="flex flex-wrap gap-1 mt-2">{(role.tools || []).slice(0, 5).map((tool) => <span key={tool} className="text-[8px] font-mono px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{tool}</span>)}</div></div>)}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {current.state === "planned" && <button onClick={approve} className="flex items-center gap-1.5 bg-[var(--color-brand-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-2 rounded-lg"><UserCheck className="h-3.5 w-3.5" /> Approve this plan</button>}
          {current.state === "approved" && <button onClick={execute} disabled={busy || !provider} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Execute + QC</button>}
          {["planned", "approved"].includes(current.state) && <button onClick={cancel} className="flex items-center gap-1.5 text-zinc-500 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"><XCircle className="h-3.5 w-3.5" /> Cancel</button>}
          {!provider && current.state === "approved" && <span className="text-[10px] font-mono text-amber-500">Enable an AI provider to execute.</span>}
          {current.approval && <span className="text-[10px] font-mono text-zinc-400">approved by {current.approval.actor} · this run only</span>}
        </div>

        {current.result?.answer && <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"><div className="text-[10px] font-mono font-bold uppercase text-violet-500 mb-1">Specialist output</div><div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{current.result.answer}</div></div>}
        {current.qc && <div className={`rounded-lg border p-3 ${current.qc.ok ? "border-emerald-500/30" : "border-rose-500/30"}`}><div className="text-[10px] font-mono font-bold uppercase flex items-center gap-1.5 text-emerald-500 mb-1"><ShieldCheck className="h-3.5 w-3.5" /> Independent QC</div><div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{current.qc.answer || current.qc.reason}</div></div>}

        <details><summary className="cursor-pointer text-[10px] font-mono text-zinc-400">Run trace ({current.trace.length})</summary><div className="mt-2 space-y-1">{current.trace.map((entry, index) => <div key={`${entry.at}-${index}`} className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">{entry.type === "complete" || entry.type === "qc-complete" ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <ArrowRight className="h-3 w-3 text-zinc-400" />}<span>{entry.type}</span><span className="ml-auto text-zinc-400">{new Date(entry.at).toLocaleTimeString()}</span></div>)}</div></details>
      </div>}

      {note && <div className="text-[11px] font-mono text-violet-500">{note}</div>}
      {!runs.length && <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">No runs yet. Create a plan to expose routing, roles, scopes, approval, execution, and QC before any agent work begins.</div>}
    </div>
  );
}
