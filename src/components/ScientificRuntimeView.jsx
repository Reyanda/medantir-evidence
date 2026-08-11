import React, { useEffect, useMemo, useState } from "react";
import { Activity, BrainCircuit, CheckCircle2, Database, FileSearch, GitBranch, RefreshCw, ScanLine, ShieldCheck } from "lucide-react";
import { getProject } from "../engine/projectstore.js";
import { loadReview, progress, stageStatus } from "../engine/reviewengine.js";
import { reviewServiceHealth } from "../engine/reviewservice.js";

const CONTROL_CAPABILITIES = [
  ["Goal lock", "Immutable intent and protocol alignment"],
  ["Planning", "Stage plan, replan, and capability routing"],
  ["Attention", "Drift, contamination, source, and budget checks"],
  ["Metacognition", "Search / verify / escalate / stop decisions"],
  ["Verification", "Independent challenge before consequential release"],
  ["Rollback", "Checkpointed recovery and downstream invalidation"],
];

const EXECUTION_CAPABILITIES = [
  ["Official-source search", "PubMed, Europe PMC, ClinicalTrials.gov + source-native compilation"],
  ["Institutional access", "Authenticated browser sessions for licensed databases"],
  ["Document intelligence", "LiteParse-first quality hierarchy with explicit fallback debt"],
  ["Evidence gating", "Recall-first screening with contamination controls"],
  ["Outcome synthesis", "Outcome-specific pooling with compatibility checks"],
  ["Scientific figures", "Auditable forest-plot analysis objects and native vector output"],
];

function fileMatches(files, pattern) {
  return files.filter((file) => pattern.test(`${file.path || ""} ${file.type || ""} ${file.meta?.kind || ""}`));
}

export default function ScientificRuntimeView({ projectId }) {
  const [service, setService] = useState(null);
  const [checking, setChecking] = useState(false);
  const project = projectId ? getProject(projectId) : null;
  const review = projectId ? loadReview(projectId) : null;
  const files = useMemo(() => Object.values(project?.files || {}), [project]);
  const reviewProgress = review ? progress(review) : null;
  const localStages = review ? stageStatus(review) : [];

  const evidence = useMemo(() => ({
    search: fileMatches(files, /search|ris|provenance/i).length,
    perception: fileMatches(files, /perceptual-evidence|rendered-vector-scene|perception-/i).length,
    documents: fileMatches(files, /full.?text|document|extraction|pdf/i).length,
    analysis: fileMatches(files, /analysis|synthesis|forest|meta-analysis/i).length,
    audit: fileMatches(files, /audit|verification|manifest|provenance/i).length,
  }), [files]);

  const check = async () => {
    setChecking(true);
    setService(await reviewServiceHealth());
    setChecking(false);
  };
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <section className="ui-panel">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="ui-kicker">Scientific runtime</div>
            <h2 className="text-base font-semibold mt-1">Probabilistic cognition inside deterministic scientific control</h2>
            <p className="ui-subtitle">The UI now exposes the control plane separately from evidence execution. A stage is not considered trustworthy merely because an agent says it completed.</p>
          </div>
          <button onClick={check} disabled={checking} className="ui-secondary-button px-2.5 py-1.5 text-[10px]">
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            {service == null ? "Check service" : service ? "Review service online" : "Review service offline"}
          </button>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
          <div className="ui-card">
            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><Activity className="h-3.5 w-3.5" /> Review state</div>
            <div className="ui-stat-value mt-1">{reviewProgress ? `${reviewProgress.pct}%` : "—"}</div>
            <div className="text-[10px] text-zinc-500 mt-1">{reviewProgress ? `${reviewProgress.done}/${reviewProgress.total} local gates complete` : "No local review state yet"}</div>
          </div>
          <div className="ui-card"><div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><Database className="h-3.5 w-3.5" /> Search evidence</div><div className="ui-stat-value mt-1">{evidence.search}</div><div className="text-[10px] text-zinc-500 mt-1">queries, exports, receipts</div></div>
          <div className="ui-card"><div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><ScanLine className="h-3.5 w-3.5" /> Perceptual evidence</div><div className="ui-stat-value mt-1">{evidence.perception}</div><div className="text-[10px] text-zinc-500 mt-1">rendered vector scenes</div></div>
          <div className="ui-card"><div className="flex items-center gap-1.5 text-[10px] text-zinc-500"><ShieldCheck className="h-3.5 w-3.5" /> Audit artifacts</div><div className="ui-stat-value mt-1">{evidence.audit}</div><div className="text-[10px] text-zinc-500 mt-1">provenance / verification records</div></div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="ui-panel">
          <div className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} /><div><div className="text-sm font-semibold">Cognitive control plane</div><div className="text-[10px] text-zinc-500">HEOS / ACR governance wrapped around scientific stages.</div></div></div>
          <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border-subtle)" }}>
            {CONTROL_CAPABILITIES.map(([name, description]) => <div key={name} className="py-2.5 flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "rgb(var(--state-done-rgb))" }} /><div><div className="text-xs font-medium">{name}</div><div className="text-[10px] text-zinc-500 mt-0.5">{description}</div></div></div>)}
          </div>
        </section>

        <section className="ui-panel">
          <div className="flex items-center gap-2"><GitBranch className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} /><div><div className="text-sm font-semibold">Evidence execution plane</div><div className="text-[10px] text-zinc-500">Capabilities registered as scientific tools rather than duplicated orchestration.</div></div></div>
          <div className="mt-3 divide-y" style={{ borderColor: "var(--color-border-subtle)" }}>
            {EXECUTION_CAPABILITIES.map(([name, description]) => <div key={name} className="py-2.5 flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: "rgb(var(--state-done-rgb))" }} /><div><div className="text-xs font-medium">{name}</div><div className="text-[10px] text-zinc-500 mt-0.5">{description}</div></div></div>)}
          </div>
        </section>
      </div>

      <section className="ui-panel">
        <div className="flex items-center gap-2"><FileSearch className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} /><div><div className="text-sm font-semibold">Current project evidence</div><div className="text-[10px] text-zinc-500">Observed artifacts only; missing artifacts remain visibly missing.</div></div></div>
        <div className="grid sm:grid-cols-3 gap-2 mt-3">
          {["documents", "analysis", "audit"].map((key) => <div key={key} className="ui-card"><div className="ui-kicker">{key}</div><div className="ui-stat-value mt-1">{evidence[key]}</div></div>)}
        </div>
        {review && <div className="mt-4 overflow-x-auto"><div className="min-w-[720px] grid grid-cols-12 gap-1">{localStages.map((stage) => <div key={stage.id} className="rounded border px-2 py-2 text-[9px]" style={{ borderColor: stage.complete ? "rgb(var(--state-done-rgb) / 0.35)" : stage.active ? "var(--color-brand-primary)" : "var(--color-border-subtle)", background: "var(--color-bg-elevated)" }}><div className="font-mono uppercase truncate">{stage.id}</div><div className="mt-1 text-zinc-500 truncate">{stage.complete ? "complete" : stage.active ? "active" : "pending"}</div></div>)}</div></div>}
      </section>
    </div>
  );
}
