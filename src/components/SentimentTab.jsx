import React, { useState } from "react";
import { Radar, RefreshCw, TrendingDown, TrendingUp, Minus, Newspaper, Globe2, Cpu, GitCompareArrows, X } from "lucide-react";
import { useEngine } from "../engine/index.js";
import { THREAT_DOMAINS } from "../engine/sentiment.js";
import { activeProvider } from "../engine/providers.js";
import { askComposer } from "../engine/composerBus.js";

// The flagship "media mood of global security" surface. Real sentiment, computed
// by the in-browser lexicon (or the active AI provider), rolled up per threat domain
// and streamed as a live signal feed. "Pull live media" hits GDELT only after the
// user requests it; unavailable sources remain empty rather than using demo data.

const LEVEL_STYLE = {
  critical: { ring: "border-rose-500/50", text: "text-rose-500", bg: "bg-rose-500/10", dot: "bg-rose-500" },
  elevated: { ring: "border-orange-500/50", text: "text-orange-500", bg: "bg-orange-500/10", dot: "bg-orange-500" },
  watch: { ring: "border-amber-500/40", text: "text-amber-500", bg: "bg-amber-500/10", dot: "bg-amber-500" },
  stable: { ring: "border-emerald-500/40", text: "text-emerald-500", bg: "bg-emerald-500/10", dot: "bg-emerald-500" },
};

function sentimentColor(v) {
  if (v <= -0.4) return "text-rose-500";
  if (v < -0.05) return "text-orange-500";
  if (v < 0.15) return "text-zinc-400";
  return "text-emerald-500";
}

function Trend({ now, prev }) {
  const d = (now ?? 0) - (prev ?? 0);
  if (Math.abs(d) < 1) return <span className="text-zinc-400 flex items-center gap-1 text-[10px]"><Minus className="h-3 w-3" />flat</span>;
  const down = d < 0;
  return (
    <span className={`flex items-center gap-1 text-[10px] ${down ? "text-rose-500" : "text-emerald-500"}`}>
      {down ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
      {down ? "" : "+"}
      {d.toFixed(0)}
    </span>
  );
}

// Horizontal index gauge from -100 (left/alarm) to +100 (right/stabilising)
function IndexGauge({ value }) {
  const neg = value < 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div className="absolute left-1/2 top-0 h-full w-px bg-zinc-400 dark:bg-zinc-600" />
      <div
        className={`absolute top-0 h-full ${neg ? "bg-rose-500" : "bg-emerald-500"}`}
        style={neg ? { right: "50%", width: `${(Math.abs(value) / 100) * 50}%` } : { left: "50%", width: `${(value / 100) * 50}%` }}
      />
    </div>
  );
}

