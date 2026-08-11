// Local ACLED CSV ingestion. Raw licensed rows never leave the browser and are
// never bundled with Medantir; only compact, user-scoped descriptive summaries
// are persisted.

import { currentUser } from "./accounts.js";

export const ACLED_CODEBOOK_URL = "https://acleddata.com/methodology/acled-codebook";
export const ACLED_EULA_URL = "https://acleddata.com/eula";
export const ACLED_ATTRIBUTION_URL = "https://acleddata.com/attributionpolicy";

export const ACLED_EVENT_TAXONOMY = {
  Battles: ["Armed clash", "Government regains territory", "Non-state actor overtakes territory"],
  "Explosions/Remote violence": ["Air/drone strike", "Chemical weapon", "Grenade", "Remote explosive/land mine/IED", "Shelling/artillery/missile attack", "Suicide bomb"],
  Protests: ["Excessive force against protesters", "Peaceful protest", "Protest with intervention"],
  Riots: ["Mob violence", "Violent demonstration"],
  "Strategic developments": ["Agreement", "Arrests", "Change to group/activity", "Disrupted weapons use", "Headquarters or base established", "Looting/property destruction", "Non-violent transfer of territory", "Other"],
  "Violence against civilians": ["Abduction/forced disappearance", "Attack", "Sexual violence"],
};

export const ACLED_DISORDER_TYPES = ["Political violence", "Demonstrations", "Strategic developments"];
export const ACLED_ACTOR_TYPES = {
  1: "State Forces",
  2: "Rebel Groups",
  3: "Political Militias",
  4: "Identity Militias",
  5: "Rioters",
  6: "Protesters",
  7: "Civilians",
  8: "External/Other Forces",
};

const REQUIRED_COLUMNS = [
  "event_id_cnty", "event_date", "disorder_type", "event_type", "sub_event_type",
  "actor1", "inter1", "interaction", "civilian_targeting", "country", "location",
  "latitude", "longitude", "time_precision", "geo_precision", "source_scale",
  "fatalities", "timestamp",
];
const STORE_KEY = "medantir.acled.v1";
const MAX_SCOPES_PER_USER = 3;
const MAX_RECENT_EVENTS = 250;

const normalize = (value) => String(value || "").trim().toLowerCase();
const bump = (map, key, amount = 1) => {
  const value = String(key || "Unknown").trim() || "Unknown";
  map[value] = (map[value] || 0) + amount;
};
const numeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function detectAcledDelimiter(headerText) {
  const line = String(headerText || "").replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons > commas ? ";" : ",";
}

// Streaming RFC-4180-style parser with escaped quotes and quoted newlines.
export async function parseDelimitedChunks(chunks, delimiter, onRow) {
  let row = [];
  let field = "";
  let insideQuotes = false;
  let quotePending = false;
  let rows = 0;

  const emit = () => {
    row.push(field);
    field = "";
    const current = row;
    row = [];
    rows += 1;
    onRow(current, rows);
  };

  for await (const chunk of chunks) {
    for (const char of String(chunk)) {
      if (insideQuotes) {
        if (quotePending) {
          if (char === '"') {
            field += '"';
            quotePending = false;
            continue;
          }
          insideQuotes = false;
          quotePending = false;
          // The current character terminates the quoted field/record and is
          // processed by the normal branch below.
        } else if (char === '"') {
          quotePending = true;
          continue;
        } else {
          field += char;
          continue;
        }
      }

      if (char === '"' && field === "") insideQuotes = true;
      else if (char === delimiter) { row.push(field); field = ""; }
      else if (char === "\n") emit();
      else if (char !== "\r") field += char;
    }
  }

  if (quotePending) { insideQuotes = false; quotePending = false; }
  const trailing = field.length > 0 || row.length > 0;
  if (trailing) emit();
  return { rows, incompleteQuote: insideQuotes || quotePending, hadTrailingRecord: trailing };
}

function textChunks(text, size = 64 * 1024) {
  return (async function* chunks() {
    for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size);
  })();
}

function fileChunks(file) {
  if (file.stream && typeof TextDecoderStream !== "undefined") {
    return file.stream().pipeThrough(new TextDecoderStream("utf-8"));
  }
  return (async function* fallback() { yield await file.text(); })();
}

function scopeAliases(scope) {
  const aliases = {
    "DR Congo": ["Democratic Republic of Congo"],
    "East Africa": ["Eastern Africa"],
    "West Africa": ["Western Africa"],
    "Central Africa": ["Middle Africa", "Central Africa"],
    "North Africa": ["Northern Africa"],
    "South Asia": ["Southern Asia"],
    "East Asia": ["Eastern Asia"],
  };
  return [scope.name, ...(aliases[scope.name] || [])].map(normalize);
}

