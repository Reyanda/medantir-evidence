// session.js — User identity, access scope, and geolocation.
//
// Access model: a user has a SCOPE (global or a single country) and a CLEARANCE
// that gates which intelligence engines are available. User 1 (the operator) has
// global scope and full clearance — every engine including the military/defence one.
// Country-scoped users see only their country's data and the civil engines.
//
// Scope is a real filter, not decoration: monitors and the map read
// session.scope to constrain queries (bbox / country code) and hide gated engines.

import { getSurface, surfaceVisible, NAVIGATION_SURFACES } from "./navigation.js";

const KEY = "medantir.session.v1";

// Engines the platform exposes — derived from the navigation registry (single
// source of truth for id/label/clearance/military). Excludes `applications` and
// `system` groups: those are tools/controls, not domain engines.
export const ENGINES = NAVIGATION_SURFACES
  .filter((surface) => ["core", "monitors", "markets", "knowledge", "shared"].includes(surface.group))
  .map(({ id, label, clearance, military }) => ({ id, label, clearance, military: !!military }));

// Hierarchical geolocator: World → continent → subregion → country. Drill down as
// far as needed; any node is selectable as scope. `bbox` = [west, south, east, north]
// for spatial API queries; centroid drives the map. Default scope is GLOBAL.
export const GEO_TREE = {
  code: "GLOBAL", name: "Global", lat: 10, lon: 20, bbox: [-180, -60, 180, 78],
  children: [
    { code: "AFR", name: "Africa", lat: 4, lon: 20, bbox: [-18, -35, 52, 38], children: [
      { code: "AFR-E", name: "East Africa", lat: 0, lon: 37, bbox: [28, -12, 52, 18], children: [
        { code: "KEN", name: "Kenya", lat: -0.02, lon: 37.9, bbox: [33.9, -4.7, 41.9, 5.5] },
        { code: "ETH", name: "Ethiopia", lat: 9.1, lon: 40.5, bbox: [33.0, 3.4, 48.0, 14.9] },
        { code: "SOM", name: "Somalia", lat: 5.2, lon: 46.2, bbox: [40.9, -1.7, 51.4, 12.0] },
        { code: "SSD", name: "South Sudan", lat: 7.3, lon: 30.0, bbox: [24.1, 3.5, 35.9, 12.2] },
        { code: "UGA", name: "Uganda", lat: 1.4, lon: 32.3, bbox: [29.6, -1.5, 35.0, 4.2] },
        { code: "TZA", name: "Tanzania", lat: -6.4, lon: 34.9, bbox: [29.3, -11.7, 40.4, -1.0] },
        { code: "RWA", name: "Rwanda", lat: -1.9, lon: 29.9, bbox: [28.9, -2.9, 30.9, -1.0] },
      ] },
      { code: "AFR-W", name: "West Africa", lat: 10, lon: 0, bbox: [-18, 4, 16, 27], children: [
        { code: "NGA", name: "Nigeria", lat: 9.1, lon: 8.7, bbox: [2.7, 4.3, 14.7, 13.9] },
        { code: "GHA", name: "Ghana", lat: 7.9, lon: -1.0, bbox: [-3.3, 4.7, 1.2, 11.2] },
        { code: "MLI", name: "Mali", lat: 17.6, lon: -4.0, bbox: [-12.2, 10.1, 4.3, 25.0] },
        { code: "NER", name: "Niger", lat: 17.6, lon: 8.1, bbox: [0.2, 11.7, 16.0, 23.5] },
      ] },
      { code: "AFR-C", name: "Central Africa", lat: 2, lon: 20, bbox: [8, -14, 32, 12], children: [
        { code: "COD", name: "DR Congo", lat: -4.0, lon: 21.8, bbox: [12.2, -13.5, 31.3, 5.4] },
        { code: "TCD", name: "Chad", lat: 15.4, lon: 18.7, bbox: [13.5, 7.4, 24.0, 23.4] },
      ] },
      { code: "AFR-N", name: "North Africa", lat: 27, lon: 20, bbox: [-13, 15, 37, 37], children: [
        { code: "SDN", name: "Sudan", lat: 15.5, lon: 30.2, bbox: [21.8, 8.7, 38.6, 22.2] },
        { code: "EGY", name: "Egypt", lat: 26.8, lon: 30.8, bbox: [24.7, 22.0, 36.9, 31.7] },
      ] },
      { code: "AFR-S", name: "Southern Africa", lat: -22, lon: 26, bbox: [11, -35, 41, -8], children: [
        { code: "ZWE", name: "Zimbabwe", lat: -19.0, lon: 29.9, bbox: [25.2, -22.4, 33.1, -15.6] },
        { code: "MWI", name: "Malawi", lat: -13.3, lon: 34.3, bbox: [32.7, -17.1, 35.9, -9.4] },
        { code: "MOZ", name: "Mozambique", lat: -18.7, lon: 35.5, bbox: [30.2, -26.9, 40.8, -10.5] },
        { code: "ZAF", name: "South Africa", lat: -30.6, lon: 22.9, bbox: [16.5, -34.8, 32.9, -22.1] },
      ] },
    ] },
    { code: "ASIA", name: "Asia", lat: 30, lon: 90, bbox: [40, 5, 145, 55], children: [
      { code: "ASIA-S", name: "South Asia", lat: 22, lon: 79, bbox: [60, 5, 92, 37], children: [
        { code: "IND", name: "India", lat: 22.0, lon: 79.0, bbox: [68.1, 6.5, 97.4, 35.5] },
        { code: "PAK", name: "Pakistan", lat: 30.4, lon: 69.3, bbox: [60.9, 23.7, 77.8, 37.1] },
      ] },
      { code: "ASIA-E", name: "East Asia", lat: 35, lon: 105, bbox: [73, 18, 145, 53], children: [
        { code: "CHN", name: "China", lat: 35.0, lon: 103.0, bbox: [73.5, 18.2, 135.0, 53.6] },
      ] },
      { code: "ASIA-ME", name: "Middle East", lat: 25, lon: 45, bbox: [34, 12, 60, 39], children: [
        { code: "YEM", name: "Yemen", lat: 15.6, lon: 48.0, bbox: [42.6, 12.1, 54.5, 19.0] },
      ] },
    ] },
    { code: "EUR", name: "Europe", lat: 52, lon: 15, bbox: [-11, 35, 40, 60], children: [
      { code: "GBR", name: "United Kingdom", lat: 54.0, lon: -2.0, bbox: [-8.6, 49.9, 1.8, 58.7] },
      { code: "UKR", name: "Ukraine", lat: 48.4, lon: 31.2, bbox: [22.1, 44.4, 40.2, 52.4] },
    ] },
    { code: "AMER", name: "Americas", lat: 15, lon: -80, bbox: [-130, -55, -34, 55], children: [
      { code: "USA", name: "United States", lat: 39.8, lon: -98.6, bbox: [-125, 24, -66, 49] },
      { code: "BRA", name: "Brazil", lat: -10.8, lon: -52.9, bbox: [-74, -34, -34, 5] },
    ] },
  ],
};

