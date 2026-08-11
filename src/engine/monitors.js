// monitors.js — EWAR monitors: Climate, Conflict, Epidemiological.
//
// Each monitor is an Early-Warning/Alert/Response pipeline:
//   real open data  →  normalized risk series  →  multi-algorithm ensemble  →
//   EWAR level + uncertainty band + drivers.
// Scope-aware (uses the session's country bbox / code). The Conflict monitor is
// military-gated; session.canAccess controls whether it is offered.

import { CONFIG } from "./config.js";
import {
  gdeltEvents, toDailySeries, openMeteoWeather,
  coingeckoGlobal, coingeckoMarketChart, fxRates,
} from "./connectors.js";
import { ensembleRisk } from "./algorithms.js";
import { acledDailySeries, loadAcledSnapshot } from "./acled.js";
import { forecastWeatherAnomalies } from "./anomaly.js";
import { createIngestionEnvelope } from "./ingestion.js";

// country code → ISO currency, for country-scoped FX stress
const CURRENCY = { KEN: "KES", SSD: "SSP", ETH: "ETB", SOM: "SOS", NGA: "NGN", COD: "CDF",
  SDN: "SDG", UGA: "UGX", TZA: "TZS", YEM: "YER", UKR: "UAH", USA: "USD", GBR: "GBP",
  IND: "INR", CHN: "CNY" };

const DAYS = CONFIG.ewar.lookbackDays;

// Scale a raw count/case series to a 0..100 relative-intensity risk index
// (relative to its own recent peak — an honest proxy without long baselines).
function normalizeRisk(series) {
  const max = Math.max(1, ...series);
  return series.map((v) => Math.round((v / max) * 100));
}

function levelFor(index) {
  const b = CONFIG.ewar.bands;
  if (index >= b.critical) return "critical";
  if (index >= b.elevated) return "elevated";
  if (index >= b.watch) return "watch";
  return "stable";
}

function assess(riskSeries) {
  const ens = ensembleRisk(riskSeries);
  const level = levelFor(ens.consensus);
  const highUncertainty = ens.modelUncertainty >= CONFIG.ewar.uncertaintyFlag;
  return { ...ens, level, highUncertainty };
}

function recentDrivers(events, n = 6) {
  return [...events]
    .filter((e) => e.title)
    .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))
    .slice(0, n);
}

function forecastAssessment(anomaly) {
  const series = anomaly.forecasts.map((row) => row.score);
  const consensus = Math.max(...series);
  const uncertainty = anomaly.baseline.rows < 30 ? 0.24 : 0.12;
  return {
    results: [{ name: "Autoencoder", estimate: consensus, lower: Math.max(0, consensus - 10), upper: Math.min(100, consensus + 10), sd: 10 }],
    consensus,
    spread: 0,
    modelUncertainty: uncertainty,
    band: [Math.max(0, consensus - 10), Math.min(100, consensus + 10)],
    level: levelFor(consensus),
    highUncertainty: uncertainty >= CONFIG.ewar.uncertaintyFlag,
  };
}

function anomalyDrivers(anomaly, loc) {
  const labels = {
    temperature_2m_max: "maximum temperature",
    temperature_2m_min: "minimum temperature",
    precipitation_sum: "precipitation",
    wind_gusts_10m_max: "wind gust",
    et0_fao_evapotranspiration: "evapotranspiration",
  };
  return [...anomaly.forecasts].sort((a, b) => b.score - a.score).slice(0, 6).map((row) => {
    const lead = row.deviations[0];
    return {
      id: `weather-${loc.code}-${row.date}`,
      title: `${row.date}: forecast anomaly ${row.score}/100 · ${labels[lead.feature] || lead.feature} ${lead.z > 0 ? "+" : ""}${lead.z} SD`,
      ts: row.date,
      lat: loc.lat,
      lon: loc.lon,
      kind: "weather-forecast",
      forecast: true,
    };
  });
}

async function runWeatherForecast(loc, purpose = "weather") {
  const weather = await openMeteoWeather({
    lat: loc.lat, lon: loc.lon,
    pastDays: CONFIG.ewar.weatherBaselineDays,
    forecastDays: CONFIG.ewar.weatherForecastDays,
  });
  if (!weather.ok) throw new Error(weather.error || "Weather forecast unavailable.");
  const anomaly = forecastWeatherAnomalies(weather.daily, { minBaselineRows: CONFIG.ewar.anomalyMinBaselineRows });
  const envelope = createIngestionEnvelope({
    protocolId: "open-meteo-forecast", scope: loc, sourceUrl: weather.sourceUrl,
    period: { baseline: anomaly.baseline, forecast: anomaly.forecast },
    rows: anomaly.baseline.rows + anomaly.forecast.rows,
    units: weather.dailyUnits,
    transformations: ["baseline-only standardization", "deterministic shallow autoencoder", "forecast reconstruction-error calibration"],
  });
  const drivers = anomalyDrivers(anomaly, loc);
  return {
    ok: true,
    keys: anomaly.forecasts.map((row) => row.date),
    riskSeries: anomaly.forecasts.map((row) => row.score),
    events: drivers,
    drivers,
    assessment: forecastAssessment(anomaly),
    sources: ["Open-Meteo forecast"],
    monitorKind: "forecast",
    metricLabel: "Forecast anomaly index",
    note: purpose === "epi"
      ? "Environmental precursor watch for climate-sensitive disease: future weather combinations compared with the recent local baseline. It is not an outbreak probability and does not cover non-climate-sensitive disease."
      : "Future weather combinations compared with the recent local baseline. The score is an unsupervised forecast anomaly, not a probability of impact.",
    anomaly,
    ingestion: envelope,
    currentWeather: weather.current,
    asOf: envelope.retrievedAt,
  };
}