export function rowMatchesScope(record, scope) {
  if (!scope || scope.code === "GLOBAL") return true;
  const aliases = scopeAliases(scope);
  const country = normalize(record.country);
  const region = normalize(record.region);
  if (aliases.includes(country) || aliases.includes(region)) return true;
  if (scope.code === "AFR") return region.includes("africa");
  if (scope.code === "ASIA") return region.includes("asia") || region.includes("middle east");
  if (scope.code === "EUR") return region.includes("europe");
  if (scope.code === "AMER") return region.includes("america") || region.includes("caribbean");
  return false;
}

function createAccumulator(scope, fileMeta) {
  return {
    scope: { code: scope?.code || "GLOBAL", name: scope?.name || "Global" },
    file: fileMeta,
    rowsRead: 0,
    matchedRows: 0,
    malformedRows: 0,
    duplicateIds: 0,
    firstEventDate: null,
    lastEventDate: null,
    latestSourceTimestamp: 0,
    totals: { events: 0, politicalViolence: 0, demonstrations: 0, strategicDevelopments: 0, civilianTargeting: 0, reportedFatalities: 0, eventsWithReportedFatalities: 0 },
    disorderTypes: {}, eventTypes: {}, subEventTypes: {}, actorTypes: {}, interactions: {},
    countries: {}, timePrecision: {}, geoPrecision: {}, sourceScale: {},
    dailyPoliticalViolence: {}, monthlyEvents: {},
    recentEvents: [],
    unknownDisorderTypes: {}, unknownEventTypes: {}, unknownSubEventTypes: {}, unknownActorCodes: {},
    _ids: new Set(),
  };
}

function pushRecent(acc, event) {
  acc.recentEvents.push(event);
  if (acc.recentEvents.length > MAX_RECENT_EVENTS * 2) {
    acc.recentEvents.sort((a, b) => b.ts.localeCompare(a.ts));
    acc.recentEvents.length = MAX_RECENT_EVENTS;
  }
}

function consumeRecord(acc, record) {
  acc.rowsRead += 1;
  if (!rowMatchesScope(record, acc.scope)) return;
  acc.matchedRows += 1;
  const id = record.event_id_cnty;
  if (id && acc._ids.has(id)) { acc.duplicateIds += 1; return; }
  if (id) acc._ids.add(id);

  const date = record.event_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) { acc.malformedRows += 1; return; }
  acc.firstEventDate = !acc.firstEventDate || date < acc.firstEventDate ? date : acc.firstEventDate;
  acc.lastEventDate = !acc.lastEventDate || date > acc.lastEventDate ? date : acc.lastEventDate;
  acc.latestSourceTimestamp = Math.max(acc.latestSourceTimestamp, numeric(record.timestamp));

  const disorder = record.disorder_type || "Unknown";
  const eventType = record.event_type || "Unknown";
  const subEventType = record.sub_event_type || "Unknown";
  const fatalities = Math.max(0, numeric(record.fatalities));
  const civilianTargeting = normalize(record.civilian_targeting) === "civilian targeting";

  acc.totals.events += 1;
  acc.totals.reportedFatalities += fatalities;
  if (fatalities > 0) acc.totals.eventsWithReportedFatalities += 1;
  if (civilianTargeting) acc.totals.civilianTargeting += 1;
  if (disorder === "Political violence") {
    acc.totals.politicalViolence += 1;
    bump(acc.dailyPoliticalViolence, date);
  } else if (disorder === "Demonstrations") acc.totals.demonstrations += 1;
  else if (disorder === "Strategic developments") acc.totals.strategicDevelopments += 1;

  bump(acc.disorderTypes, disorder);
  bump(acc.eventTypes, eventType);
  bump(acc.subEventTypes, subEventType);
  bump(acc.interactions, record.interaction || "Unknown");
  bump(acc.countries, record.country || "Unknown");
  bump(acc.timePrecision, record.time_precision || "Unknown");
  bump(acc.geoPrecision, record.geo_precision || "Unknown");
  bump(acc.sourceScale, record.source_scale || "Unknown");
  bump(acc.monthlyEvents, date.slice(0, 7));

  for (const code of [record.inter1, record.inter2].filter(Boolean)) {
    const label = ACLED_ACTOR_TYPES[Number(code)];
    if (label) bump(acc.actorTypes, label);
    else bump(acc.unknownActorCodes, code);
  }
  if (!ACLED_DISORDER_TYPES.includes(disorder)) bump(acc.unknownDisorderTypes, disorder);
  if (!ACLED_EVENT_TAXONOMY[eventType]) bump(acc.unknownEventTypes, eventType);
  else if (!ACLED_EVENT_TAXONOMY[eventType].includes(subEventType)) bump(acc.unknownSubEventTypes, subEventType);

  pushRecent(acc, {
    id,
    kind: "conflict",
    ts: date,
    title: `${eventType} · ${subEventType} · ${record.location || record.admin1 || record.country}`,
    lat: Number.isFinite(Number(record.latitude)) ? Number(record.latitude) : null,
    lon: Number.isFinite(Number(record.longitude)) ? Number(record.longitude) : null,
    country: record.country || "",
    actor1: record.actor1 || "",
    interaction: record.interaction || "",
    civilianTargeting,
    reportedFatalities: fatalities,
    timePrecision: record.time_precision || "",
    geoPrecision: record.geo_precision || "",
  });
}

