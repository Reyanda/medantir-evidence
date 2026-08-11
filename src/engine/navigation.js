// Audited navigation policy. Permission/profile is the outer boundary; an
// operating mode is the inner visibility boundary. Unknown surfaces deny.

const MODES = ["security", "humanitarian", "academic", "clinical", "statistical", "personal"];

export const NAVIGATION_GROUPS = [
  { id: "core", label: "Intelligence Core" },
  { id: "monitors", label: "Monitoring & Early Warning" },
  { id: "markets", label: "Markets" },
  { id: "knowledge", label: "Knowledge" },
  { id: "applications", label: "Operational Applications" },
  { id: "shared", label: "Shared Tools" },
  { id: "system", label: "System Controls" },
];

export const NAVIGATION_SURFACES = [
  { id: "decision", label: "Command Centre", group: "core", modes: ["security", "humanitarian", "academic", "clinical", "statistical"], clearance: 1 },
  { id: "sentiment", label: "Media Sentiment Radar", group: "core", modes: ["security", "humanitarian"], clearance: 1 },
  { id: "power", label: "Power Network", group: "core", modes: ["security"], clearance: 2 },
  { id: "projects", label: "Projects", group: "core", modes: MODES, clearance: 1 },
  { id: "openproject", label: "OpenProject WBS", group: "core", modes: MODES, clearance: 1 },
  { id: "ontology", label: "Ontology Explorer", group: "core", modes: ["security", "academic", "clinical", "statistical"], clearance: 1 },

  { id: "climate", label: "Weather Early Warning", group: "monitors", modes: ["humanitarian", "clinical", "statistical"], clearance: 1 },
  { id: "epi", label: "Epidemiological EWAR", group: "monitors", modes: ["humanitarian", "clinical", "statistical"], clearance: 1 },
  { id: "conflict", label: "Conflict Monitor", group: "monitors", modes: ["security", "humanitarian"], clearance: 2, military: true, militaryModes: ["security"], accessByMode: { humanitarian: "read-only" } },
  { id: "cyber", label: "Cyber Engine", group: "monitors", modes: ["security"], clearance: 2, military: true },

  { id: "financial", label: "Markets", group: "markets", modes: ["statistical", "personal"], clearance: 1 },

  { id: "review", label: "Evidence", group: "knowledge", modes: ["humanitarian", "academic", "clinical", "statistical"], clearance: 1 },
  { id: "personal", label: "Personal (Ascent)", group: "knowledge", modes: ["personal"], clearance: 1 },

  { id: "ide", label: "IDE", group: "applications", modes: ["security", "academic", "statistical"], clearance: 1 },
  { id: "resources", label: "Essential Resources", group: "applications", modes: ["humanitarian", "academic", "clinical"], clearance: 1 },
  { id: "triangulation", label: "Causal Triangulation", group: "applications", modes: ["humanitarian", "academic", "clinical", "statistical"], clearance: 1 },

  { id: "browser", label: "Web Browser", group: "shared", kind: "shared", modes: MODES, clearance: 1 },
  { id: "skills", label: "Skills Engine", group: "shared", kind: "shared", modes: MODES, clearance: 1 },

  { id: "vault", label: "Security & Vault", group: "system", kind: "system", modes: MODES, clearance: 2 },
  { id: "providers", label: "AI Providers", group: "system", kind: "system", modes: MODES, clearance: 2 },
  { id: "protocols", label: "Agentic Protocols", group: "system", kind: "system", modes: MODES, clearance: 2 },
  { id: "interop", label: "Connectors", group: "system", kind: "system", modes: MODES, clearance: 2 },

  { id: "modules", label: "Module Registry", group: "system", kind: "mode-catalogue", modes: MODES, clearance: 1, hiddenFromSidebar: true },
];

const ALIASES = {
  academic: "review",
  closedloop: "review",
  dashboard: "decision",
  canvas: "decision",
  harness: "projects",
  workspace: "projects",
};

const COMMAND_CENTRE_VIEWS = {
  security: ["summary", "canvas", "map", "evidence", "scenarios", "actions", "audit"],
  humanitarian: ["summary", "canvas", "map", "evidence", "scenarios", "actions", "audit"],
  clinical: ["summary", "canvas", "map", "evidence", "scenarios", "actions", "audit"],
  academic: ["canvas", "map", "evidence", "audit"],
  statistical: ["canvas", "map", "evidence", "audit"],
};

export function commandCentreViews(modeId) {
  return COMMAND_CENTRE_VIEWS[modeId] || [];
}

export function commandCentreDefaultView(modeId) {
  return commandCentreViews(modeId)[0] || "summary";
}

export const SURFACE_BY_ID = Object.fromEntries(NAVIGATION_SURFACES.map((surface) => [surface.id, surface]));

export function canonicalSurfaceId(id) {
  return ALIASES[id] || id;
}

export function getSurface(id) {
  return SURFACE_BY_ID[canonicalSurfaceId(id)] || null;
}

export function surfaceAccess(id, modeId, session = {}) {
  const surface = getSurface(id);
  if (!surface || !surface.modes.includes(modeId)) return "denied";
  if ((session.clearance ?? 0) < surface.clearance) return "denied";
  const militaryInMode = surface.military && (!surface.militaryModes || surface.militaryModes.includes(modeId));
  if (militaryInMode && session.noMilitary) return "denied";
  return surface.accessByMode?.[modeId] || "full";
}

export function surfaceVisible(id, modeId, session = {}) {
  return surfaceAccess(id, modeId, session) !== "denied";
}

export function surfacesForMode(modeId, session = {}, { includeHidden = false } = {}) {
  return NAVIGATION_SURFACES.filter((surface) => (includeHidden || !surface.hiddenFromSidebar) && surfaceVisible(surface.id, modeId, session));
}

export function groupedSurfacesForMode(modeId, session = {}) {
  const visible = surfacesForMode(modeId, session);
  return NAVIGATION_GROUPS.map((group) => ({ ...group, surfaces: visible.filter((surface) => surface.group === group.id) })).filter((group) => group.surfaces.length);
}

export function firstSurfaceForMode(modeId, session = {}) {
  const primary = NAVIGATION_SURFACES.find((surface) => surface.group !== "shared" && surface.group !== "system" && !surface.hiddenFromSidebar && surfaceVisible(surface.id, modeId, session));
  return primary?.id || surfacesForMode(modeId, session)[0]?.id || "projects";
}