// --- Prospective weather early warning -----------------------------------
async function runClimate(loc) {
  return runWeatherForecast(loc, "weather");
}

// --- Conflict (military-gated) -------------------------------------------
async function runConflict(loc) {
  const snapshot = loadAcledSnapshot(loc);
  if (snapshot) {
    const daily = acledDailySeries(snapshot, DAYS);
    const riskSeries = normalizeRisk(daily.series);
    const events = snapshot.recentEvents || [];
    return {
      ok: true,
      keys: daily.keys,
      riskSeries,
      events,
      drivers: events.slice(0, 6),
      assessment: assess(riskSeries),
      sources: ["ACLED · local licensed CSV"],
      note: "Medantir activity index from daily ACLED Political violence events, normalized to the selected snapshot's recent peak. It is not an ACLED risk score.",
      methodology: { provider: "ACLED", ...snapshot.methodology },
      acled: snapshot,
      asOf: snapshot.lastEventDate,
      monitorKind: "observed-context",
      metricLabel: "Medantir activity index",
    };
  }

  const geo = loc.code === "GLOBAL" ? "" : ` ${loc.name}`;
  const res = await gdeltEvents({ query: `(conflict OR airstrike OR offensive OR clashes OR insurgency)${geo} sourcelang:english`, max: 60 });
  let events = res.events || [];
  if (loc.code !== "GLOBAL") events = events.filter((e) => !e.country || e.country.includes(loc.name));
  const daily = toDailySeries(events, DAYS);
  const riskSeries = normalizeRisk(daily.series);
  return {
    ok: res.ok,
    keys: daily.keys,
    riskSeries,
    events,
    drivers: recentDrivers(events),
    assessment: assess(riskSeries),
    sources: [res.ok && "GDELT", res.rateLimited && "GDELT (throttled)"].filter(Boolean),
    note: "GDELT conflict-keyword media volume, relative to its recent peak. This is a media-attention proxy, not ACLED event data or an ACLED risk score.",
    methodology: { provider: "GDELT media proxy" },
    rateLimited: res.rateLimited,
    monitorKind: "observed-context",
    metricLabel: "Media activity index",
  };
}

// --- Epidemiological EWAR -------------------------------------------------
async function runEpi(loc) {
  return runWeatherForecast(loc, "epi");
}

// --- Financial markets ----------------------------------------------------
async function runFinancial(loc) {
  const [chart, glob] = await Promise.all([coingeckoMarketChart({ coin: "bitcoin", days: DAYS }), coingeckoGlobal()]);
  const riskSeries = chart.series && chart.series.length ? chart.series : [0];
  const drivers = [];
  if (glob.ok) {
    drivers.push({ title: `Global crypto mcap 24h change ${glob.mcapChange24h?.toFixed(2)}%`, ts: "" });
    drivers.push({ title: `BTC dominance ${glob.btcDominance?.toFixed(1)}%`, ts: "" });
  }
  // country-scoped FX stress driver
  if (loc.code !== "GLOBAL" && CURRENCY[loc.code]) {
    const fx = await fxRates({ base: "USD" });
    const rate = fx.rates?.[CURRENCY[loc.code]];
    if (rate) drivers.push({ title: `${CURRENCY[loc.code]} spot: ${rate} per USD`, ts: "" });
  }
  return {
    ok: chart.ok || glob.ok,
    keys: chart.keys || [],
    riskSeries,
    events: [],
    drivers,
    assessment: assess(riskSeries),
    sources: [chart.ok && "CoinGecko", "open.er-api"].filter(Boolean),
    note: "Market-stress index = drawdown from 30-day peak. Equity/national indices need a keyed data provider (Settings).",
  };
}

export const MONITORS = {
  climate: { id: "climate", label: "Weather Early Warning", color: "#22c55e", military: false, run: runClimate,
    blurb: "Weather early warning from forecast anomalies against the recent local baseline." },
  conflict: { id: "conflict", label: "Conflict Monitor", color: "#dc2626", military: true, run: runConflict,
    blurb: "ACLED-grounded political-disorder monitoring from a licensed local CSV; GDELT remains an explicitly labelled media proxy when no snapshot is loaded." },
  epi: { id: "epi", label: "Epidemiological EWAR", color: "#ef4444", military: false, run: runEpi,
    blurb: "Prospective environmental precursor watch for climate-sensitive disease; not an outbreak probability." },
  financial: { id: "financial", label: "Financial Markets", color: "#8b5cf6", military: false, run: runFinancial,
    blurb: "Market-stress early warning from live market data (CoinGecko) + FX." },
};

export async function runMonitor(id, loc) {
  const m = MONITORS[id];
  if (!m) return { ok: false, reason: `Unknown monitor ${id}` };
  try {
    return await m.run(loc);
  } catch (e) {
    return { ok: false, reason: String(e.message || e), riskSeries: [], assessment: assess([0]), events: [], drivers: [], sources: [] };
  }
}