// Flatten the tree to a code→node lookup so the rest of the app (currentLocation,
// monitors) keeps working with any selected level.
function flattenGeo(node, parent, out = []) {
  out.push({ code: node.code, name: node.name, lat: node.lat, lon: node.lon, bbox: node.bbox, parent: parent?.code || null, hasChildren: !!node.children });
  for (const c of node.children || []) flattenGeo(c, node, out);
  return out;
}
export const LOCATIONS = flattenGeo(GEO_TREE);
export function geoChildren(code) {
  const find = (n) => (n.code === code ? n : (n.children || []).map(find).find(Boolean));
  return (find(GEO_TREE)?.children) || [];
}
export function geoPath(code) {
  const path = [];
  const walk = (n, trail) => {
    if (n.code === code) { path.push(...trail, n); return true; }
    return (n.children || []).some((c) => walk(c, [...trail, n]));
  };
  walk(GEO_TREE, []);
  return path;
}

// Deployment tiers — the same platform, provisioned for different institutions.
// `engines: null` = all (subject to clearance); otherwise an explicit allowlist.
// Profiles set the outer clearance boundary. Operating mode applies the narrower
// domain visibility policy; a mode can never raise the profile's permission.
export const PROFILES = [
  { id: "operator", name: "Operator (full)", clearance: 4, noMilitary: false,
    note: "Global clearance across authorised operating modes, including Security & Military." },
  { id: "nsa", name: "National Security (NSA)", clearance: 4, noMilitary: false,
    note: "Organisational access including Security & Military; Personal remains excluded." },
  { id: "humanitarian", name: "Humanitarian", clearance: 2, noMilitary: true,
    note: "Humanitarian, clinical, statistical, and academic modes. No military actions." },
  { id: "academic", name: "Academic", clearance: 2, noMilitary: true,
    note: "Academic, clinical, statistical, and humanitarian research modes. No military surfaces." },
  { id: "personal", name: "Personal (Ascent)", clearance: 2, noMilitary: true,
    note: "Personal, academic, and statistical work only. No organisational intelligence or military surfaces." },
];

