import React, { useState } from "react";
import { Sliders, RotateCcw, CheckCircle, ShieldAlert, Cpu, Radio, Scale, Bell, Database, Loader2 } from "lucide-react";
import { CONFIG, persistTune, resetConfigOverrides } from "../engine/config.js";
import { INGESTION_PROTOCOLS } from "../engine/ingestion.js";
import { dhsCountries, dhsSurveys, openMeteoClimate, openMeteoWeather, resolveDhsCountry } from "../engine/connectors.js";
import { currentLocation } from "../engine/session.js";
import { COLLECTION_INTS, COMMAND_DOCTRINE_RULES, HUMANS_FRAMEWORK, ICD_203_STANDARDS, INTELLIGENCE_CYCLE, INTELLIGENCE_DOMAINS, LEVELS_OF_INTELLIGENCE, OPERATIONAL_GOVERNANCE_TRACKS, PROBABILITY_YARDSTICK, PRODUCT_FAMILY } from "../engine/doctrine.js";

// Real engine control panel. Every control reads and writes the live CONFIG
// singleton (via persistTune → localStorage), so changes actually retune the
// decision engine, claim-confidence math, EWAR monitors and AI engine — and
// persist across reloads. No simulated metrics.

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <div className="text-xs text-zinc-700 dark:text-zinc-300">{label}</div>
        {hint && <div className="text-[10px] text-zinc-400 font-mono">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function ProtocolsTab() {
  const [, setTick] = useState(0);
  const [saved, setSaved] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [sourceChecks, setSourceChecks] = useState({});
  const rerender = () => setTick((t) => t + 1);
  const flash = (m) => { setSaved(m); setTimeout(() => setSaved(""), 1800); };

  const set = (section, key, val) => { persistTune(section, { [key]: val }); flash(`${section}.${key} = ${val}`); rerender(); };
  const setBand = (section, band, val) => { persistTune(section, { bands: { ...CONFIG[section].bands, [band]: val } }); flash(`${section}.bands.${band} = ${val}`); rerender(); };

  const verifySources = async () => {
    setVerifying(true);
    const loc = currentLocation();
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const countryScoped = /^[A-Z]{3}$/.test(loc.code);
    const [weather, climate, dhs] = await Promise.all([
      openMeteoWeather({ lat: loc.lat, lon: loc.lon, pastDays: 14, forecastDays: 3 }),
      openMeteoClimate({ lat: loc.lat, lon: loc.lon, startDate: start, endDate: end }),
      countryScoped
        ? resolveDhsCountry({ iso3: loc.code, name: loc.name }).then(async (resolved) => {
          if (!resolved.ok) return resolved;
          const surveys = await dhsSurveys({ countryCode: resolved.country.DHS_CountryCode });
          return { ...surveys, countryCode: resolved.country.DHS_CountryCode };
        })
        : dhsCountries(),
    ]);
    setSourceChecks({
      "open-meteo-forecast": weather.ok ? { ok: true, detail: `${weather.daily?.time?.length || 0} daily rows · ${weather.timezone || "UTC"}` } : { ok: false, detail: weather.error || "unavailable" },
      "open-meteo-climate": climate.ok ? { ok: true, detail: `${climate.daily?.time?.length || 0} projection rows · ${climate.model}` } : { ok: false, detail: climate.error || "unavailable" },
      "dhs-program": dhs.ok ? { ok: true, detail: countryScoped ? `${dhs.data?.length || 0} surveys · ${dhs.countryCode}` : `${dhs.data?.length || 0} countries in catalogue` } : { ok: false, detail: dhs.error || "unavailable" },
    });
    setVerifying(false);
  };

  const Slider = ({ section, k, min, max, step = 1, band }) => {
    const v = band ? CONFIG[section].bands[band] : CONFIG[section][k];
    return (
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={v}
          onChange={(e) => (band ? setBand(section, band, Number(e.target.value)) : set(section, k, Number(e.target.value)))}
          className="w-40 accent-[var(--color-brand-primary)]" />
        <span className="text-xs font-mono font-bold text-[var(--color-brand-primary)] w-14 text-right">{v}</span>
      </div>
    );
  };

  const card = "bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm";
  const head = "text-sm font-bold text-zinc-950 dark:text-zinc-50 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-2 mb-2";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Sliders className="h-6 w-6 text-[var(--color-brand-primary)]" /> Engine Protocols</h1>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-[11px] font-mono text-emerald-500 flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> {saved}</span>}
          <button onClick={() => { resetConfigOverrides(); flash("reset — reload to apply defaults"); }} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Claim confidence */}
        <div className={card}>
          <h4 className={head}><Scale className="h-4 w-4 text-[var(--color-brand-primary)]" /> Claim confidence (triangulation)</h4>
          <Row label="Source weight" hint="confidence.sourceWeight"><Slider section="confidence" k="sourceWeight" min={0} max={1} step={0.05} /></Row>
          <Row label="Evidence-vector weight" hint="confidence.vectorWeight"><Slider section="confidence" k="vectorWeight" min={0} max={1} step={0.05} /></Row>
          <Row label="Verify threshold" hint="≥ ⇒ claim verified"><Slider section="confidence" k="verifyThreshold" min={0} max={100} /></Row>
          <Row label="Refute threshold" hint="≤ ⇒ claim refuted"><Slider section="confidence" k="refuteThreshold" min={0} max={100} /></Row>
        </div>

        {/* Alert thresholds */}
        <div className={card}>
          <h4 className={head}><Bell className="h-4 w-4 text-amber-500" /> Alert / escalation gates</h4>
          <Row label="Escalate confidence" hint="thresholds.escalateConfidence"><Slider section="thresholds" k="escalateConfidence" min={0} max={100} /></Row>
          <Row label="Critical confidence" hint="thresholds.criticalConfidence"><Slider section="thresholds" k="criticalConfidence" min={0} max={100} /></Row>
        </div>

        {/* EWAR monitors */}
        <div className={card}>
          <h4 className={head}><ShieldAlert className="h-4 w-4 text-rose-500" /> Forecast anomaly banding</h4>
          <Row label="Critical band" hint="forecast anomaly index ≥"><Slider section="ewar" band="critical" min={0} max={100} /></Row>
          <Row label="Elevated band" hint="forecast anomaly index ≥"><Slider section="ewar" band="elevated" min={0} max={100} /></Row>
          <Row label="Watch band" hint="forecast anomaly index ≥"><Slider section="ewar" band="watch" min={0} max={100} /></Row>
          <Row label="Uncertainty flag" hint="ensemble spread ≥ ⇒ flag"><Slider section="ewar" k="uncertaintyFlag" min={0} max={1} step={0.01} /></Row>
          <Row label="Lookback (days)" hint="ewar.lookbackDays"><Slider section="ewar" k="lookbackDays" min={7} max={180} /></Row>
          <Row label="Weather baseline" hint="training days, historical only"><Slider section="ewar" k="weatherBaselineDays" min={14} max={92} /></Row>
          <Row label="Forecast horizon" hint="future days scored"><Slider section="ewar" k="weatherForecastDays" min={1} max={16} /></Row>
        </div>

        <div className={`${card} lg:col-span-2`}>
          <div className={`${head} justify-between`}>
            <h4 className="flex items-center gap-2"><Database className="h-4 w-4 text-cyan-500" /> Data ingestion protocols</h4>
            <button onClick={verifySources} disabled={verifying} className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:border-cyan-500/50 disabled:opacity-60">
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />} {verifying ? "Verifying…" : "Verify live APIs"}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pt-1">
            {INGESTION_PROTOCOLS.map((protocol) => (
              <a key={protocol.id} href={protocol.methodologyUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 hover:border-cyan-500/40 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{protocol.label}</span>
                  <span className="text-[9px] font-mono uppercase text-emerald-500">{protocol.status}</span>
                </div>
                <div className="mt-1 text-[10px] font-mono text-zinc-400">{protocol.role} · {protocol.cadence}</div>
                <div className="mt-2 text-[10px] text-zinc-500">{protocol.drivesWarning ? "May drive warning after baseline validation." : "Context only; cannot drive an early warning."}</div>
                {sourceChecks[protocol.id] && <div className={`mt-2 text-[10px] font-mono ${sourceChecks[protocol.id].ok ? "text-emerald-500" : "text-rose-500"}`}>{sourceChecks[protocol.id].ok ? "live" : "failed"} · {sourceChecks[protocol.id].detail}</div>}
              </a>
            ))}
          </div>
        </div>

        {/* Decision scoring + media */}
        <div className={card}>
          <h4 className={head}><Radio className="h-4 w-4 text-emerald-500" /> Decision scoring & media</h4>
          <Row label="Risk base" hint="riskPenalty = base + action.risk"><Slider section="scoring" k="riskBase" min={0} max={2} step={0.05} /></Row>
          <Row label="Media pressure scale" hint="adverse sentiment → urgency"><Slider section="scoring" k="mediaPressureScale" min={0} max={1} step={0.05} /></Row>
          <Row label="GDELT spacing (ms)" hint="media.gdeltSpacingMs"><Slider section="media" k="gdeltSpacingMs" min={2000} max={12000} step={200} /></Row>
          <Row label="Articles / domain" hint="media.perDomain"><Slider section="media" k="perDomain" min={1} max={20} /></Row>
        </div>

        {/* AI engine */}
        <div className={card}>
          <h4 className={head}><Cpu className="h-4 w-4 text-violet-500" /> AI engine</h4>
          <Row label="Mode" hint="single vs multi-model ensemble">
            <select value={CONFIG.ai.mode} onChange={(e) => set("ai", "mode", e.target.value)}
              className="text-xs font-mono px-2 py-1 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-violet-500">
              <option value="single">single</option><option value="multi">multi</option>
            </select>
          </Row>
          <Row label="Max parallel models" hint="ai.maxParallel"><Slider section="ai" k="maxParallel" min={1} max={12} /></Row>
        </div>

        {/* Intelligence Doctrine & Tradecraft Protocols */}
        <div className={`${card} lg:col-span-2`}>
          <h4 className={head}><Sliders className="h-4 w-4 text-amber-500" /> Unified Intelligence Doctrine &amp; Tradecraft Standards</h4>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Operating rules derived from leading intelligence practices (ICD 203, Structured Analytic Techniques, Analysis of Competing Hypotheses).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-1">Production Cycle (6 Stages)</div>
              <div className="text-[11px] text-zinc-500 space-y-1">
                {INTELLIGENCE_CYCLE.map((c) => (
                  <div key={c.id} className="flex justify-between font-mono text-[10px]">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">{c.shortName}</span>
                    <span className="text-zinc-400">{c.deliverables[0]}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-1">Collection INTs (7 Disciplines)</div>
              <div className="text-[11px] text-zinc-500 space-y-1">
                {COLLECTION_INTS.map((int) => (
                  <div key={int.code} className="flex justify-between items-center font-mono text-[10px]">
                    <span className="font-bold text-[var(--color-brand-primary)] flex items-center gap-1">
                      {int.code} {int.military && <span className="text-[8px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1 rounded border border-amber-500/20">DEF</span>}
                    </span>
                    <span className="text-zinc-500 truncate max-w-[130px]">{int.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-1">Levels of Intelligence</div>
              <div className="text-[11px] text-zinc-500 space-y-1.5">
                {LEVELS_OF_INTELLIGENCE.map((lvl) => (
                  <div key={lvl.level} className="text-[10px]">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">{lvl.level}</span>: <span className="text-zinc-400 font-mono">{lvl.horizon}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3">
            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2">ICD 203 Analytic Tradecraft Quality Bar</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
              {ICD_203_STANDARDS.map((std) => (
                <div key={std.id} className="p-2 rounded border border-zinc-100 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 text-[10px]">
                  <span className="font-bold text-[var(--color-brand-primary)]">std_{std.id}.</span> <span className="font-semibold text-zinc-700 dark:text-zinc-300">{std.title}</span>
                  <div className="text-[9px] text-zinc-400 mt-0.5">{std.requirement}</div>
                </div>
              ))}
            </div>
          </div>

          {/* HUMANS Framework & Systems Modeling */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-4">
            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-1 flex items-center justify-between">
              <span>The HUMANS Systems Modeling Framework</span>
              <span className="text-[9px] font-mono text-cyan-500 uppercase font-semibold">6 Interacting Dimensions</span>
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">Multi-dimensional analysis framework for structural human systems assessment.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {HUMANS_FRAMEWORK.map((h) => (
                <div key={h.key} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-5 w-5 rounded bg-[var(--color-brand-primary)] text-white text-[11px] font-mono font-bold flex items-center justify-center shrink-0">{h.key}</span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{h.dimension}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mb-2">{h.focus}</div>
                  <div className="text-[9px] font-mono text-zinc-400 border-t border-zinc-200 dark:border-zinc-800/80 pt-1.5 space-y-0.5">
                    {h.indicators.map((ind, i) => (
                      <div key={i} className="truncate">&bull; {ind}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Standard Probability Yardstick & Product Family */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2">Standard Probability Yardstick (UK Professional Yardstick)</div>
              <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-[10px] font-mono">
                  <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr><th className="p-2">Standard Term</th><th className="p-2 text-right">Probability Band</th></tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-700 dark:text-zinc-300">
                    {PROBABILITY_YARDSTICK.map((y) => (
                      <tr key={y.term} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                        <td className="p-2 font-medium">{y.term}</td>
                        <td className="p-2 text-right font-bold text-[var(--color-brand-primary)]">{y.approx}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2">Product Hierarchy (10 Report Types)</div>
              <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                {PRODUCT_FAMILY.map((p) => (
                  <div key={p.type} className="p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center justify-between text-[10px]">
                    <div>
                      <span className="font-bold text-zinc-800 dark:text-zinc-200">{p.type}</span>
                      <div className="text-[9px] text-zinc-400">{p.purpose}</div>
                    </div>
                    <div className="text-right font-mono shrink-0 ml-2">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400">{p.horizon}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 15 Governing Command Principles */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 mt-4">
            <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 mb-2">
              Fifteen Governing Command Principles
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {COMMAND_DOCTRINE_RULES.map((rule, idx) => (
                <div key={idx} className="p-2 rounded border border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 text-[10px] text-zinc-700 dark:text-zinc-300 font-mono">
                  {rule}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="text-[10px] font-mono text-zinc-400">
        These values are the same object the engines read at runtime (config.js CONFIG) — e.g. claim confidence uses the weights above, the Decision engine uses risk base & media scale, and monitors band on the EWAR thresholds. Learning updates (RL/Bayesian) also write here.
      </div>
    </div>
  );
}
