import React, { useState } from "react";
import ReactECharts from "echarts-for-react";
import { Landmark, Search, ArrowUpRight, Loader2, RefreshCw, ExternalLink, Quote } from "lucide-react";
import { PRIORITY_TOPICS, fundingIntel } from "../engine/funding.js";
import { openInApp } from "../engine/openBus.js";

// Research-funding intelligence — live from OpenAlex (keyless, CORS-open).
// Pick a priority topic (or type any), see the real funders active on it,
// their funding share by output, and the highest-impact funded research.

export default function ResourcesTab() {
  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async (t) => {
    setBusy(true); setErr("");
    const d = await fundingIntel(t);
    if (!d.funders.length && !d.works.length) setErr(`No OpenAlex funding data for “${t}”.`);
    setData(d); setBusy(false);
  };
  const go = (t) => { if (!t?.trim()) return; setTopic(t); setQuery(t); load(t); };

  const chartColors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
  const shareOption = data && {
    backgroundColor: "transparent",
    color: chartColors,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (p) => `${p[0].name}<br/>${p[0].value.toLocaleString()} works` },
    grid: { left: 8, right: 16, top: 10, bottom: 4, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#a1a1aa", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(120,120,130,0.12)" } } },
    yAxis: { type: "category", data: data.shares.map((s) => s.name).reverse(), axisLabel: { color: "#a1a1aa", fontSize: 10, width: 150, overflow: "truncate" } },
    series: [{ type: "bar", data: data.shares.map((s) => s.works).reverse(), itemStyle: { borderRadius: [0, 4, 4, 0] }, barMaxWidth: 18 }],
  };

  const money = (n) => n.toLocaleString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Landmark className="h-6 w-6 text-[var(--color-brand-primary)]" /> Research Funding Intelligence</h1>
      </div>

      {/* topic selector */}
      <div className="space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); go(query.trim()); }} className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="disease or research topic…" aria-label="Search disease or research topic"
              className="w-full text-sm pl-9 pr-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]" />
          </div>
          <button type="submit" disabled={busy} className="flex items-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Load
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_TOPICS.map((t) => (
            <button key={t} onClick={() => go(t)} className={`text-[11px] px-2 py-1 rounded-md border ${topic === t ? "border-[var(--color-brand-primary)] text-[var(--color-brand-primary)]" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-[var(--color-brand-primary)]"}`}>{t}</button>
          ))}
        </div>
      </div>

      {err && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] font-mono text-amber-500">{err}</div>}

      {data && !err && (
        <>
          {/* stat row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Funders", data.funders.length], ["Works (top funders)", data.funders.reduce((s, f) => s + f.works, 0)],
              ["Citations", data.funders.reduce((s, f) => s + f.cited, 0)], ["Studies listed", data.works.length]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
                <div className="text-[10px] font-mono uppercase text-zinc-400">{l}</div>
                <div className="text-xl font-bold mt-0.5">{money(v)}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* funding share chart */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Output share by funder — {data.topic}</h3>
              {shareOption ? <ReactECharts option={shareOption} style={{ height: 260 }} /> : <div className="text-xs text-zinc-400">No funder data.</div>}
            </div>

            {/* funders list */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Active funders</h3>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-64 overflow-y-auto">
                {data.funders.map((f) => (
                  <button key={f.id} onClick={() => openInApp(f.homepage || f.url)} className="w-full text-left py-2 flex items-center justify-between gap-3 group">
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate group-hover:text-[var(--color-brand-primary)]">{f.name} {f.country && <span className="text-zinc-400">· {f.country}</span>}</div>
                      {f.description && <div className="text-[10px] text-zinc-400 truncate">{f.description}</div>}
                    </div>
                    <div className="text-right shrink-0 font-mono text-[10px] text-zinc-500">
                      <div>{money(f.works)} works</div>
                      <div className="text-zinc-400">{money(f.cited)} cites</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* funded research table */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f]">
            <div className="px-4 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
              <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Highest-impact research — {data.topic}</h3>
              <span className="text-[10px] font-mono text-zinc-400">{data.works.length} studies</span>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-96 overflow-y-auto">
              {data.works.map((w, i) => (
                <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <div className="min-w-0">
                    <button onClick={() => openInApp(w.url)} className="text-xs font-medium text-left hover:text-[var(--color-brand-primary)] flex items-start gap-1">
                      <span className="truncate">{w.title}</span><ExternalLink className="h-3 w-3 shrink-0 mt-0.5 opacity-50" />
                    </button>
                    <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                      {w.authors.join(", ")}{w.year ? ` · ${w.year}` : ""}{w.oa ? " · OA" : ""}
                      {w.funders.length > 0 && <span className="text-emerald-500"> · {w.funders.slice(0, 2).join(", ")}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-[10px] text-zinc-500 flex items-center gap-1"><Quote className="h-3 w-3" /> {money(w.cites)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