const DEFAULT_SESSION = {
  userId: "user-1",
  name: "Operator 1",
  clearance: 4, // full clearance
  scope: "GLOBAL", // location code
  scopeKind: "aggregate", // aggregate hierarchy node or atomic gazetteer place
  profile: "operator",
  activeMode: "all",
  allModeTab: "security",
  activeTab: "projects",
  detachedProject: null,
};

export function applyProfile(id) {
  const p = PROFILES.find((x) => x.id === id) || PROFILES[0];
  return saveSession({ profile: p.id, clearance: p.clearance });
}

function activeProfile() {
  const s = loadSession();
  return PROFILES.find((p) => p.id === s.profile) || PROFILES[0];
}

export function loadSession() {
  try {
    return { ...DEFAULT_SESSION, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SESSION };
  }
}

export function saveSession(patch) {
  const s = { ...loadSession(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  return s;
}

export function currentLocation() {
  const s = loadSession();
  // an OSM-selected place (or any custom location) is stored whole in scopeLoc
  if (s.scopeLoc && s.scopeLoc.bbox) return { ...s.scopeLoc, scopeKind: s.scopeKind || (s.scopeLoc.osm ? "atomic" : "aggregate") };
  return { ...(LOCATIONS.find((l) => l.code === s.scope) || LOCATIONS[0]), scopeKind: s.scopeKind || "aggregate" };
}

// Set scope from a full location object (tree node OR OSM geocode result).
export function setScopeLocation(loc, kind = loc?.osm ? "atomic" : "aggregate") {
  if (!loc?.code || !loc?.bbox) return loadSession();
  const scopeKind = kind === "atomic" ? "atomic" : "aggregate";
  return saveSession({ scope: loc.code, scopeKind, scopeLoc: { ...loc, scopeKind } });
}

export function isGlobal() {
  return loadSession().scope === "GLOBAL";
}

// Engines the current user may access: clearance-gated; military engines are hidden
// for civilian profiles. All other tools are domain-agnostic and always available.
export function availableEngines(modeId) {
  const s = loadSession();
  const prof = activeProfile();
  const effectiveMode = modeId || (s.activeMode === "all" ? s.allModeTab : s.activeMode);
  return ENGINES.filter((e) => {
    if (s.clearance < e.clearance || (prof.noMilitary && e.military)) return false;
    if (!effectiveMode) return true;
    return canAccess(e.id, effectiveMode);
  });
}

export function canAccess(engineId, modeId) {
  const surface = getSurface(engineId);
  if (!surface) return false;
  const s = loadSession();
  const prof = activeProfile();
  const effectiveMode = modeId || (s.activeMode === "all" ? s.allModeTab : s.activeMode);
  return !!effectiveMode && surfaceVisible(surface.id, effectiveMode, { clearance: s.clearance, noMilitary: prof.noMilitary });
}
