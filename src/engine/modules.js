// modules.js — Module Registry: the "everything engine" surface.
//
// Rather than physically fusing dozens of Python/R/Swift repos into this Vite app
// (impossible and unwise), each of the operator's software projects is registered
// here as a MODULE with a domain, capabilities, integration status, and — where it
// exposes one — an HTTP API the agent can call. This is how Medantir becomes the
// shell for the whole portfolio: data merges (like MapIt) become native ontology,
// service apps (khwelero, redteam, resource-shrimp) become callable connectors, and
// research/tools deep-link to their live deployment.
//
// status: "merged" (native in ontology) | "connector" (callable API) | "link" (deep-link)

import autoMods from "../data/modules.json";
import modeMembership from "../data/mode-membership.json";
import { cloudAuthEnabled, cloudAuthHeaders, cloudCurrentUser } from "./cloudAuth.js";

// Hand-curated modules with rich API/engine metadata.
const CURATED = [
  // --- merged natively -------------------------------------------------
  { id: "mapit", name: "MapIt — Power Network", domain: "power", status: "merged",
    capabilities: ["ownership graph", "influence ranking"], repo: "Reyanda/map-of-time",
    note: "366 entities / 255 ownership edges ingested into the ontology as PowerNodes." },

  // --- service connectors (expose an HTTP API) -------------------------
  { id: "khwelero", name: "Khwelero PaaS", domain: "infra", status: "connector",
    api: "https://api.actiora.com/khwelero", capabilities: ["deploy", "TLS routing", "build"], repo: "Reyanda/khwelero",
    probe: { path: "/health", apiBase: "" },
    note: "Zero-cost PaaS — the deploy target for platform modules. Routed through api.actiora.com/khwelero." },
  { id: "redteam", name: "Sentinel Red-Team Stack", domain: "cyber", status: "connector", military: true,
    api: (typeof window !== "undefined" && ["localhost","127.0.0.1"].includes(window.location?.hostname))
      ? "http://127.0.0.1:8443" : "https://api.actiora.com/sentinel",
    apiBase: "/api/v1", repo: "Documents/redteam",
    credential: { type: "bearer-token", label: "Sentinel access token", minLength: 20, projectScoped: true,
      origins: ["https://api.actiora.com", "https://sentinel.actiora.com", "https://reyanda.github.io", "http://127.0.0.1:8443"] },
    probe: { path: "/health", apiBase: "" },
    capabilities: ["targets", "scans", "findings", "attack surface", "detection surface", "coverage matrix", "gap analysis", "defense deployment"],
    note: "Full Security-as-a-Service — local dev on 127.0.0.1:8443, production on api.actiora.com/sentinel. Powers the Cyber engine." },
  { id: "openscience", name: "OpenScience Infrastructure", domain: "academic", status: "connector",
    api: "https://api.actiora.com/openscience", repo: "Documents/Science/OpenScience",
    probe: { path: "/health", apiBase: "" },
    capabilities: ["research connectors", "data query", "GraphQL", "bioinformatics (Pfam/gene-validity)", "AI chat over data"],
    engines: { connectors: "/api/connectors", query: "/api/query", graphql: "/api/v4/graphql", pfam: "/api/entry/pfam/", chat: "/api/chat" },
    note: "Open-science research-data platform — connectors, GraphQL, bioinformatics, and data query. Backs discovery and data access in the Evidence workspace." },
  { id: "liteparse", name: "LiteParse", domain: "academic", status: "connector",
    api: "https://api.actiora.com", apiBase: "", repo: "https://github.com/run-llama/liteparse",
    probe: { path: "/parse/health", apiBase: "" },
    capabilities: ["PDF → structured text", "layout-aware parsing", "tables"],
    note: "LIVE — medantir-parse (LiteParse) behind the api.actiora.com gateway. POST /parse {url|base64} or multipart file → markdown. Local Rust+PDFium, no GPU." },
  { id: "pdf-tools", name: "PDF Processors (skills)", domain: "academic", status: "link",
    repo: "Documents/skills", url: "https://platform.actiora.com",
    capabilities: ["pdf", "pdf-extraction-ocr", "pdf-reading", "pdf-annotation-highlighting"],
    note: "The skill-suite PDF processors (extraction, OCR, reading, highlighting) — invoked by the agent via the Skills engine." },
  { id: "resource-shrimp", name: "Resource Shrimp", domain: "academic", status: "connector",
    api: "https://api.actiora.com/shrimp", repo: "Reyanda/resource-shrimp",
    probe: { path: "/health", apiBase: "" },
    capabilities: ["document sourcing", "OA full-text (DOI/arXiv/title)", "library", "NotebookLM Q&A", "audio engine (transcribe)", "video engine (stream/YouTube)", "Drive sync"],
    engines: { document: "/api/download", library: "/api/library", qa: "/api/ai/chat", audio: "/api/transcribe", video: "/api/stream/", youtube: "/api/youtube-cookies" },
    note: "Document-sourcing sandbox — downloads full text by DOI/arXiv/title, plus audio (transcription) and video (stream/YouTube) engines. Supports retrieval in the Evidence workspace." },
  { id: "inferenceos", name: "InferenceOS", domain: "ai", status: "link",
    capabilities: ["MCP server", "token optimization", "local-first"], repo: "Reyanda/InferenceOS",
    note: "Local-first optimization layer / MCP runtime for the AI agents." },
  { id: "inferno-code", name: "Inferno-Code", domain: "ai", status: "connector",
    api: "https://api.actiora.com/inferno", capabilities: ["agentic orchestration", "task decomposition", "multi-step execution"], repo: "Reyanda/inferno-code",
    probe: { path: "/health", apiBase: "" },
    note: "Primary agentic orchestration engine — decomposes and runs multi-step tasks for the Composer. Routed through api.actiora.com/inferno." },
  { id: "open-bio-canvas", name: "Open Bio Canvas", domain: "health", status: "connector",
    api: "https://api.actiora.com/biocanvas", capabilities: ["bio data canvas", "user registry", "analytics", "AWS export"], repo: "Reyanda/open-bio-canvas-data",
    probe: { path: "/health", apiBase: "" },
    note: "Bio data canvas + user registry/analytics datastore (backend via GitHub API, AWS-exportable)." },

  // --- research / analytics modules ------------------------------------
  { id: "maled", name: "MALED Pipeline", domain: "health", status: "link",
    capabilities: ["nutrition", "causal analysis", "DHS"], repo: "Documents/MALED",
    note: "Multi-country nutrition & child-growth pipeline." },
  { id: "nutrimodel", name: "NutriModel", domain: "health", status: "link",
    capabilities: ["Optifood LP", "MINIMOD MIP", "stochastic uncertainty"], repo: "Reyanda/NutriModel",
    note: "Kenya complementary-feeding nutrition modelling." },
  { id: "hmis", name: "HMIS", domain: "health", status: "link",
    capabilities: ["health information systems", "Lancet DH package"], repo: "Documents/HMIS" },
  { id: "cameo-sam", name: "CAMEO-SAM QWoE", domain: "academic", status: "link",
    capabilities: ["QWoE scoring", "AMSTAR-2", "Bradford-Hill"], repo: "Reyanda/cameo-sam-qwoe-assessor",
    note: "Severe-acute-malnutrition causal evidence assessor (PROSPERO-registered)." },
  { id: "dhs-sdh", name: "DHS Structural Determinants", domain: "academic", status: "link",
    capabilities: ["counterfactual analysis", "transportability"], repo: "Reyanda/dhs-structural-determinants" },
  { id: "systematic-review", name: "Evidence Pipeline Service", domain: "academic", status: "connector",
    api: "https://api.actiora.com", apiBase: "/review", repo: "Documents/Medantir/medantir-review",
    probe: { path: "/health" },
    capabilities: ["21 review families", "closed-loop orchestration", "protocol development", "search testing", "registry packages", "screening", "retrieval", "specialist synthesis gates", "GRADE and EtD", "PRISMA reporting", "human verification"],
    note: "Backend service for the deep-review stages inside the unified Evidence workspace; it is not a separate user-facing engine." },

  { id: "ascent", name: "Ascent — Personal OS", domain: "personal", status: "connector",
    api: "https://api.actiora.com/ascent", apiBase: "/api", repo: "Reyanda/ascent-operating-system",
    probe: { path: "/health", apiBase: "/api" },
    capabilities: ["finance ledger (double-entry)", "budgeting", "calendar", "life domains", "advisory-only AI"],
    engines: { finance: "/finance/summary", ledger: "/finance/ledger", calendar: "/calendar/upcoming", domains: "/domains" },
    note: "Finance-first personal operating system (live at ascent.actiora.com). Read-first + advisory-only per its security boundary — never mutates finance without explicit approval." },
  { id: "astellic", name: "Astellic — Climate Supply Chain", domain: "climate", status: "link",
    capabilities: ["climate-informed supply chain", "EWARS incidence", "causal DAG / adjustment sets", "district climate trends"], repo: "Documents/Astellic",
    note: "Climate-informed health supply-chain early warning (CMIP6/NASA POWER district trends, EWARS, causal DAG)." },

  // --- defence / other -------------------------------------------------
  { id: "actiora", name: "Actiora Sentinel", domain: "defence", status: "link", military: true,
    capabilities: ["defense assessment"], repo: "Documents/actiora-sentinel-prod" },
];