export default function SentimentTab() {
  const api = useEngine();
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("lexicon");
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [selDomain, setSelDomain] = useState(null); // click-through: domain detail
  const [selSignal, setSelSignal] = useState(null); // click-through: signal detail

  const domains = api.store.all("ThreatDomain");
  const signals = api.store
    .all("MediaSignal")
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || "") || b._created - a._created);
  const colorOf = (slug) => THREAT_DOMAINS.find((d) => d.slug === slug)?.color || "#64748b";
  const provider = activeProvider();

  // global index = mean of domain indices
  const observedDomains = domains.filter((domain) => (domain.signalCount || 0) > 0);
  const globalIndex = observedDomains.length
    ? Math.round(observedDomains.reduce((a, d) => a + (d.sentimentIndex ?? 0), 0) / observedDomains.length)
    : null;

  const pull = async () => {
    setBusy(true);
    setStatus(null);
    setProgress(null);
    try {
      const res = await api.pullMedia({
        useLive: true,
        method,
        onProgress: (p) =>
          setProgress(
            p.phase === "backoff"
              ? `rate-limited on ${p.domain} — backing off…`
              : `${p.domain} (${p.index}/${p.total}) · ${p.via || ""} ${p.count ?? ""}`
          ),
      });
      setStatus(res);
    } catch (e) {
      setStatus({ error: String(e.message || e) });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // AI↔lexicon divergence: signals scored by BOTH analysts, ranked by disagreement.
  // The highest-divergence items are where a model caught nuance (sarcasm, framing,
  // context) the lexicon missed, or vice-versa — the highest-value items to review.
  const diverging = signals
    .filter((s) => s.aiSentiment != null && s.lexSentiment != null)
    .sort((a, b) => (b.divergence ?? 0) - (a.divergence ?? 0))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Radar className="h-6 w-6 text-sky-500" />
            Media Sentiment Radar
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
            Real media tone across the key global-security threat domains, scored by the in-browser lexicon
            {provider ? <> or the active model (<span className="font-mono text-[11px]">{provider.label}</span>)</> : null} and
            rolled up from {signals.length} live signals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* method toggle */}
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs">
            <button
              onClick={() => setMethod("lexicon")}
              className={`px-3 py-2 ${method === "lexicon" ? "bg-sky-500/10 text-sky-500" : "text-zinc-500"}`}
            >
              Lexicon
            </button>
            <button
              onClick={() => provider && setMethod("ai")}
              disabled={!provider}
              title={provider ? `Use ${provider.label}` : "Enable a provider in AI Providers"}
              className={`px-3 py-2 flex items-center gap-1 ${
                method === "ai" ? "bg-sky-500/10 text-sky-500" : provider ? "text-zinc-500" : "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
              }`}
            >
              <Cpu className="h-3.5 w-3.5" /> AI{provider ? `: ${provider.label.split(" ")[0]}` : ""}
            </button>
          </div>
          <button
            onClick={pull}
            disabled={busy}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Pulling…" : "Pull live media"}
          </button>
        </div>
      </div>

      {(progress || status) && (
        <div className="text-[11px] font-mono text-zinc-500">
          {busy && progress
            ? `⟳ ${progress}`
            : status?.error
            ? `pull error: ${status.error}`
            : status
            ? `ingested via ${status.source} · ${status.live} live (GDELT) · ${status.unavailable || 0} unavailable${
                status.throttled ? ` · ${status.throttled} throttled` : ""
              }`
            : ""}
        </div>
      )}

      {/* Global posture band */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Globe2 className="h-3.5 w-3.5" /> Global media posture
          </span>
          <span className={`text-2xl font-bold font-mono ${globalIndex == null ? "text-zinc-400" : globalIndex < 0 ? "text-rose-500" : "text-emerald-500"}`}>
            {globalIndex != null && globalIndex > 0 ? "+" : ""}
            {globalIndex ?? "—"}
          </span>
        </div>
        {globalIndex != null ? <IndexGauge value={globalIndex} /> : <div className="text-sm text-zinc-500">No live media has been requested.</div>}
        {globalIndex != null && <div className="flex justify-between text-[10px] font-mono text-zinc-400 mt-1">
          <span>−100 alarm</span>
          <span>0</span>
          <span>+100 stabilising</span>
        </div>}
      </div>

      {/* Domain grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {domains
          .slice()
          .sort((a, b) => (a.sentimentIndex ?? 0) - (b.sentimentIndex ?? 0))
          .map((d) => {
            const observed = (d.signalCount || 0) > 0;
            const s = observed ? (LEVEL_STYLE[d.threatLevel] || LEVEL_STYLE.stable) : { ring: "border-zinc-200 dark:border-zinc-800", bg: "bg-zinc-100 dark:bg-zinc-800", text: "text-zinc-400" };
            const worst = api.store
              .linkedInverse(d.id, "signalInDomain")
              .sort((a, b) => (a.sentiment ?? 0) - (b.sentiment ?? 0))[0];
            return (
              <button key={d.id} onClick={() => setSelDomain(d)} className={`text-left rounded-xl border ${s.ring} bg-white dark:bg-[#0c0c0f] p-4 hover:ring-2 hover:ring-sky-500/30 transition-all`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: colorOf(d.slug) }} />
                    <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">{d.name}</span>
                  </div>
                  <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>
                    {observed ? d.threatLevel : "no data"}
                  </span>
                </div>

                <div className="flex items-end justify-between mb-2">
                  <span className={`text-3xl font-bold font-mono ${!observed ? "text-zinc-400" : d.sentimentIndex < 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {observed && d.sentimentIndex > 0 ? "+" : ""}
                    {observed ? d.sentimentIndex : "—"}
                  </span>
                  <div className="text-right">
                    {observed && <Trend now={d.sentimentIndex} prev={d.prevIndex} />}
                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{d.signalCount} signals</div>
                  </div>
                </div>
                {observed && <IndexGauge value={d.sentimentIndex} />}

                {worst && (
                  <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="text-[9px] font-mono uppercase text-zinc-400 mb-1">Sharpest signal</div>
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-300 line-clamp-2 leading-snug">
                      {worst.headline}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-[9px] font-mono text-sky-500">click to inspect →</div>
              </button>
            );
          })}
      </div>

      {/* AI vs lexicon divergence */}
      {diverging.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
            <GitCompareArrows className="h-3.5 w-3.5" /> AI ↔ lexicon divergence — review queue ({diverging.length})
          </h3>
          <div className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/[0.03] divide-y divide-zinc-100 dark:divide-zinc-800">
            {diverging.map((sig) => {
              const dom = api.store.linked(sig.id, "signalInDomain")[0];
              const aiMoreAlarmed = sig.aiSentiment < sig.lexSentiment;
              return (
                <div key={sig.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold font-mono text-fuchsia-500 w-12 shrink-0">
                      Δ{sig.divergence.toFixed(2)}
                    </span>
                    <div className="text-xs text-zinc-800 dark:text-zinc-200 leading-snug min-w-0 flex-1">
                      {sig.headline}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 pl-[3.75rem] text-[10px] font-mono">
                    <span className={sig.lexSentiment < 0 ? "text-rose-500" : "text-emerald-500"}>
                      lexicon {sig.lexSentiment > 0 ? "+" : ""}{sig.lexSentiment.toFixed(2)}
                    </span>
                    <span className={sig.aiSentiment < 0 ? "text-rose-500" : "text-emerald-500"}>
                      model {sig.aiSentiment > 0 ? "+" : ""}{sig.aiSentiment.toFixed(2)}
                    </span>
                    <span className="text-zinc-400">
                      → {aiMoreAlarmed ? "model more alarmed" : "lexicon more alarmed"}
                    </span>
                    {dom && <span className="text-zinc-400 ml-auto">{dom.slug}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live signal feed */}
      <div>
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5">
          <Newspaper className="h-3.5 w-3.5" /> Live signal feed ({signals.length})
        </h3>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[55vh] overflow-y-auto">
          {signals.map((sig) => {
            const dom = api.store.linked(sig.id, "signalInDomain")[0];
            return (
              <button key={sig.id} onClick={() => setSelSignal({ sig, dom })} className="w-full text-left p-3 flex items-start gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                <div className={`text-sm font-bold font-mono w-14 text-right shrink-0 ${sentimentColor(sig.sentiment)}`}>
                  {sig.sentiment > 0 ? "+" : ""}
                  {sig.sentiment.toFixed(2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-zinc-800 dark:text-zinc-200 leading-snug">{sig.headline}</div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-zinc-400 flex-wrap">
                    {dom && (
                      <span className="px-1.5 py-0.5 rounded" style={{ background: `${colorOf(dom.slug)}22`, color: colorOf(dom.slug) }}>
                        {dom.slug}
                      </span>
                    )}
                    <span>{sig.outlet || "—"}</span>
                    {sig.country && <span>· {sig.country}</span>}
                    {sig.publishedAt && <span>· {sig.publishedAt}</span>}
                    <span className="ml-auto opacity-70">{sig.method}</span>
                  </div>
                </div>
              </button>
            );
          })}
          {signals.length === 0 && <div className="p-6 text-center text-xs text-zinc-500">No signals yet — pull live media.</div>}
        </div>
      </div>

      {/* Domain detail modal */}
      {selDomain && (() => {
        const dObj = domains.find((d) => d.slug === selDomain.slug);
        const sigs = dObj ? api.store.linkedInverse(dObj.id, "signalInDomain").sort((a, b) => a.sentiment - b.sentiment) : [];
        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelDomain(null)}>
            <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: colorOf(selDomain.slug) }} />{selDomain.name}</h3>
                <button onClick={() => setSelDomain(null)}><X className="h-5 w-5 text-zinc-400" /></button>
              </div>
              <div className="text-xs text-zinc-500 mb-3">Index <span className={dObj?.sentimentIndex < 0 ? "text-rose-500" : "text-emerald-500"}>{dObj?.sentimentIndex}</span> · {dObj?.threatLevel} · {sigs.length} signals</div>
              <div className="space-y-1.5">
                {sigs.map((sig) => (
                  <button key={sig.id} onClick={() => { setSelSignal({ sig, dom: dObj }); setSelDomain(null); }} className="w-full text-left flex items-start gap-2 p-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    <span className={`text-xs font-mono font-bold w-12 shrink-0 ${sentimentColor(sig.sentiment)}`}>{sig.sentiment > 0 ? "+" : ""}{sig.sentiment.toFixed(2)}</span>
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{sig.headline}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Signal detail modal */}
      {selSignal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setSelSignal(null)}>
          <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl max-w-lg w-full p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold leading-snug">{selSignal.sig.headline}</h3>
              <button onClick={() => setSelSignal(null)}><X className="h-5 w-5 text-zinc-400 shrink-0" /></button>
            </div>
            {selSignal.sig.snippet && <p className="text-xs text-zinc-500 mb-3">{selSignal.sig.snippet}</p>}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mb-3">
              <div>sentiment: <span className={sentimentColor(selSignal.sig.sentiment)}>{selSignal.sig.sentiment}</span></div>
              {selSignal.sig.lexSentiment != null && <div>lexicon: {selSignal.sig.lexSentiment}</div>}
              {selSignal.sig.aiSentiment != null && <div>model: {selSignal.sig.aiSentiment}</div>}
              {selSignal.sig.divergence > 0 && <div className="text-fuchsia-500">Δ {selSignal.sig.divergence}</div>}
              {selSignal.dom && <div>domain: <span style={{ color: colorOf(selSignal.dom.slug) }}>{selSignal.dom.slug}</span></div>}
              <div>outlet: {selSignal.sig.outlet || "—"}</div>
              {selSignal.sig.country && <div>country: {selSignal.sig.country}</div>}
              <div>method: {selSignal.sig.method}</div>
            </div>
            <div className="flex items-center gap-3">
              {selSignal.sig.url && <a href={selSignal.sig.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-500 hover:underline">Open source <Newspaper className="h-3.5 w-3.5" /></a>}
              <button onClick={() => { askComposer(`Assess this media item's intelligence significance: "${selSignal.sig.headline}" (${selSignal.dom?.slug || "domain"}, sentiment ${selSignal.sig.sentiment}).`); setSelSignal(null); }} className="inline-flex items-center gap-1 text-xs text-[var(--color-brand-primary)] hover:underline">Ask agent <Cpu className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
