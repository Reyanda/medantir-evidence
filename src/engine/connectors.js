// connectors.js — Real global open-data connectors (CORS-verified, keyless).
//
// Each function hits a live public API and normalizes the response to either an
// event list or a daily count series that the algorithm engine consumes. All fail
// gracefully to { ok:false, events:[] } so a dead endpoint never breaks a monitor.
// Scope-aware: pass a bbox/country from session to constrain to the user's scope.

import { CONFIG } from "./config.js";

const API = CONFIG.apis;

async function getJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: 200, data: await res.json() };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e.message || e) };
  }
}

// day string (UTC) N days back → today, used to bucket events into a daily series
function dayKeys(days) {
  const keys = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return keys;
}

// Bucket [{ts}] events into a daily count series aligned to dayKeys(days).
export function toDailySeries(events, days) {
  const keys = dayKeys(days);
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const series = new Array(keys.length).fill(0);
  for (const e of events) {
    const k = (e.ts || "").slice(0, 10);
    if (k in idx) series[idx[k]] += 1;
  }
  return { keys, series };
}

// --- OSM Nominatim geocoding (any place → bbox) --------------------------
// Country/region/city selection comes from OpenStreetMap, not a hardcoded list.
export async function geocodePlace(query, limit = 6) {
  if (!query || !query.trim()) return [];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=${limit}&addressdetails=0`;
  const r = await getJSON(url);
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data
    .filter((it) => it.boundingbox)
    .map((it) => {
      const bb = it.boundingbox.map(Number); // [south, north, west, east]
      return {
        code: "OSM-" + it.osm_id,
        name: it.display_name.split(",").slice(0, 2).join(", ").slice(0, 44),
        fullName: it.display_name,
        type: it.type,
        lat: +it.lat,
        lon: +it.lon,
        bbox: [bb[2], bb[0], bb[3], bb[1]], // → [west, south, east, north]
        osm: true,
      };
    });
}

// --- USGS earthquakes (geophysical hazard) -------------------------------
export async function usgsEarthquakes({ bbox, days = 30, minmag = 4.5 } = {}) {
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  let url = `${API.usgs}?format=geojson&starttime=${start}&minmagnitude=${minmag}&orderby=time`;
  if (bbox) url += `&minlongitude=${bbox[0]}&minlatitude=${bbox[1]}&maxlongitude=${bbox[2]}&maxlatitude=${bbox[3]}`;
  const r = await getJSON(url);
  if (!r.ok) return { ok: false, events: [] };
  const events = (r.data.features || []).map((f) => ({
    id: f.id,
    title: f.properties.title,
    magnitude: f.properties.mag,
    ts: new Date(f.properties.time).toISOString(),
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
    url: f.properties.url,
    kind: "earthquake",
  }));
  return { ok: true, events, source: "USGS" };
}

// --- NASA EONET natural events (wildfire/storm/flood/volcano) -------------
export async function eonetEvents({ bbox, days = 30, category } = {}) {
  let url = `${API.eonet}?status=all&days=${days}&limit=200`;
  if (category) url += `&category=${category}`;
  if (bbox) url += `&bbox=${bbox[0]},${bbox[3]},${bbox[2]},${bbox[1]}`; // EONET wants w,n,e,s
  const r = await getJSON(url);
  if (!r.ok) return { ok: false, events: [] };
  const events = (r.data.events || []).map((ev) => {
    const g = ev.geometry?.[ev.geometry.length - 1];
    return {
      id: ev.id,
      title: ev.title,
      category: ev.categories?.[0]?.title || "Event",
      ts: g?.date || ev.geometry?.[0]?.date,
      lat: Array.isArray(g?.coordinates) ? g.coordinates[1] : undefined,
      lon: Array.isArray(g?.coordinates) ? g.coordinates[0] : undefined,
      url: ev.sources?.[0]?.url,
      kind: "natural-event",
    };
  });
  return { ok: true, events, source: "NASA EONET" };
}

// --- Open-Meteo current weather + short forecast -------------------------
export async function openMeteo({ lat, lon } = {}) {
  return openMeteoWeather({ lat, lon });
}

const WEATHER_DAILY = [
  "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
  "wind_gusts_10m_max", "et0_fao_evapotranspiration", "weather_code",
];

function validCoordinate(value, low, high) {
  return Number.isFinite(Number(value)) && Number(value) >= low && Number(value) <= high;
}

export async function openMeteoWeather({ lat, lon, pastDays = 60, forecastDays = 7 } = {}) {
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lon, -180, 180)) {
    return { ok: false, error: "Weather ingestion requires valid latitude and longitude." };
  }
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: "UTC",
    past_days: String(Math.max(14, Math.min(92, pastDays))),
    forecast_days: String(Math.max(1, Math.min(16, forecastDays))),
    current: "temperature_2m,precipitation,wind_speed_10m",
    daily: WEATHER_DAILY.join(","),
  });
  const url = `${API.openMeteo}?${params}`;
  const r = await getJSON(url);
  if (!r.ok || !r.data?.daily?.time) return { ok: false, status: r.status, error: r.error || "Open-Meteo weather unavailable." };
  return {
    ok: true,
    current: r.data.current,
    currentUnits: r.data.current_units || {},
    daily: r.data.daily,
    dailyUnits: r.data.daily_units || {},
    generatedMs: r.data.generationtime_ms,
    timezone: r.data.timezone,
    coordinate: { lat: r.data.latitude, lon: r.data.longitude, elevation: r.data.elevation },
    source: "Open-Meteo forecast",
    sourceUrl: url,
  };
}

export async function openMeteoHistory({ lat, lon, startDate, endDate, model = "era5" } = {}) {
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lon, -180, 180) || !startDate || !endDate) {
    return { ok: false, error: "Historical weather requires coordinates and an explicit date range." };
  }
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), start_date: startDate, end_date: endDate,
    timezone: "UTC", models: model, daily: WEATHER_DAILY.filter((item) => item !== "weather_code").join(","),
  });
  const url = `${API.openMeteoArchive}?${params}`;
  const r = await getJSON(url);
  if (!r.ok || !r.data?.daily?.time) return { ok: false, status: r.status, error: r.error || "Open-Meteo history unavailable." };
  return { ok: true, daily: r.data.daily, dailyUnits: r.data.daily_units || {}, source: "Open-Meteo historical weather", sourceUrl: url, model };
}

export async function openMeteoClimate({ lat, lon, startDate, endDate, model = "EC_Earth3P_HR" } = {}) {
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lon, -180, 180) || !startDate || !endDate) {
    return { ok: false, error: "Climate ingestion requires coordinates and an explicit date range." };
  }
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), start_date: startDate, end_date: endDate,
    models: model, daily: "temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum",
  });
  const url = `${API.openMeteoClimate}?${params}`;
  const r = await getJSON(url);
  if (!r.ok || !r.data?.daily?.time) return { ok: false, status: r.status, error: r.error || "Open-Meteo climate projections unavailable." };
  return { ok: true, daily: r.data.daily, dailyUnits: r.data.daily_units || {}, source: "Open-Meteo climate projections", sourceUrl: url, model };
}

async function dhsPaged(path, params = {}) {
  const firstParams = new URLSearchParams({ ...params, f: "json", page: "1" });
  const firstUrl = `${API.dhsProgram}/${path}?${firstParams}`;
  const first = await getJSON(firstUrl);
  if (!first.ok || !Array.isArray(first.data?.Data)) return { ok: false, status: first.status, data: [], sourceUrl: firstUrl };
  const data = [...first.data.Data];
  const pages = Math.max(1, Math.min(Number(first.data.TotalPages) || 1, 100));
  for (let page = 2; page <= pages; page += 1) {
    const pageParams = new URLSearchParams({ ...params, f: "json", page: String(page) });
    const result = await getJSON(`${API.dhsProgram}/${path}?${pageParams}`);
    if (!result.ok || !Array.isArray(result.data?.Data)) return { ok: false, partial: true, status: result.status, data, sourceUrl: firstUrl };
    data.push(...result.data.Data);
  }
  return { ok: true, data, pages, sourceUrl: firstUrl };
}

export async function dhsCountries() {
  const result = await dhsPaged("countries");
  return { ...result, source: "DHS Program API" };
}

export async function resolveDhsCountry({ iso3, name } = {}) {
  const result = await dhsCountries();
  if (!result.ok) return { ok: false, error: "DHS country catalogue unavailable." };
  const normalizedIso = String(iso3 || "").toUpperCase();
  const normalizedName = String(name || "").trim().toLowerCase();
  const country = result.data.find((item) => item.ISO3_CountryCode === normalizedIso)
    || result.data.find((item) => String(item.CountryName || "").toLowerCase() === normalizedName);
  if (!country) return { ok: false, error: `No DHS country mapping for ${iso3 || name || "scope"}.` };
  return { ok: true, country, source: result.source, sourceUrl: result.sourceUrl };
}

export async function dhsSurveys({ countryCode } = {}) {
  if (!countryCode) return { ok: false, data: [], error: "DHS country code is required." };
  const result = await dhsPaged("surveys", { countryIds: countryCode });
  return {
    ...result,
    data: (result.data || []).map((survey) => ({
      surveyId: survey.SurveyId,
      countryCode: survey.DHS_CountryCode,
      countryName: survey.CountryName,
      year: Number(survey.SurveyYear),
      type: survey.SurveyType,
      status: survey.SurveyStatus,
      fieldworkStart: survey.FieldworkStart || null,
      fieldworkEnd: survey.FieldworkEnd || null,
      releaseDate: survey.ReleaseDate || null,
      households: Number(survey.NumberofHouseholds) || null,
      women: Number(survey.NumberOfWomen) || null,
      men: Number(survey.NumberOfMen) || null,
    })),
    source: "DHS Program API",
  };
}

export async function dhsIndicatorData({ countryCode, indicatorIds, surveyIds } = {}) {
  if (!countryCode || !indicatorIds?.length) return { ok: false, data: [], error: "DHS country code and indicator ids are required." };
  const params = { countryIds: countryCode, indicatorIds: indicatorIds.join(",") };
  if (surveyIds?.length) params.surveyIds = surveyIds.join(",");
  const result = await dhsPaged("data", params);
  return { ...result, source: "DHS Program API" };
}

// --- disease.sh historical case data (epidemiology) ----------------------
// Global or country-scoped daily case counts → a real epi series for EWAR.
export async function diseaseSeries({ country, days = 30 } = {}) {
  const path = country && country !== "GLOBAL"
    ? `${API.diseaseSh}/historical/${country}?lastdays=${days}`
    : `${API.diseaseSh}/historical/all?lastdays=${days}`;
  const r = await getJSON(path);
  if (!r.ok) return { ok: false, series: [], keys: [] };
  const cases = country && country !== "GLOBAL" ? r.data?.timeline?.cases : r.data?.cases;
  if (!cases) return { ok: false, series: [], keys: [] };
  const keys = Object.keys(cases);
  const cumulative = keys.map((k) => cases[k]);
  // convert cumulative → daily new cases (non-negative)
  const series = cumulative.map((v, i) => (i === 0 ? 0 : Math.max(0, v - cumulative[i - 1])));
  return { ok: true, keys, series, source: "disease.sh" };
}

// --- CoinGecko global market + historical series (financial, keyless) -----
export async function coingeckoGlobal() {
  const r = await getJSON("https://api.coingecko.com/api/v3/global");
  if (!r.ok) return { ok: false };
  const d = r.data.data;
  return {
    ok: true,
    totalMcapUsd: d.total_market_cap?.usd,
    mcapChange24h: d.market_cap_change_percentage_24h_usd,
    btcDominance: d.market_cap_percentage?.btc,
    source: "CoinGecko",
  };
}

// 30-day price series → market-stress risk index (drawdown from running peak, 0..100).
export async function coingeckoMarketChart({ coin = "bitcoin", days = 30 } = {}) {
  const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const r = await getJSON(url);
  if (!r.ok || !r.data.prices) return { ok: false, keys: [], series: [], prices: [] };
  const prices = r.data.prices.map((p) => p[1]);
  const keys = r.data.prices.map((p) => new Date(p[0]).toISOString().slice(0, 10));
  let peak = -Infinity;
  const series = prices.map((v) => {
    peak = Math.max(peak, v);
    return Math.round(((peak - v) / peak) * 100); // drawdown % = stress
  });
  return { ok: true, keys, series, prices, source: "CoinGecko" };
}

// FX rates (keyless). Country currency depreciation vs USD = macro stress driver.
export async function fxRates({ base = "USD" } = {}) {
  const r = await getJSON(`https://open.er-api.com/v6/latest/${base}`);
  if (!r.ok || !r.data?.rates) return { ok: false, rates: {} };
  return { ok: true, rates: r.data.rates, source: "open.er-api" };
}

// --- GDELT event volume for a themed query (conflict/health/etc) ----------
export async function gdeltEvents({ query, max = 40 } = {}) {
  const url = `${API.gdelt}?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${max}&sort=datedesc&format=json`;
  const r = await getJSON(url);
  if (r.status === 429) return { ok: false, rateLimited: true, events: [] };
  if (!r.ok) return { ok: false, events: [] };
  const events = (r.data.articles || []).map((a) => ({
    id: a.url,
    title: a.title,
    outlet: a.domain,
    country: a.sourcecountry,
    ts: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : "",
    url: a.url,
    kind: "news-event",
  }));
  return { ok: true, events, source: "GDELT" };
}
