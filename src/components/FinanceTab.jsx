import React, { useCallback } from "react";
import ReactECharts from "echarts-for-react";
import { LineChart, RefreshCw, Loader2, TrendingUp, TrendingDown, Cpu, MessageSquare } from "lucide-react";
import { coingeckoMarketChart, coingeckoGlobal } from "../engine/connectors.js";
import { holtForecast, mlpForecast, mean, std } from "../engine/algorithms.js";
import { askComposer } from "../engine/composerBus.js";
import usePersistedState from "../hooks/usePersistedState.js";

// Finance engine — a markets/price surface (NOT EWAR). Live prices + a price-
// prediction experiment: the Holt and neural-net forecasters (scaled to the price
// range) project the next close with a confidence band. This is the sandbox for
// testing/optimising the price-prediction engine.

const ASSETS = [
  { id: "bitcoin", label: "BTC" }, { id: "ethereum", label: "ETH" }, { id: "solana", label: "SOL" },
  { id: "binancecoin", label: "BNB" }, { id: "ripple", label: "XRP" }, { id: "cardano", label: "ADA" },
];
const RANGES = [7, 30, 90, 180];

// Scale a price series to 0..100, forecast, then map back — so the 0..100-scaled
// neural net works on any price magnitude.
function predictPrice(prices) {
  if (prices.length < 6) return null;
  const lo = Math.min(...prices), hi = Math.max(...prices), span = hi - lo || 1;
  const scaled = prices.map((p) => ((p - lo) / span) * 100);
  const nn = mlpForecast(scaled);
  const holt = holtForecast(scaled, { h: 1 });
  const back = (v) => lo + (v / 100) * span;
  const consensus = mean([nn.estimate, holt.estimate]);
  const spread = std([nn.estimate, holt.estimate]);
  return {
    nn: back(nn.estimate), holt: back(holt.estimate),
    predicted: back(consensus),
    band: [back(Math.max(0, consensus - 1.96 * spread - nn.sd)), back(Math.min(100, consensus + 1.96 * spread + nn.sd))],
    disagreement: Number((spread / 100).toFixed(3)),
  };
}

export default function FinanceTab() {
  const [asset, setAsset] = usePersistedState("financial", "asset", "bitcoin");
  const [days, setDays] = usePersistedState("financial", "days", 90);
  const [data, setData] = usePersistedState("financial", "data", null);
  const [glob, setGlob] = usePersistedState("financial", "glob", null);
  const [loading, setLoading] = usePersistedState("financial", "loading", false);

  const load = useCallback(async () => {
    setLoading(true);
    const [chart, g] = await Promise.all([coingeckoMarketChart({ coin: asset, days }), coingeckoGlobal()]);
    setData(chart); setGlob(g); setLoading(false);
  }, [asset, days]);
  const prices = data?.prices || [];
  const pred = prices.length ? predictPrice(prices) : null;
  const last = prices[prices.length - 1];
  const change = prices.length > 1 ? ((last - prices[0]) / prices[0]) * 100 : 0;

  const option = {
    grid: { left: 55, right: 15, top: 10, bottom: 25 },
    xAxis: { type: "category", data: (data?.keys || []).map((k) => k.slice(5)), axisLabel: { fontSize: 9, color: "#71717a" }, axisLine: { lineStyle: { color: "#3f3f46" } } },
    yAxis: { type: "value", scale: true, axisLabel: { fontSize: 9, color: "#71717a" }, splitLine: { lineStyle: { color: "#27272a" } } },
    series: [
      { data: prices, type: "line", smooth: true, symbol: "none", lineStyle: { color: "#8b5cf6", width: 1.5 }, areaStyle: { opacity: 0.08, color: "#8b5cf6" },
        markPoint: pred ? { data: [{ coord: [(data.keys.length - 1), pred.predicted], value: "→ " + pred.predicted.toFixed(0), itemStyle: { color: "#10b981" } }] } : undefined },
    ],
    tooltip: { trigger: "axis", valueFormatter: (v) => "$" + Number(v).toLocaleString() },
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><LineChart className="h-6 w-6 text-violet-500" /> Markets</h1>
          <p className="text-[10px] font-mono text-zinc-400 mt-1">Live CoinGecko prices. The forecast band is an experimental two-model sandbox (Holt + small neural net) — a forecasting playground, not investment advice.</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ASSETS.map((a) => (
          <button key={a.id} onClick={() => setAsset(a.id)} className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${asset === a.id ? "border-violet-500/50 bg-violet-500/10 text-violet-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}>{a.label}</button>
        ))}
        <div className="ml-auto flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs">
          {RANGES.map((r) => <button key={r} onClick={() => setDays(r)} className={`px-3 py-1.5 ${days === r ? "bg-violet-500/10 text-violet-500" : "text-zinc-500"}`}>{r}d</button>)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono">${last ? last.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</span>
              <span className={`text-xs font-mono flex items-center gap-1 ${change < 0 ? "text-rose-500" : "text-emerald-500"}`}>{change < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}{change.toFixed(1)}%</span>
            </div>
            <button disabled={!data?.ok} onClick={() => askComposer(`Analyse ${asset.toUpperCase()} price action over ${days}d (now $${last?.toFixed(0)}, ${change.toFixed(1)}% change). Predicted next close ~$${pred?.predicted.toFixed(0)}. What's the read?`)} className="flex items-center gap-1.5 disabled:opacity-50 text-[11px] px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"><MessageSquare className="h-3.5 w-3.5" /> Ask agent</button>
          </div>
          {loading ? <div className="h-72 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div> : <ReactECharts option={option} style={{ height: 300 }} />}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-500 mb-2 flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Predicted next close</div>
            {pred ? (
              <>
                <div className="text-2xl font-bold font-mono">${pred.predicted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                <div className="text-[10px] font-mono text-zinc-400 mt-1">band ${pred.band[0].toFixed(0)} – ${pred.band[1].toFixed(0)}</div>
                <div className="mt-3 space-y-1 text-[11px] font-mono">
                  <div className="flex justify-between"><span className="text-zinc-400">neural net</span><span>${pred.nn.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">Holt trend</span><span>${pred.holt.toFixed(0)}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-400">model disagreement</span><span className={pred.disagreement > 0.15 ? "text-amber-500" : "text-emerald-500"}>{(pred.disagreement * 100).toFixed(0)}%</span></div>
                </div>
              </>
            ) : <div className="text-[11px] text-zinc-400">{data ? "Need more price history." : "Select Refresh to load market data."}</div>}
          </div>
          {glob?.ok && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4 text-[11px] font-mono space-y-1">
              <div className="flex justify-between"><span className="text-zinc-400">mkt cap 24h</span><span className={glob.mcapChange24h < 0 ? "text-rose-500" : "text-emerald-500"}>{glob.mcapChange24h?.toFixed(2)}%</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">BTC dominance</span><span>{glob.btcDominance?.toFixed(1)}%</span></div>
            </div>
          )}
          {data && !data.ok && !loading && <div className="text-[11px] font-mono text-amber-500">CoinGecko offline — retry.</div>}
        </div>
      </div>
    </div>
  );
}
