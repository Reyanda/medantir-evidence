export const TEMPORAL_ROLES = Object.freeze({
  FORECAST: "forecast",
  STRUCTURAL_BASELINE: "structural-baseline",
  OBSERVED_CONTEXT: "observed-context",
  SCENARIO_CONTEXT: "scenario-context",
});

export const INGESTION_PROTOCOLS = Object.freeze([
  {
    id: "acled-local",
    label: "ACLED local export",
    role: TEMPORAL_ROLES.OBSERVED_CONTEXT,
    cadence: "operator import",
    persistence: "derived user-scoped snapshot",
    drivesWarning: false,
    status: "wired",
    methodologyUrl: "https://acleddata.com/methodology/acled-codebook",
  },
  {
    id: "dhs-program",
    label: "DHS Program API",
    role: TEMPORAL_ROLES.STRUCTURAL_BASELINE,
    cadence: "survey release",
    persistence: "normalized metadata and selected indicators",
    drivesWarning: false,
    status: "wired",
    methodologyUrl: "https://api.dhsprogram.com/",
  },
  {
    id: "open-meteo-forecast",
    label: "Open-Meteo forecast",
    role: TEMPORAL_ROLES.FORECAST,
    cadence: "operator refresh",
    persistence: "derived feature and anomaly snapshot",
    drivesWarning: true,
    status: "wired",
    methodologyUrl: "https://open-meteo.com/en/docs",
  },
  {
    id: "open-meteo-history",
    label: "Open-Meteo historical weather",
    role: TEMPORAL_ROLES.OBSERVED_CONTEXT,
    cadence: "baseline refresh",
    persistence: "bounded training baseline",
    drivesWarning: false,
    status: "wired",
    methodologyUrl: "https://open-meteo.com/en/docs/historical-weather-api",
  },
  {
    id: "open-meteo-climate",
    label: "Open-Meteo climate projections",
    role: TEMPORAL_ROLES.SCENARIO_CONTEXT,
    cadence: "planning request",
    persistence: "scenario summary",
    drivesWarning: false,
    status: "wired",
    methodologyUrl: "https://open-meteo.com/en/docs/climate-api",
  },
]);

export function ingestionProtocol(id) {
  return INGESTION_PROTOCOLS.find((protocol) => protocol.id === id) || null;
}

export function createIngestionEnvelope({ protocolId, scope, sourceUrl, retrievedAt = new Date().toISOString(),
  period = {}, rows = 0, units = {}, warnings = [], transformations = [] } = {}) {
  const protocol = ingestionProtocol(protocolId);
  if (!protocol) throw new Error(`Unknown ingestion protocol: ${protocolId || "missing"}`);
  if (!scope?.code || !scope?.name) throw new Error("Ingestion scope requires code and name.");
  if (!sourceUrl) throw new Error("Ingestion source URL is required.");
  return {
    schemaVersion: 1,
    protocolId,
    provider: protocol.label,
    temporalRole: protocol.role,
    drivesWarning: protocol.drivesWarning,
    scope: { code: scope.code, name: scope.name, lat: scope.lat, lon: scope.lon },
    sourceUrl,
    retrievedAt,
    period,
    rows,
    units,
    warnings: [...warnings],
    transformations: [...transformations],
  };
}

export function canDriveEarlyWarning(envelope) {
  return envelope?.temporalRole === TEMPORAL_ROLES.FORECAST && envelope?.drivesWarning === true;
}
