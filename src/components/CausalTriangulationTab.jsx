import React, { useState } from "react";
import { GitMerge, CheckCircle2, ShieldCheck, Send, Database } from "lucide-react";
import { useEngine } from "../engine/index.js";
import { computeConfidence } from "../engine/actions.js";
import { classifyDomain, analyzeSentiment, THREAT_DOMAINS } from "../engine/sentiment.js";
import { titleFor } from "../engine/ontology.js";

// Causal triangulation over the LIVE ontology — no hardcoded scenarios. Pick any
// real claim (seeded + agent-created) to see its evidence streams, cited sources
// with bias/credibility, and the engine's weighted-triangulation confidence; or
// analyze free text against the live threat-domain + sentiment models.

function Bar({ value, color = "var(--color-brand-primary)" }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export default function CausalTriangulationTab() {
  const api = useEngine();
  const claims = api.store.all("Claim");
  const [selectedId, setSelectedId] = useState(claims[0]?.id || null);
  const [custom, setCustom] = useState("");
  const [customResult, setCustomResult] = useState(null);

  const claim = selectedId ? api.store.get(selectedId) : null;
  const vectors = claim ? api.store.linked(claim.id, "hasEvidence") : [];
  const sources = claim ? api.store.linked(claim.id, "cites") : [];
  const conf = claim ? computeConfidence(api.store, claim) : null;

  const analyze = () => {
    if (!custom.trim()) return;
    const sent = analyzeSentiment(custom);
    const cls = classifyDomain(custom);
    setCustomResult({ sent, cls, domain: THREAT_DOMAINS.find((d) => d.slug === cls.domain) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GitMerge className="h-6 w-6 text-[var(--color-brand-primary)]" /> Causal Triangulation
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Live claims ({claims.length})</h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
            {claims.map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)} className={`w-full text-left px-3 py-2.5 ${selectedId === c.id ? "bg-[var(--color-brand-primary)]/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                <div className="text-xs text-zinc-800 dark:text-zinc-200 line-clamp-2">{titleFor(c)}</div>
                <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{c.status} · {c.confidence ?? "—"}%</div>
              </button>
            ))}
            {claims.length === 0 && <div className="p-4 text-xs text-zinc-500">No claims in the ontology yet.</div>}
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Test free text</div>
            <textarea value={custom} onChange={(e) => setCustom(e.target.value)} rows={3} placeholder="paste a claim / report…" className="w-full text-xs px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)] resize-none" />
            <button onClick={analyze} className="mt-2 flex items-center gap-1.5 bg-[var(--color-brand-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg"><Send className="h-3.5 w-3.5" /> Analyze</button>
            {customResult && (
              <div className="mt-2 text-[11px] font-mono space-y-1">
                <div>sentiment: <span className={customResult.sent.compound < 0 ? "text-rose-500" : "text-emerald-500"}>{customResult.sent.compound}</span></div>
                <div>domain: <span style={{ color: customResult.domain?.color }}>{customResult.cls.domain}</span> (salience {customResult.cls.salience})</div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {claim ? (
            <>
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">{titleFor(claim)}</div>
                <div className="flex items-end justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Triangulated confidence</span>
                  <span className={`text-3xl font-bold font-mono ${conf.confidence >= 60 ? "text-emerald-500" : conf.confidence <= 35 ? "text-rose-500" : "text-amber-500"}`}>{conf.confidence}%</span>
                </div>
                <Bar value={conf.confidence} color={conf.confidence >= 60 ? "#10b981" : conf.confidence <= 35 ? "#f43f5e" : "#f59e0b"} />
                <div className="text-[10px] font-mono text-zinc-400 mt-2">
                  {conf.factors.nSources} sources · {conf.factors.nVectors} evidence streams · source weight {conf.factors.srcWeight.toFixed(2)} · vector weight {conf.factors.vecWeight.toFixed(2)}
                </div>
              </div>

              {vectors.length > 0 && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Evidence streams</div>
                  <div className="space-y-2">
                    {vectors.map((v) => (
                      <div key={v.id}>
                        <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-zinc-700 dark:text-zinc-300">{v.name}</span><span className="font-mono text-zinc-400">{v.score}</span></div>
                        <Bar value={v.score} color="#6366f1" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {sources.length > 0 && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
                  <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Cited sources ({sources.length})</div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {sources.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 text-[11px]">
                        {s.trust === "quarantined" ? <span className="text-rose-500">✕</span> : <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                        <span className="text-zinc-700 dark:text-zinc-300 truncate flex-1">{s.name}</span>
                        <span className="font-mono text-zinc-400">cred {(s.credibility * 100) | 0}% · bias {(s.bias * 100) | 0}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">Select a claim to triangulate.</div>
          )}
        </div>
      </div>
    </div>
  );
}
