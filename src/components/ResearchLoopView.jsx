import React, { useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";
import { runResearchLoop } from "../engine/researchLoop.js";
import { activeProject, putFile } from "../engine/projectstore.js";

export default function ResearchLoopView() {
  const [question, setQuestion] = useState("");
  const [rounds, setRounds] = useState(3);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const run = async () => {
    setBusy(true); setResult(null); setSaved("");
    const output = await runResearchLoop(question, { rounds, onRound: setProgress });
    setResult(output); setBusy(false);
  };

  const save = () => {
    const projectId = activeProject();
    if (!projectId || !result) { setSaved("Select an active project first."); return; }
    const path = `evidence/research-loop-${Date.now()}.json`;
    putFile(projectId, { path, name: "Research loop output", type: "evidence-loop", content: JSON.stringify(result, null, 2) });
    setSaved(`Saved to ${path}`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.03] p-4 space-y-3">
        <div><div className="text-sm font-semibold">Refinement loop</div><div className="text-[11px] text-zinc-500 mt-1">Search → evidence-bound synthesis → gap → refined query. Each round exposes its query, retrieval count, finding, gap, and confidence.</div></div>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} placeholder="Enter a research question to refine…" aria-label="Research loop question" className="w-full text-sm px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-teal-500 resize-none" />
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-mono text-zinc-500">Rounds <select value={rounds} onChange={(event) => setRounds(Number(event.target.value))} className="ml-1 text-xs px-2 py-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label>
          <button onClick={run} disabled={busy || !question.trim()} className="ml-auto flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run loop</button>
        </div>
        {progress && <div className="text-[10px] font-mono text-teal-600 dark:text-teal-400">round {progress.round}/{progress.total} · {progress.phase} · {progress.query}</div>}
      </div>

      {result && <div className="space-y-3">
        {!result.ok ? <div className="rounded-lg border border-amber-500/30 p-3 text-xs text-amber-500">{result.reason}</div> : <>
          {result.epiContext && <div className="rounded-lg border border-[var(--color-brand-primary)]/30 bg-[var(--color-brand-primary)]/[0.03] p-3 text-xs text-zinc-600 dark:text-zinc-300">{result.epiContext}</div>}
          {result.rounds.map((round) => <div key={round.round} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"><div className="flex items-center gap-2"><span className="text-[10px] font-mono font-bold text-teal-500">ROUND {round.round}</span><span className="text-[10px] font-mono text-zinc-400">{round.papers} papers{round.confidence != null ? ` · confidence ${Math.round(round.confidence * 100)}%` : ""}</span></div><div className="text-[11px] font-mono text-zinc-500 mt-2">Query: {round.query}</div><div className="text-sm text-zinc-700 dark:text-zinc-300 mt-2">{round.finding}</div>{round.gap && <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">Gap: {round.gap}</div>}</div>)}
          <button onClick={save} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700"><Save className="h-3.5 w-3.5" /> Save to active project</button>
          {saved && <span className="ml-2 text-[10px] font-mono text-teal-500">{saved}</span>}
        </>}
      </div>}
    </div>
  );
}