// Every raw record has an explicit identity decision in mode-membership.json.
const _curatedIds = new Set(CURATED.map((module) => module.id));
export const ALL_MODULE_RECORDS = [...CURATED, ...autoMods.modules.filter((module) => !_curatedIds.has(module.id))];

export function moduleMembership(id) {
  return modeMembership.records[id] || { kind: "unclassified", reason: "No audited membership decision." };
}

function enrichCanonical(module) {
  const membership = moduleMembership(module.id);
  const aliases = ALL_MODULE_RECORDS.filter((candidate) => moduleMembership(candidate.id).kind === "alias" && moduleMembership(candidate.id).canonicalId === module.id);
  const liveAlias = aliases.find((candidate) => candidate.status === "live" && candidate.url);
  return {
    ...module,
    ...(liveAlias && !module.url ? { url: liveAlias.url } : {}),
    aliases: aliases.map((candidate) => candidate.id),
    primaryMode: membership.primaryMode,
    modes: membership.modes || [],
    membershipKind: membership.kind,
  };
}

export const CANONICAL_MODULES = ALL_MODULE_RECORDS.filter((module) => moduleMembership(module.id).kind === "canonical").map(enrichCanonical);
export const SYSTEM_MODULES = ALL_MODULE_RECORDS.filter((module) => moduleMembership(module.id).kind === "system").map(enrichCanonical);
export const UNCLASSIFIED_MODULES = ALL_MODULE_RECORDS.filter((module) => moduleMembership(module.id).kind === "unclassified").map((module) => ({ ...module, membershipKind: "unclassified", classificationReason: moduleMembership(module.id).reason }));