function finalizeAccumulator(acc, parserResult, headerLength, lastRowLength) {
  if (parserResult.incompleteQuote || (parserResult.hadTrailingRecord && lastRowLength !== headerLength)) {
    throw new Error("The ACLED export appears truncated or is still downloading; the final CSV record is incomplete.");
  }
  acc.recentEvents.sort((a, b) => b.ts.localeCompare(a.ts));
  acc.recentEvents.length = Math.min(acc.recentEvents.length, MAX_RECENT_EVENTS);
  delete acc._ids;
  return {
    schemaVersion: 1,
    provider: "ACLED",
    importedAt: new Date().toISOString(),
    methodology: {
      unit: "ACLED event",
      taxonomy: "3 disorder types · 6 event types · 25 sub-event types",
      fatalities: "Reported conservative estimates; 0 means no reported fatality information.",
      civilianTargeting: "Direct/intentional targeting as coded by ACLED; incidental harm is excluded.",
      codebook: ACLED_CODEBOOK_URL,
      attribution: "Data source: Armed Conflict Location & Event Data (ACLED). Derived locally by Medantir.",
    },
    ...acc,
    diagnostics: {
      unknownDisorderTypes: acc.unknownDisorderTypes,
      unknownEventTypes: acc.unknownEventTypes,
      unknownSubEventTypes: acc.unknownSubEventTypes,
      unknownActorCodes: acc.unknownActorCodes,
    },
  };
}

async function importChunks(chunks, delimiter, scope, fileMeta, onProgress) {
  let headers = null;
  let headerLength = 0;
  let lastRowLength = 0;
  let acc = null;
  const parserResult = await parseDelimitedChunks(chunks, delimiter, (values, rowNumber) => {
    lastRowLength = values.length;
    if (!headers) {
      headers = values.map((value) => normalize(value.replace(/^\uFEFF/, "")));
      headerLength = headers.length;
      const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
      if (missing.length) throw new Error(`Not a compatible ACLED export. Missing columns: ${missing.join(", ")}`);
      acc = createAccumulator(scope, fileMeta);
      return;
    }
    if (values.length !== headerLength) { acc.malformedRows += 1; return; }
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    consumeRecord(acc, record);
    if (rowNumber % 5000 === 0) onProgress?.({ rows: acc.rowsRead, matched: acc.matchedRows });
  });
  if (!headers || !acc) throw new Error("The ACLED CSV is empty.");
  const snapshot = finalizeAccumulator(acc, parserResult, headerLength, lastRowLength);
  onProgress?.({ rows: snapshot.rowsRead, matched: snapshot.matchedRows, done: true });
  return snapshot;
}

export async function importAcledText(text, { scope = { code: "GLOBAL", name: "Global" }, fileName = "acled.csv", onProgress } = {}) {
  const delimiter = detectAcledDelimiter(text.slice(0, 4096));
  return importChunks(textChunks(text), delimiter, scope, { name: fileName, size: text.length, lastModified: null }, onProgress);
}

export async function importAcledFile(file, { scope = { code: "GLOBAL", name: "Global" }, onProgress } = {}) {
  if (!file) throw new Error("Choose an ACLED CSV file.");
  if (/\.crdownload$/i.test(file.name)) throw new Error("This Chrome download is incomplete. Wait until it becomes a .csv file.");
  const delimiter = detectAcledDelimiter(await file.slice(0, 4096).text());
  return importChunks(fileChunks(file), delimiter, scope, { name: file.name, size: file.size, lastModified: file.lastModified || null }, onProgress);
}

function storeState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch { return {}; }
}

function userKey() {
  return normalize(currentUser()?.email || "anonymous");
}

export function saveAcledSnapshot(snapshot) {
  const state = storeState();
  const user = userKey();
  const scopes = { ...(state[user] || {}), [snapshot.scope.code]: snapshot };
  const keep = Object.entries(scopes)
    .sort((a, b) => String(b[1].importedAt).localeCompare(String(a[1].importedAt)))
    .slice(0, MAX_SCOPES_PER_USER);
  state[user] = Object.fromEntries(keep);
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  return snapshot;
}

export function loadAcledSnapshot(scope = { code: "GLOBAL" }) {
  return storeState()[userKey()]?.[scope.code] || null;
}

export function clearAcledSnapshot(scope = { code: "GLOBAL" }) {
  const state = storeState();
  const user = userKey();
  if (!state[user]?.[scope.code]) return false;
  delete state[user][scope.code];
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  return true;
}

export function acledDailySeries(snapshot, days = 30) {
  if (!snapshot?.lastEventDate) return { keys: [], series: [] };
  const end = new Date(`${snapshot.lastEventDate}T00:00:00Z`);
  const keys = [];
  const series = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    keys.push(key);
    series.push(snapshot.dailyPoliticalViolence[key] || 0);
  }
  return { keys, series };
}

export function topCounts(counts, limit = 5) {
  return Object.entries(counts || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
