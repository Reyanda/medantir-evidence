// Model Context Protocol catalogue and Streamable HTTP client.
//
// Hosted OAuth, direct bearer-token, and local-daemon connections are distinct.
// The static SPA never pretends it can complete confidential OAuth by itself.

import { getSecret, hasSecret, putSecret } from "./secureVault.js";
import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";
import { activeProject } from "./projectstore.js";

const SETTINGS_KEY = "medantir.mcp.v3";
const V2_KEY = "medantir.mcp.v2";
const LEGACY_KEY = "medantir.mcp.v1";
const PROTOCOL_VERSION = "2025-06-18";

export const MCP_CATALOG = [
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", category: "productivity", transport: "streamable-http", access: "oauth-bridge", auth: "oauth", setupUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp", note: "Hosted Notion MCP requires an interactive OAuth + PKCE client; configure it through the authenticated bridge." },
  { id: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", category: "dev", transport: "streamable-http", access: "direct-token", auth: "token", credentialOrigin: "https://api.githubcopilot.com", setupUrl: "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server", note: "Remote GitHub MCP. Use a least-privilege PAT, or configure OAuth through the bridge." },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", category: "productivity", transport: "streamable-http", access: "direct-token", auth: "token", credentialOrigin: "https://mcp.linear.app", setupUrl: "https://linear.app/docs/mcp", note: "Remote Linear MCP. Supports OAuth and restricted API/access tokens as Bearer credentials." },
  { id: "atlassian", name: "Atlassian (Jira/Confluence)", url: "https://mcp.atlassian.com/v1/mcp/authv2", category: "productivity", transport: "streamable-http", access: "oauth-bridge", auth: "oauth", setupUrl: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/setting-up-ides/", note: "Atlassian Rovo MCP uses OAuth 2.1; the retired /v1/sse endpoint is not used." },
  { id: "asana", name: "Asana", url: "https://mcp.asana.com/v2/mcp", category: "productivity", transport: "streamable-http", access: "oauth-bridge", auth: "oauth", setupUrl: "https://developers.asana.com/docs/integrating-with-asanas-mcp-server", note: "Asana V2 MCP requires a preregistered OAuth application and server-side token refresh." },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", category: "dev", transport: "streamable-http", access: "oauth-bridge", auth: "oauth", note: "Hosted Sentry MCP. Complete its OAuth flow through the authenticated bridge." },
  { id: "stripe", name: "Stripe", url: "https://mcp.stripe.com", category: "finance", transport: "streamable-http", access: "direct-token", auth: "token", credentialOrigin: "https://mcp.stripe.com", setupUrl: "https://docs.stripe.com/mcp", note: "Stripe MCP. Use a restricted key with only the permissions required by the workflow." },
  { id: "cloudflare", name: "Cloudflare Observability", url: "https://observability.mcp.cloudflare.com/mcp", category: "infra", transport: "streamable-http", access: "oauth-bridge", auth: "oauth", setupUrl: "https://developers.cloudflare.com/workers/get-started/prompting/", note: "Cloudflare Observability MCP uses hosted authorization; connect it through the bridge." },
];

function safeParse(value, fallback) {
  try { return JSON.parse(value || "null") || fallback; } catch { return fallback; }
}

function loopbackUrl(value) {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function persistedRecord(catalogue, config = {}, { legacy = false } = {}) {
  const record = {
    id: catalogue.id,
    enabled: legacy || catalogue.access === "oauth-bridge" ? false : config.enabled === true,
    hasToken: !!config.hasToken,
  };
  // Only local daemons are user-addressable. Remote endpoints, auth modes,
  // credential origins and transports are catalogue-owned security metadata.
  if (catalogue.access === "local-daemon" && loopbackUrl(config.url)) record.url = config.url;
  return record;
}

function migrateLegacySettings() {
  if (localStorage.getItem(SETTINGS_KEY)) return;
  const v2 = safeParse(localStorage.getItem(V2_KEY), null);
  const v1 = safeParse(localStorage.getItem(LEGACY_KEY), null);
  const source = v2 || v1;
  const legacy = !v2 && !!v1;
  const records = Array.isArray(source?.servers) ? source.servers : Object.values(source?.overrides || {});
  const byId = Object.fromEntries(records.map((record) => [record.id, record]));
  const safe = MCP_CATALOG
    .filter((catalogue) => byId[catalogue.id])
    .map((catalogue) => persistedRecord(catalogue, byId[catalogue.id], { legacy }));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 3, servers: safe }));
}

