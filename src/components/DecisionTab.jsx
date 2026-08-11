import React, { useState } from "react";
import ReactECharts from "echarts-for-react";
import { Crosshair, Zap, CheckCircle2, Ban, Activity, Cpu, Loader2, MessageSquare, ArrowUpRight, Plus } from "lucide-react";
import { useEngine } from "../engine/index.js";
import { THREAT_DOMAINS } from "../engine/sentiment.js";
import { runAgent, recommendDecisions } from "../engine/agent.js";
import { askComposer } from "../engine/composerBus.js";
import { activeProvider } from "../engine/providers.js";

// The command dashboard: a multidimensional, live synthesis across every engine —
// real media-sentiment per threat domain, the decision engine's expected-value
// action ranking, and an agentic "analyse the board" pass. Nothing fabricated:
// the domain indices roll up from real media, the actions from real ontology state.

// domain slug → the engine tab that owns its live detail
const DOMAIN_TAB = { health: "epi", defence: "conflict", climate: "climate", economy: "financial", cyber: "cyber" };
const threatOf = (index) => Math.round((100 - (index ?? 0)) / 2); // sentiment[-100..100] → threat[0..100]
const levelColor = (t) => (t >= 70 ? "#f43f5e" : t >= 55 ? "#f97316" : t >= 45 ? "#f59e0b" : "#10b981");

