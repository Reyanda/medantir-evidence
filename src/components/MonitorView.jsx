import React, { useState, useCallback, useEffect } from "react";
import { RefreshCw, AlertTriangle, Activity, ExternalLink, Cpu, ShieldAlert, MapPin, MessageSquare, Upload, Trash2, BookOpenCheck } from "lucide-react";
import { MONITORS, runMonitor } from "../engine/monitors.js";
import { currentLocation } from "../engine/session.js";
import { multiModelAsk } from "../engine/ensemble.js";
import { getAIMode } from "../engine/providers.js";
import { askComposer } from "../engine/composerBus.js";
import MiniMap from "./MiniMap.jsx";
import {
  ACLED_ATTRIBUTION_URL, ACLED_CODEBOOK_URL, ACLED_EULA_URL,
  clearAcledSnapshot, importAcledFile, loadAcledSnapshot, saveAcledSnapshot, topCounts,
} from "../engine/acled.js";

// Shared monitor surface. Forecast monitors and observed-context monitors retain
// distinct semantics even though they reuse the same layout.

const LEVEL = {
  critical: { t: "text-rose-500", b: "bg-rose-500", ring: "border-rose-500/50", bg: "bg-rose-500/10" },
  elevated: { t: "text-orange-500", b: "bg-orange-500", ring: "border-orange-500/50", bg: "bg-orange-500/10" },
  watch: { t: "text-amber-500", b: "bg-amber-500", ring: "border-amber-500/40", bg: "bg-amber-500/10" },
  stable: { t: "text-emerald-500", b: "bg-emerald-500", ring: "border-emerald-500/40", bg: "bg-emerald-500/10" },
};