function consumeOAuthCallback() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("connector") !== "notion" || params.get("connected") !== "1") return;
  const stored = safeParse(localStorage.getItem(SETTINGS_KEY), { version: 3, servers: [] });
  const servers = Array.isArray(stored.servers) ? stored.servers : [];
  const index = servers.findIndex((item) => item.id === "notion");
  if (index >= 0) servers[index] = { ...servers[index], enabled: true };
  else servers.push({ id: "notion", enabled: true, hasToken: false });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 3, servers }));
  history.replaceState({}, "", window.location.pathname);
}

export function loadMCP() {
  try { migrateLegacySettings(); } catch { /* storage unavailable */ }
  try { consumeOAuthCallback(); } catch { /* storage unavailable */ }
  const stored = safeParse(localStorage.getItem(SETTINGS_KEY), { servers: [] });
  const byId = Object.fromEntries((stored.servers || []).map((server) => [server.id, server]));
  return MCP_CATALOG.map((catalogue) => {
    const config = byId[catalogue.id] || {};
    return {
      ...catalogue,
      ...(catalogue.access === "local-daemon" && loopbackUrl(config.url) ? { url: config.url } : {}),
      enabled: config.enabled === true,
      token: undefined,
      hasToken: !!config.hasToken || hasSecret(`mcp/${catalogue.id}/token`),
    };
  });
}

export function saveMCP(servers) {
  try {
    const byId = Object.fromEntries(servers.map((server) => [server.id, server]));
    const safe = MCP_CATALOG.map((catalogue) => persistedRecord(catalogue, byId[catalogue.id]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: 3, servers: safe }));
  } catch { /* storage unavailable */ }
}

export async function setServer(id, patch) {
  const catalogue = MCP_CATALOG.find((server) => server.id === id);
  if (!catalogue) return { ok: false, error: `Unknown MCP server ${id}` };
  const { token, ...settings } = patch || {};
  if (token) {
    const result = await putSecret(`mcp/${id}/token`, token);
    if (!result.ok) return result;
  }
  const servers = loadMCP();
  const index = servers.findIndex((server) => server.id === id);
  if (index < 0) return { ok: false, error: `Unknown MCP server ${id}` };
  servers[index] = { ...servers[index], ...settings, hasToken: hasSecret(`mcp/${id}/token`) };
  saveMCP(servers);
  sessions.delete(id);
  return { ok: true, servers };
}

export function mcpReadiness(serverOrId) {
  const server = typeof serverOrId === "string" ? loadMCP().find((item) => item.id === serverOrId) : serverOrId;
  if (!server) return { state: "unknown", label: "Unknown server", canTest: false };
  if (server.access === "oauth-bridge") return server.enabled ? { state: "configured", label: "OAuth connected", canTest: true } : { state: "setup-required", label: "Connect with OAuth", canTest: false };
  if (!server.enabled) return { state: "disabled", label: "Disabled", canTest: false };
  if (server.auth === "token" && !server.hasToken) return { state: "authentication-required", label: "Token required", canTest: false };
  if (server.access === "local-daemon") return { state: "configured", label: "Local daemon configured", canTest: true };
  return { state: "configured", label: "Ready to test", canTest: true };
}

export function enabledServers() {
  return loadMCP().filter((server) => server.enabled && server.url && mcpReadiness(server).canTest);
}