export default function DecisionTab({ setActiveTab, embedded = false, section = "all", mode = "all", onAddToCanvas, canvasAudit = [] }) {
  const api = useEngine();
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [recs, setRecs] = useState(null); // LLM-generated recommendations
  const [recBusy, setRecBusy] = useState(false);

  const domains = api.store.all("ThreatDomain").filter((domain) => {
    if (["humanitarian", "academic", "clinical", "statistical", "personal"].includes(mode)) return !["defence", "cyber"].includes(domain.slug);
    return true;
  });
  const audit = [...api.store.audit].reverse().slice(0, 6);
  const combinedAudit = [
    ...canvasAudit.map((entry) => ({ ...entry, source: "canvas" })),
    ...audit.map((entry) => ({ ...entry, at: entry.at || entry.timestamp || 0, source: "engine" })),
  ].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 12);
  const observedDomains = domains.filter((domain) => (domain.signalCount || 0) > 0);
  const hasSignals = observedDomains.length > 0;
  const provider = activeProvider();

  const generateRecs = async () => {
    setRecBusy(true);
    const r = await recommendDecisions();
    setRecs(r);
    setRecBusy(false);
  };
  const colorOf = (slug) => THREAT_DOMAINS.find((d) => d.slug === slug)?.color || "#64748b";

  // composite posture from live domain sentiment (real media-derived)
  const threats = observedDomains.map((d) => threatOf(d.sentimentIndex));
  const composite = threats.length ? Math.round(threats.reduce((a, b) => a + b, 0) / threats.length) : null;
  const critical = observedDomains.filter((d) => threatOf(d.sentimentIndex) >= 70);

  const radar = {
    radar: {
      indicator: observedDomains.map((d) => ({ name: THREAT_DOMAINS.find((t) => t.slug === d.slug)?.name?.split(" ")[0] || d.slug, max: 100 })),
      radius: "68%", splitNumber: 4,
      axisName: { color: "#a1a1aa", fontSize: 9 },
      splitLine: { lineStyle: { color: "#27272a" } }, splitArea: { show: false }, axisLine: { lineStyle: { color: "#3f3f46" } },
    },
    series: [{ type: "radar", data: [{ value: observedDomains.map((d) => threatOf(d.sentimentIndex)), areaStyle: { opacity: 0.2, color: "var(--color-brand-primary)" }, lineStyle: { color: "var(--color-brand-primary)" }, itemStyle: { color: "var(--color-brand-primary)" } }] }],
  };

  const analyzeBoard = async () => {
    setAnalyzing(true); setAnalysis(null);
    const brief = domains.map((d) => `${d.slug}:${d.sentimentIndex}`).join(" ");
    const res = await runAgent(
      `You are the command decision engine. Live threat-domain sentiment indices (negative=alarm): ${brief}. ` +
      `Call run_monitor / threat_sentiment / recommend_actions as needed, then give the TOP 3 prioritised actions across all domains, each one line with rationale.`
    );
    setAnalysis(res); setAnalyzing(false);
  };

  return (
    <div className="space-y-6">
      {!embedded && <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Crosshair className="h-6 w-6 text-[var(--color-brand-primary)]" /> Decision Engine</h1>
        </div>
        <button onClick={analyzeBoard} disabled={analyzing} className="flex items-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />} {analyzing ? "Analysing…" : "Analyse board (agent)"}
        </button>
      </div>}

      {/* top row: composite posture + radar */}
      {(section === "all" || section === "summary") && <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-5 flex flex-col justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Composite threat posture</span>
          <div className="flex items-end gap-2 my-2">
            <span className="text-5xl font-bold font-mono" style={{ color: composite == null ? undefined : levelColor(composite) }}>{composite ?? "—"}</span>
            {composite != null && <span className="text-xs text-zinc-400 mb-1.5">/100</span>}
          </div>
          {composite != null && <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${composite}%`, background: levelColor(composite) }} /></div>}
          <div className="text-[11px] font-mono text-zinc-400 mt-2">{hasSignals ? `${observedDomains.length} observed domains · ${critical.length} critical · ${api.store.all("MediaSignal").length} live signals` : "No live signals loaded."}</div>
        </div>
        <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 px-2">Threat radar (live per-domain)</span>
          {hasSignals ? <ReactECharts option={radar} style={{ height: 240 }} /> : <div className="h-60 flex items-center justify-center text-sm text-zinc-500">Run a live monitor or pull live media to populate the board.</div>}
        </div>
      </div>}

      {/* dimension grid — clickable to source engine */}
      {(section === "all" || section === "evidence") && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {domains.slice().sort((a, b) => threatOf(b.sentimentIndex) - threatOf(a.sentimentIndex)).map((d) => {
          const observed = (d.signalCount || 0) > 0;
          const t = observed ? threatOf(d.sentimentIndex) : null;
          const tab = DOMAIN_TAB[d.slug];
          return (
            <div key={d.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3 group">
              <div className="flex items-center justify-between mb-1">
                <span className="h-2 w-2 rounded-full" style={{ background: colorOf(d.slug) }} />
                <div className="flex items-center gap-1">
                  {observed && onAddToCanvas && <button onClick={() => onAddToCanvas({ type: "bar", title: `${d.name} observed posture`, data: [{ domain: d.name, threat: t }], encodings: { x: "domain", y: "threat" }, generation: "command-centre-reference", source: { kind: "signal", id: d.id, label: `${d.name} signal` } })} title="Add signal to Canvas" aria-label={`Add ${d.name} signal to Canvas`} className="text-zinc-400 hover:text-[var(--color-brand-primary)]"><Plus className="h-3 w-3" /></button>}
                  {observed && <button onClick={() => askComposer(`Assess the ${d.name} situation (threat ${t}/100, sentiment ${d.sentimentIndex}). What should I do?`)} title="Ask agent" className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-[var(--color-brand-primary)]"><MessageSquare className="h-3 w-3" /></button>}
                </div>
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color: observed ? levelColor(t) : undefined }}>{observed ? t : "—"}</div>
              <div className="text-[11px] text-zinc-500 truncate">{d.name}</div>
              {!observed && <div className="text-[9px] font-mono text-zinc-400 mt-1">awaiting live data</div>}
              {tab && <button onClick={() => setActiveTab?.(tab)} className="mt-1 flex items-center gap-0.5 text-[10px] font-mono text-[var(--color-brand-primary)] hover:underline">open {tab} <ArrowUpRight className="h-3 w-3" /></button>}
            </div>
          );
        })}
      </div>}

      {/* agent analysis result */}
      {(section === "all" || section === "scenarios") && <div className="space-y-3">
        {embedded && <button onClick={analyzeBoard} disabled={analyzing} className="flex items-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />} {analyzing ? "Analysing…" : "Analyse current scenario"}
        </button>}
        {analysis ? <div className="rounded-xl border border-[var(--color-brand-primary)]/30 bg-[var(--color-brand-primary)]/[0.04] p-4">
          <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--color-brand-primary)] mb-2 flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Agent board analysis</div>
          {analysis.ok ? <div className="text-sm text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">{analysis.answer}</div> : <div className="text-xs text-amber-500">{analysis.reason}</div>}
          {analysis.ok && onAddToCanvas && <button onClick={() => onAddToCanvas({ type: "note", title: "Scenario analysis", text: analysis.answer, generation: "command-centre-reference", source: { kind: "scenario", label: "Agent-grounded scenario analysis" } })} className="mt-3 flex items-center gap-1 text-[11px] text-[var(--color-brand-primary)]"><Plus className="h-3 w-3" /> Add to Canvas</button>}
          {analysis.trace?.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{analysis.trace.map((t, i) => <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">{t.tool}</span>)}</div>}
        </div> : embedded && <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-sm text-zinc-500">Run an agent-grounded analysis of the current live board. This analyses observed state; it does not fabricate counterfactual forecasts.</div>}
      </div>}

      {/* LLM-driven recommendations — produced after real tool-grounded analysis */}
      {(section === "all" || section === "actions") && <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" /> Recommended actions (AI, analysis-driven)</h3>
          <button onClick={generateRecs} disabled={recBusy || !provider} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50">
            {recBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />} {recBusy ? "Analysing live data…" : "Generate"}
          </button>
        </div>
        {!provider && <div className="text-[11px] font-mono text-amber-500 mb-2">Enable a tool-capable provider in AI Providers to generate recommendations.</div>}
        <div className="space-y-2">
          {recs?.ok && recs.recommendations?.map((r, i) => {
            const pc = r.priority === "critical" ? "text-rose-500 bg-rose-500/10" : r.priority === "high" ? "text-orange-500 bg-orange-500/10" : "text-amber-500 bg-amber-500/10";
            return (
              <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{r.rationale}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${pc}`}>{r.priority}</span>
                    <button onClick={() => askComposer(`Execute this recommendation: "${r.title}" (${r.domain}). ${r.rationale}. Plan the concrete steps and act.`)} title="Send to agent" className="text-zinc-400 hover:text-[var(--color-brand-primary)]"><MessageSquare className="h-4 w-4" /></button>
                    {onAddToCanvas && <button onClick={() => onAddToCanvas({ type: "note", title: r.title, text: `${r.rationale}\n\nPriority: ${r.priority}${r.confidence != null ? ` · Confidence: ${(r.confidence * 100).toFixed(0)}%` : ""}`, generation: "command-centre-reference", source: { kind: "recommendation", label: "Unexecuted recommendation" } })} title="Add recommendation to Canvas" aria-label={`Add ${r.title} to Canvas`} className="text-zinc-400 hover:text-[var(--color-brand-primary)]"><Plus className="h-4 w-4" /></button>}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] font-mono text-zinc-400">
                  <span style={{ color: colorOf(r.domain) }}>{r.domain}</span>
                  {r.confidence != null && <span>confidence {(r.confidence * 100).toFixed(0)}%</span>}
                </div>
              </div>
            );
          })}
          {recs && !recs.ok && <div className="text-[11px] font-mono text-amber-500">{recs.reason}</div>}
          {recs?.ok && (!recs.recommendations || recs.recommendations.length === 0) && <div className="text-[11px] font-mono text-zinc-400">Model returned no structured recommendations.{recs.raw ? " Raw: " + recs.raw.slice(0, 120) : ""}</div>}
          {!recs && !recBusy && <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">Click Generate — the agent pulls live sentiment + monitors, then recommends.</div>}
          {recs?.trace?.length > 0 && <div className="flex flex-wrap gap-1 pt-1">{recs.trace.map((t, i) => <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">{t.tool}</span>)}</div>}
        </div>
      </div>}

      {/* live audit */}
      {(section === "all" || section === "audit") && (
        <div>
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-2"><Activity className="h-3.5 w-3.5" /> Project and engine audit trail</h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] divide-y divide-zinc-100 dark:divide-zinc-800">
            {combinedAudit.map((a) => (
              <div key={a.id || `${a.source}-${a.seq}`} className="p-2.5 flex items-center gap-2">
                {a.source === "canvas" || a.status === "applied" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Ban className="h-3.5 w-3.5 text-rose-500" />}
                <span className="text-xs font-medium">{a.label}</span>
                <span className="text-[10px] font-mono text-zinc-400 ml-auto">{a.source === "canvas" ? "canvas" : `${a.targetTitle || "system"} #${a.seq}`}</span>
              </div>
            ))}
            {combinedAudit.length === 0 && <div className="p-6 text-center text-sm text-zinc-500">No project or engine activity has been recorded.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
