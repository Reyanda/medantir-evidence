import { loadSession } from "./session.js";

export const OPERATING_MODES = [
  {
    id: "all",
    name: "All-source",
    short: "All",
    color: "#2563eb",
    description: "Cross-domain work with every capability allowed by the user's clearance.",
    deniedCapabilities: [],
  },
  {
    id: "security",
    name: "Security & Military",
    short: "Security & Military",
    color: "#e11d48",
    description: "Threat, cyber, conflict, defence, and high-assurance decision workflows.",
    deniedCapabilities: ["personal"],
  },
  {
    id: "humanitarian",
    name: "Humanitarian",
    short: "Humanitarian",
    color: "#f97316",
    description: "Needs, response, protection, public-health, and non-military early warning.",
    deniedCapabilities: ["military", "offensive-cyber"],
  },
  {
    id: "academic",
    name: "Academic",
    short: "Academic",
    color: "#4f46e5",
    description: "Research, evidence synthesis, provenance, publication, and reproducibility.",
    deniedCapabilities: ["military", "offensive-cyber"],
  },
  {
    id: "clinical",
    name: "Clinical",
    short: "Clinical",
    color: "#0d9488",
    description: "Clinical evidence and decision support with conservative human gates.",
    deniedCapabilities: ["military", "offensive-cyber"],
  },
  {
    id: "statistical",
    name: "Statistical",
    short: "Statistics",
    color: "#7c3aed",
    description: "Analysis, simulation, modelling, uncertainty, and visualisation.",
    deniedCapabilities: ["military", "offensive-cyber"],
  },
  {
    id: "personal",
    name: "Personal",
    short: "Personal",
    color: "#059669",
    description: "Private planning, finance, scheduling, files, and personal agent workflows.",
    deniedCapabilities: ["military", "offensive-cyber", "organisation-admin"],
  },
];

export const MODE_BY_ID = Object.fromEntries(OPERATING_MODES.map((mode) => [mode.id, mode]));

const PROFILE_MODES = {
  operator: OPERATING_MODES.map((mode) => mode.id),
  nsa: ["all", "security", "humanitarian", "academic", "clinical", "statistical"],
  humanitarian: ["humanitarian", "clinical", "statistical", "academic"],
  academic: ["academic", "clinical", "statistical", "humanitarian"],
  personal: ["personal", "academic", "statistical"],
};

const DOMAIN_MODE = {
  academic: "academic",
  research: "academic",
  health: "clinical",
  clinical: "clinical",
  statistics: "statistical",
  statistical: "statistical",
  humanitarian: "humanitarian",
  defence: "security",
  security: "security",
  cyber: "security",
  personal: "personal",
};

export function getOperatingMode(id) {
  return MODE_BY_ID[id] || MODE_BY_ID.academic;
}

export function allowedModes(profileId = loadSession().profile) {
  const ids = PROFILE_MODES[profileId] || PROFILE_MODES.academic;
  return ids.map((id) => MODE_BY_ID[id]).filter(Boolean);
}

export function allowedContentModes(profileId = loadSession().profile) {
  return allowedModes(profileId).filter((mode) => mode.id !== "all");
}

export function canUseMode(modeId, profileId = loadSession().profile) {
  return allowedModes(profileId).some((mode) => mode.id === modeId);
}

export function defaultMode(profileId = loadSession().profile) {
  if (profileId === "operator" || profileId === "nsa") return "all";
  if (profileId === "humanitarian") return "humanitarian";
  if (profileId === "personal") return "personal";
  return "academic";
}

export function defaultAllModeTab(profileId = loadSession().profile) {
  if (profileId === "operator" || profileId === "nsa") return "security";
  return allowedContentModes(profileId)[0]?.id || "academic";
}

export function normaliseModeSelection(modeId, profileId = loadSession().profile) {
  return canUseMode(modeId, profileId) ? modeId : defaultMode(profileId);
}

export function resolveEffectiveMode(activeMode, allModeTab, profileId = loadSession().profile) {
  const selected = normaliseModeSelection(activeMode, profileId);
  if (selected !== "all") return selected;
  const permitted = allowedContentModes(profileId).map((mode) => mode.id);
  return permitted.includes(allModeTab) ? allModeTab : (permitted[0] || "academic");
}

export function modeFromDomain(domain, profileId = loadSession().profile) {
  const profileDefault = defaultMode(profileId);
  const contentDefault = profileDefault === "all" ? "academic" : profileDefault;
  const candidate = DOMAIN_MODE[String(domain || "").toLowerCase()] || contentDefault;
  return canUseMode(candidate, profileId) && candidate !== "all" ? candidate : contentDefault;
}

export function resolveProjectMode(project, profileId = loadSession().profile) {
  const candidate = project?.mode || modeFromDomain(project?.domain, profileId);
  return candidate !== "all" && canUseMode(candidate, profileId) ? candidate : modeFromDomain(project?.domain, profileId);
}

export function modeAllows(modeId, capability) {
  const mode = getOperatingMode(modeId);
  return !mode.deniedCapabilities.includes(capability);
}

const MODE_DENIED_TOOLS = {
  humanitarian: ["call_module", "mcp_tool"],
  academic: ["call_module", "mcp_tool"],
  clinical: ["call_module", "mcp_tool"],
  statistical: ["call_module", "mcp_tool"],
  personal: ["call_module", "mcp_tool"],
};

export function filterToolsForMode(modeId, tools = []) {
  const denied = new Set(MODE_DENIED_TOOLS[modeId] || []);
  return [...new Set(tools)].filter((tool) => !denied.has(tool));
}

export function modeContext(project, profileId = loadSession().profile) {
  const mode = getOperatingMode(resolveProjectMode(project, profileId));
  return {
    ...mode,
    profileId,
    allowed: canUseMode(mode.id, profileId),
  };
}