function endpoint(server) {
  let parsed;
  try { parsed = new URL(server.url); } catch { throw Object.assign(new Error("Invalid MCP endpoint URL."), { state: "invalid-configuration" }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw Object.assign(new Error("MCP endpoint must use HTTP or HTTPS."), { state: "invalid-configuration" });
  if (server.access === "local-daemon" && !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw Object.assign(new Error("Local MCP endpoints must use a loopback host."), { state: "invalid-configuration" });
  }
  if (server.access === "direct-token" && server.credentialOrigin && parsed.origin !== server.credentialOrigin) {
    throw Object.assign(new Error("Refusing to send a stored token to a non-catalogue origin."), { state: "untrusted-origin" });
  }
  return parsed.toString();
}

let nextId = 0;
const sessions = new Map();

function parseSse(text, requestId) {
  const payloads = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean);
  const messages = payloads.map((payload) => safeParse(payload, null)).filter(Boolean);
  return messages.find((message) => message.id === requestId) || messages.at(-1) || {};
}

async function rpc(server, method, params, { notification = false, session } = {}) {
  const id = notification ? undefined : ++nextId;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": session?.protocolVersion || PROTOCOL_VERSION,
  };
  if (session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
  if (server.access === "oauth-bridge" && cloudAuthEnabled()) Object.assign(headers, await cloudAuthHeaders(activeProject()));
  const token = await getSecret(`mcp/${server.id}/token`);
  if (server.auth === "token" && !token) throw Object.assign(new Error("Unlock the vault and store a token first."), { state: "authentication-required" });
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    const target = server.access === "oauth-bridge" && server.id === "notion" && cloudAuthEnabled() ? "https://api.actiora.com/runtime/v1/mcp/notion" : endpoint(server);
    response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params: params || {} }),
    });
  } catch (error) {
    throw Object.assign(new Error(`${server.name} could not be reached. Start its local daemon or use the Medantir bridge if the origin blocks browser access.`), { state: "offline", cause: error });
  }

  if (!response.ok) {
    const state = response.status === 401 || response.status === 403 ? "authentication-required" : "http-error";
    throw Object.assign(new Error(`${server.name} returned HTTP ${response.status}.`), { state, status: response.status });
  }
  if (notification || response.status === 202 || response.status === 204) return { result: null, response };

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const payload = contentType.includes("text/event-stream") ? parseSse(text, id) : safeParse(text, null);
  if (!payload) throw Object.assign(new Error(`${server.name} returned a non-MCP response.`), { state: "protocol-error" });
  if (payload.error) throw Object.assign(new Error(payload.error.message || "MCP protocol error"), { state: "protocol-error", code: payload.error.code });
  return { result: payload.result, response };
}

export async function beginMcpOAuth(id) {
  if (id !== "notion" || !cloudAuthEnabled()) return { ok: false, error: "This OAuth bridge is available on the managed Actiora platform." };
  try {
    const response = await fetch("https://api.actiora.com/runtime/v1/oauth/notion/start", { headers: await cloudAuthHeaders(activeProject()) });
    const body = await response.json();
    if (!response.ok || !body.authorizationUrl) return { ok: false, error: body.error || `OAuth HTTP ${response.status}` };
    window.location.assign(body.authorizationUrl);
    return { ok: true };
  } catch (error) { return { ok: false, error: String(error.message || error) }; }
}

async function ensureSession(server) {
  if (sessions.has(server.id)) return sessions.get(server.id);
  const initialized = await rpc(server, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "Medantir", version: "1.0.0" },
  });
  const session = {
    sessionId: initialized.response.headers.get("Mcp-Session-Id") || null,
    protocolVersion: initialized.result?.protocolVersion || PROTOCOL_VERSION,
  };
  sessions.set(server.id, session);
  await rpc(server, "notifications/initialized", {}, { notification: true, session });
  return session;
}

function setupFailure(server) {
  const readiness = mcpReadiness(server);
  if (readiness.canTest) return null;
  return { ok: false, state: readiness.state, error: readiness.label, setupUrl: server.setupUrl };
}

export async function mcpListTools(serverId) {
  const server = loadMCP().find((item) => item.id === serverId);
  if (!server) return { ok: false, state: "unknown", error: `Unknown MCP server ${serverId}` };
  const blocked = setupFailure(server);
  if (blocked) return blocked;
  try {
    const session = await ensureSession(server);
    const { result } = await rpc(server, "tools/list", {}, { session });
    return { ok: true, state: "ready", tools: result?.tools || [] };
  } catch (error) {
    sessions.delete(server.id);
    return { ok: false, state: error.state || "error", status: error.status, error: error.message };
  }
}

export async function mcpCallTool(serverId, name, args) {
  const server = loadMCP().find((item) => item.id === serverId);
  if (!server) return { ok: false, state: "unknown", error: `Unknown MCP server ${serverId}` };
  const blocked = setupFailure(server);
  if (blocked) return blocked;
  try {
    const session = await ensureSession(server);
    const { result } = await rpc(server, "tools/call", { name, arguments: args || {} }, { session });
    return { ok: true, state: "ready", result };
  } catch (error) {
    sessions.delete(server.id);
    return { ok: false, state: error.state || "error", status: error.status, error: error.message };
  }
}

export async function mcpAllTools() {
  const tools = [];
  for (const server of enabledServers()) {
    const result = await mcpListTools(server.id);
    if (result.ok) for (const tool of result.tools) tools.push({ server: server.id, name: tool.name, description: tool.description });
  }
  return tools;
}