// Backwards-compatible public catalogue now means canonical domain modules, not
// every repository/deployment record. System and unclassified records are explicit.
export const MODULES = CANONICAL_MODULES;
export const MODULE_DOMAINS = [...new Set(CANONICAL_MODULES.map((module) => module.domain))];

export function resolveModule(id) {
  const membership = moduleMembership(id);
  const canonicalId = membership.kind === "alias" ? membership.canonicalId : id;
  return [...CANONICAL_MODULES, ...SYSTEM_MODULES, ...UNCLASSIFIED_MODULES].find((module) => module.id === canonicalId) || null;
}

export function modulesForMode(modeId) {
  return CANONICAL_MODULES.filter((module) => module.modes.includes(modeId));
}

export function systemModules() {
  return SYSTEM_MODULES;
}

export function unclassifiedModules() {
  return UNCLASSIFIED_MODULES;
}

export function moduleConnectors() {
  return [...CANONICAL_MODULES, ...SYSTEM_MODULES].filter((module) => module.api);
}

/** Modules whose API routes through api.actiora.com — gated to SUDO users only.
 *  Regular users see these as "access-required" and cannot probe or call them. */
export function isApiGated(moduleOrId) {
  const m = typeof moduleOrId === "string" ? resolveModule(moduleOrId) : moduleOrId;
  if (!m?.api) return false;
  return /^https:\/\/api\.actiora\.com\//.test(m.api);
}

// Invoke a connector module's API. Supports method + body. Graceful failure —
// these run on localhost/AWS/khwelero and may be offline or CORS-restricted.
// Per-module URL overrides — point a connector at wherever it actually runs.
const MURL = "medantir.moduleurls.v1";
export function setModuleUrl(id, url) {
  const module = resolveModule(id);
  const key = module?.id || id;
  try { const v = JSON.parse(localStorage.getItem(MURL) || "{}"); v[key] = url; localStorage.setItem(MURL, JSON.stringify(v)); } catch { /* ignore */ }
}
export function moduleUrl(moduleOrId) {
  const m = typeof moduleOrId === "string" ? resolveModule(moduleOrId) : moduleOrId;
  if (!m) return null;
  try {
    const override = JSON.parse(localStorage.getItem(MURL) || "{}")[m.id];
    // On the deployed HTTPS site, a stale http://localhost override provably
    // can't work (mixed content). If the module has a proper https default, use
    // it instead of the dead localhost override — auto-heals old settings.
    const httpsOrigin = typeof window !== "undefined" && window.location?.protocol === "https:";
    const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)/i.test(override || "");
    if (override && httpsOrigin && isLocalHttp && /^https:/i.test(m.api || "")) return m.api;
    return override || m.api;
  } catch {
    return m.api;
  }
}

export function moduleReadiness(moduleOrId) {
  const module = typeof moduleOrId === "string" ? resolveModule(moduleOrId) : moduleOrId;
  const url = moduleUrl(module);
  if (!module || !url) return { state: "setup-required", label: "Endpoint setup required", canTest: false };
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    return local
      ? { state: "setup-required", label: "Local service setup required", canTest: true }
      : { state: "configured", label: "Ready to test", canTest: true };
  } catch {
    return { state: "setup-required", label: "Valid endpoint required", canTest: false };
  }
}