function Sparkline({ series, color = "var(--color-brand-primary)" }) {
  if (!series || series.length < 2) return <div className="text-[10px] text-zinc-400 font-mono">no series</div>;
  const w = 320, h = 48, max = Math.max(...series, 1), min = Math.min(...series, 0);
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export default function MonitorView({ monitorId, readOnly = false }) {
  const monitor = MONITORS[monitorId];
  const loc = currentLocation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modelTake, setModelTake] = useState(null);
  const [asking, setAsking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(null);
  const [importError, setImportError] = useState("");
  const [acledSnapshot, setAcledSnapshot] = useState(() => monitorId === "conflict" ? loadAcledSnapshot(loc) : null);

  useEffect(() => {
    setData(null);
    setImportError("");
    setAcledSnapshot(monitorId === "conflict" ? loadAcledSnapshot({ code: loc.code }) : null);
  }, [monitorId, loc.code]);

  const run = useCallback(async () => {
    setLoading(true);
    setModelTake(null);
    const res = await runMonitor(monitorId, currentLocation());
    setData(res);
    setLoading(false);
  }, [monitorId]);

  const askModels = async () => {
    if (!data) return;
    setAsking(true);
    const a = data.assessment;
    const metric = data.metricLabel || "monitor index";
    const prompt =
      `${monitor.label} for ${loc.name}. ${metric} ${a.consensus}/100 (${a.level}), ` +
      `model spread ${a.spread} (uncertainty ${(a.modelUncertainty * 100).toFixed(0)}%). ` +
      `Recent drivers: ${(data.drivers || []).slice(0, 4).map((d) => d.title).join("; ") || "n/a"}. ` +
      `In 2 sentences: interpret this ${data.monitorKind === "forecast" ? "forecast anomaly" : "observed context"} and give the single most useful next action without overstating prediction.`;
    const res = await multiModelAsk(prompt, { system: "You are a terse monitoring analyst who preserves the distinction between forecasts and observed events." });
    setModelTake(res);
    setAsking(false);
  };

  const importAcled = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportError("");
    setImportProgress({ rows: 0, matched: 0 });
    try {
      const snapshot = await importAcledFile(file, { scope: loc, onProgress: setImportProgress });
      saveAcledSnapshot(snapshot);
      setAcledSnapshot(snapshot);
      setData(await runMonitor("conflict", loc));
    } catch (error) {
      setImportError(String(error?.message || error));
    } finally {
      setImporting(false);
    }
  };

  const removeAcled = () => {
    clearAcledSnapshot(loc);
    setAcledSnapshot(null);
    setData(null);
    setImportProgress(null);
    setImportError("");
  };

  const a = data?.assessment;
  const lv = LEVEL[a?.level || "stable"];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" style={{ color: monitor.color }} />
            {monitor.label}
            {readOnly && <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/30">read-only</span>}
          </h1>
          <p className="text-[11px] font-mono text-zinc-400 mt-1">scope: {loc.name} · {data?.sources?.join(" + ") || "…"}</p>
        </div>
        <div className="flex items-center gap-2">
          {monitorId === "conflict" && !readOnly && (
            <>
              <label className={`flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${importing ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                <Upload className="h-4 w-4" /> {importing ? "Importing…" : "Import ACLED CSV"}
                <input type="file" accept=".csv,text/csv" onChange={importAcled} disabled={importing} aria-label="Import ACLED CSV" className="sr-only" />
              </label>
              {acledSnapshot && <button onClick={removeAcled} title="Remove this user's derived ACLED snapshot" className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-rose-500"><Trash2 className="h-4 w-4" /> Remove snapshot</button>}
            </>
          )}
          {a && (
            <button
              onClick={() => askComposer(`Interpret the ${monitor.label} for ${loc.name}: ${data.metricLabel || "index"} ${a.consensus}/100 (${a.level}), model uncertainty ${(a.modelUncertainty * 100).toFixed(0)}%. This is ${data.monitorKind === "forecast" ? "a forecast anomaly" : "observed context"}. Drivers: ${(data.drivers || []).slice(0, 4).map((d) => d.title).join("; ") || "n/a"}. What should I do without overstating prediction?`)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <MessageSquare className="h-4 w-4" /> Ask agent
            </button>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-2 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
            style={{ background: monitor.color }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Pulling…" : "Run monitor"}
          </button>
        </div>
      </div>

      {monitorId === "conflict" && (importProgress || importError || acledSnapshot) && (
        <div className={`rounded-xl border p-4 ${importError ? "border-rose-500/40 bg-rose-500/5" : "border-red-500/30 bg-red-500/5"}`}>
          {importError ? (
            <div className="text-sm text-rose-600 dark:text-rose-400"><strong>ACLED import rejected.</strong> {importError}</div>
          ) : importing ? (
            <div className="text-sm text-zinc-600 dark:text-zinc-300">Processing locally… {(importProgress?.rows || 0).toLocaleString()} rows read · {(importProgress?.matched || 0).toLocaleString()} matched to {loc.name}. Nothing is uploaded.</div>
          ) : acledSnapshot ? (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">ACLED snapshot ready · {acledSnapshot.scope.name}</div>
                <div className="mt-1 text-[11px] font-mono text-zinc-500">{acledSnapshot.totals.events.toLocaleString()} derived event records · {acledSnapshot.firstEventDate} to {acledSnapshot.lastEventDate} · imported {new Date(acledSnapshot.importedAt).toLocaleString()}</div>
                <div className="mt-1 text-[10px] text-zinc-500">Raw CSV remains local and is not stored or uploaded. Data source: Armed Conflict Location &amp; Event Data (ACLED). Derived locally by Medantir.</div>
              </div>
              <div className="flex gap-2 text-[10px] font-medium">
                <a href={ACLED_CODEBOOK_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-red-600 hover:underline"><BookOpenCheck className="h-3.5 w-3.5" /> Codebook</a>
                <a href={ACLED_ATTRIBUTION_URL} target="_blank" rel="noreferrer" className="text-red-600 hover:underline">Attribution</a>
                <a href={ACLED_EULA_URL} target="_blank" rel="noreferrer" className="text-red-600 hover:underline">EULA</a>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {data && !data.ok && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] font-mono text-amber-600 dark:text-amber-400">
          Live source unavailable{data.rateLimited ? " (rate-limited)" : ""}{data.reason ? `: ${data.reason}` : ""} — showing what was retrieved. {monitor.blurb}
        </div>
      )}

      {!data && !loading && <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">No monitor findings yet. Run the monitor to retrieve live data for {loc.name}.</div>}

      {data?.acled && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              ["ACLED events", data.acled.totals.events],
              ["Political violence", data.acled.totals.politicalViolence],
              ["Demonstrations", data.acled.totals.demonstrations],
              ["Civilian targeting", data.acled.totals.civilianTargeting],
              ["Reported fatalities", data.acled.totals.reportedFatalities],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
                <div className="text-[9px] font-mono uppercase text-zinc-400">{label}</div>
                <div className="mt-1 text-xl font-bold font-mono">{Number(value).toLocaleString()}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 mb-2">ACLED event taxonomy</div>
              <div className="space-y-1.5">{topCounts(data.acled.eventTypes, 6).map(([label, count]) => <div key={label} className="flex justify-between gap-4 text-xs"><span>{label}</span><span className="font-mono text-zinc-500">{count.toLocaleString()}</span></div>)}</div>
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
              <div className="text-[10px] font-mono font-bold uppercase text-zinc-400 mb-2">Interpretation boundary</div>
              <ul className="space-y-1.5 text-[11px] text-zinc-500 list-disc pl-4">
                <li>Reported fatalities are conservative source estimates and may be revised; zero does not prove no deaths occurred.</li>
                <li>Civilian targeting reflects direct or intentional targeting as coded by ACLED, not incidental civilian harm.</li>
                <li>ACLED's hierarchical event coding avoids double-counting concurrent tactics; each row is counted once.</li>
                <li>Time precision: {topCounts(data.acled.timePrecision, 3).map(([key, count]) => `${key}=${count}`).join(" · ") || "not supplied"}. Geo precision: {topCounts(data.acled.geoPrecision, 3).map(([key, count]) => `${key}=${count}`).join(" · ") || "not supplied"}.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {data?.anomaly && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Prospective weather anomaly model</div>
              <div className="mt-1 text-[11px] font-mono text-zinc-500">
                baseline {data.anomaly.baseline.start}–{data.anomaly.baseline.end} ({data.anomaly.baseline.rows} days) · forecast {data.anomaly.forecast.start}–{data.anomaly.forecast.end} ({data.anomaly.forecast.rows} days)
              </div>
            </div>
            <span className="text-[9px] font-mono font-bold uppercase px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/30">forecast-only scoring</span>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
            <div><span className="font-mono text-zinc-400">model</span><div className="mt-0.5">{data.anomaly.method}</div></div>
            <div><span className="font-mono text-zinc-400">threshold</span><div className="mt-0.5">reconstruction error {data.anomaly.threshold}</div></div>
            <div><span className="font-mono text-zinc-400">boundary</span><div className="mt-0.5">Unusual forecast combination; not an impact or outbreak probability.</div></div>
          </div>
        </div>
      )}

      {a && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* EWAR gauge + uncertainty band */}
          <div className={`rounded-xl border ${lv.ring} bg-white dark:bg-[#0c0c0f] p-5`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">{data.metricLabel || "Monitor index"}</span>
              <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${lv.bg} ${lv.t}`}>{a.level}</span>
            </div>
            <div className={`text-5xl font-bold font-mono ${lv.t}`}>{a.consensus}</div>
            <div className="text-[11px] font-mono text-zinc-400 mt-1">
              95% band [{a.band[0]}, {a.band[1]}] · spread {a.spread}
            </div>
            {a.highUncertainty && (
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-mono text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" /> high model uncertainty ({(a.modelUncertainty * 100).toFixed(0)}%)
              </div>
            )}
            <div className="mt-4">
              <div className="text-[9px] font-mono uppercase text-zinc-400 mb-1">{data.monitorKind === "forecast" ? "future forecast horizon" : data?.acled ? "political-violence activity" : "observed series"} ({data.riskSeries?.length}d)</div>
              <Sparkline series={data.riskSeries} color={monitor.color} />
            </div>
          </div>

          {/* Multi-algorithm results */}
          <div className="lg:col-span-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> {data.anomaly ? "Forecast model diagnostics" : "Multi-algorithm estimates (model uncertainty)"}
              </span>
              <button
                onClick={askModels}
                disabled={asking}
                title="Ask the AI engine(s) to interpret"
                className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <Cpu className="h-3.5 w-3.5" /> {asking ? "asking…" : `ask models (${getAIMode()})`}
              </button>
            </div>
            <div className="space-y-2">
              {a.results.map((r) => {
                const span = Math.max(1, a.band[1] - a.band[0]);
                const left = ((r.lower - a.band[0]) / span) * 100;
                const width = ((r.upper - r.lower) / span) * 100;
                const point = ((r.estimate - a.band[0]) / span) * 100;
                return (
                  <div key={r.name} className="flex items-center gap-3">
                    <span className="text-[11px] font-mono text-zinc-500 w-24 shrink-0">{r.name}</span>
                    <div className="relative flex-1 h-4 rounded bg-zinc-100 dark:bg-zinc-800">
                      <div className="absolute h-full rounded bg-zinc-300 dark:bg-zinc-700" style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%` }} />
                      <div className="absolute h-full w-1 rounded bg-[var(--color-brand-primary)]" style={{ left: `${Math.max(0, Math.min(99, point))}%` }} />
                    </div>
                    <span className="text-xs font-mono font-bold w-12 text-right">{r.estimate}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono text-zinc-400">
              {data.anomaly ? `maximum forecast anomaly ${a.consensus} · baseline-calibrated reconstruction threshold ${data.anomaly.threshold}` : `consensus ${a.consensus} · algorithms disagree by ±${a.spread} → ${(a.modelUncertainty * 100).toFixed(0)}% epistemic uncertainty`}
            </div>

            {modelTake && (
              <div className="mt-3 space-y-2">
                {modelTake.ok ? (
                  modelTake.answers.map((ans) => (
                    <div key={ans.providerId} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
                      <div className="text-[10px] font-mono font-bold text-zinc-500">{ans.label}</div>
                      <div className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5">{ans.text || ans.error}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] font-mono text-zinc-400">{modelTake.reason} — enable a provider in AI Providers.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Embedded GIS — geolocated events on-map (no external opening needed) */}
      {data?.events?.some((e) => e.lat != null) && (
        <div>
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Geospatial view</h3>
          <MiniMap events={data.events} bbox={loc.code !== "GLOBAL" ? loc.bbox : undefined} height={300} />
        </div>
      )}

      {/* Drivers */}
      {data?.drivers?.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Drivers ({data.drivers.length})</h3>
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.drivers.map((d, i) => (
              <div key={i} className="p-3 flex items-start gap-3">
                <span className="text-[10px] font-mono text-zinc-400 w-16 shrink-0">{(d.ts || "").slice(0, 10)}</span>
                <div className="text-xs text-zinc-700 dark:text-zinc-300 flex-1">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                      {d.title} <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  ) : (
                    d.title
                  )}
                  {d.magnitude ? <span className="ml-2 font-mono text-rose-500">M{d.magnitude}</span> : null}
                  {d.reportedFatalities > 0 ? <span className="ml-2 font-mono text-rose-500">{d.reportedFatalities} reported fatalities</span> : null}
                  {d.civilianTargeting ? <span className="ml-2 font-mono text-amber-500">civilian targeting</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