// Gate API calls to SUDO users only. Reads localStorage directly to avoid
// circular imports with accounts.js.
function isCurrentUserSudo() {
  if (cloudAuthEnabled()) return cloudCurrentUser()?.role === "sudo";
  try {
    const user = JSON.parse(localStorage.getItem("medantir.currentUser.v1") || "null");
    return user?.role === "sudo";
  } catch {
    return false;
  }
}

function requireSudo(moduleOrId) {
  if (!isApiGated(moduleOrId)) return true;
  return isCurrentUserSudo();
}

export async function callModule(id, path = "/health", { method = "GET", body, token, apiBase, projectId } = {}) {
   const m = resolveModule(id);
   if (!m) return { ok: false, error: `unknown module ${id}` };
   if (!requireSudo(m)) return { ok: false, error: `${m.name} requires SUDO access — API gateway restricted.`, state: "access-denied" };
   const base = moduleUrl(m);
   if (!base) return { ok: false, error: `${m.name} has no callable API (status: ${m.status})`, repo: m.repo };
   // apiBase override: pass "" to hit routes outside the module's default apiBase
   const ab = apiBase !== undefined ? apiBase : (m.apiBase || "");
   const url = `${String(base).replace(/\/$/, "")}${ab ? `/${String(ab).replace(/^\//, "").replace(/\/$/, "")}` : ""}/${String(path).replace(/^\//, "")}`;
   if (cloudAuthEnabled() && m.credential?.type === "bearer-token") {
    if (!projectId) return { ok: false, state: "project-required", error: `${m.name} requires an active project.` };
    const service = m.id === "redteam" ? "sentinel" : m.id;
    const route = `${ab ? `/${String(ab).replace(/^\//, "").replace(/\/$/, "")}` : ""}/${String(path).replace(/^\//, "")}`;
    try {
      const headers = await cloudAuthHeaders(projectId, body ? { "content-type": "application/json" } : {});
      const response = await fetch(`https://api.actiora.com/runtime/v1/connectors/${service}${route}`, { method, headers, body: body ? JSON.stringify({ body: JSON.stringify(body) }) : undefined });
      const text = await response.text(); let data;
      try { data = JSON.parse(text); } catch { data = text.slice(0, 500); }
      return { ok: response.ok, status: response.status, module: m.name, url, data, error: response.ok ? undefined : data?.error || `${m.name} returned HTTP ${response.status}` };
    } catch (error) { return { ok: false, error: String(error.message || error) }; }
  }
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) {
    const credential = m.credential;
    const value = String(token).trim();
    if (credential?.type !== "bearer-token") return { ok: false, state: "credential-not-supported", error: `${m.name} does not declare a bearer-token credential contract.` };
    if (value.length < (credential.minLength || 1) || /\s/.test(value)) return { ok: false, state: "invalid-credential", error: `${credential.label} is malformed.` };
    if (credential.projectScoped && !projectId) return { ok: false, state: "project-required", error: `${m.name} requires an active project before a token can be used.` };
    const origin = new URL(url).origin;
    if (!credential.origins?.includes(origin)) return { ok: false, state: "untrusted-origin", error: `Refusing to send ${credential.label} to ${origin}.` };
    headers.Authorization = `Bearer ${value}`;
    if (projectId) headers["X-Actiora-Project"] = String(projectId);
  }
  try {
    const res = await fetch(url, {
      method,
      headers: Object.keys(headers).length ? headers : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 500);
    }
    const error = res.ok ? undefined : res.status === 401 || res.status === 403
      ? `${m.name} requires authentication (${res.status})`
      : `${m.name} returned HTTP ${res.status}`;
    return { ok: res.ok, status: res.status, module: m.name, url, data, error };
  } catch (e) {
    return { ok: false, error: `${m.name} unreachable at ${url} (offline or CORS): ${String(e.message || e)}` };
  }
}

export async function probeModule(id) {
   const module = resolveModule(id);
   if (!requireSudo(module)) return { ok: false, state: "access-denied", error: "API gateway restricted to SUDO users." };
   if (!module?.api) return { ok: false, state: "not-configured", error: `${module?.name || id} has no callable endpoint.` };
   const probe = module.probe || { path: "/health" };
   const result = await callModule(module.id, probe.path, { apiBase: probe.apiBase });
   if (result.ok) return { ...result, state: "ready" };
   if (result.status === 401 || result.status === 403) return { ...result, state: "authentication-required" };
   if (result.status) return { ...result, state: "http-error" };
   return { ...result, state: "offline" };
 }

// Compatibility wrapper for older consumers. New shell code uses modulesForMode.
export function modulesForProfile(profileId) {
  const mode = profileId === "operator" || profileId === "nsa" ? "security" : profileId === "personal" ? "personal" : profileId;
  return modulesForMode(mode);
}
