import { cloudAuthEnabled, cloudAuthHeaders } from "./cloudAuth.js";

// The runtime is served behind the canonical API gateway. Keeping one origin
// avoids the stale TLS edge that previously surfaced as "Failed to fetch".
const RUNTIME_API = import.meta.env?.VITE_RUNTIME_API || "https://api.actiora.com/runtime";
function desktopRuntime() {
  if (typeof window === "undefined") return null;
  const runtime = window.__medantirDesktop__;
  return runtime?.isAvailable?.() && runtime.workspace && runtime.terminal ? runtime : null;
}
async function cloudFetch(projectId, route, options = {}) {
  const headers = await cloudAuthHeaders(projectId, options.headers || {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeout || 15_000));
  let response;
  try {
    response = await fetch(`${RUNTIME_API}${route}`, { ...options, headers, signal: options.signal || controller.signal });
  } catch (cause) {
    if (cause?.name === "AbortError") throw new Error("Project runtime timed out; check the runtime service and retry.");
    throw new Error(`Project runtime unavailable: ${cause?.message || "network request failed"}`);
  } finally { clearTimeout(timer); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Runtime HTTP ${response.status}`);
  return body;
}

export function projectRuntimeAvailable() { return !!desktopRuntime() || cloudAuthEnabled(); }
export async function workspaceInfo(projectId) {
  const desktop = desktopRuntime();
  return desktop ? desktop.workspace.info(projectId) : cloudFetch(projectId, "/v1/workspace");
}
export async function authorizeWorkspace(projectId, projectName) {
  const desktop = desktopRuntime();
  const result = desktop ? await desktop.workspace.authorize(projectId, projectName) : await workspaceInfo(projectId);
  if (result && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("medantir:workspace-changed", { detail: result }));
  return result || null;
}
export async function selectWorkspace(projectId) {
  const desktop = desktopRuntime();
  const result = desktop ? await desktop.workspace.select(projectId) : await workspaceInfo(projectId);
  if (result && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("medantir:workspace-changed", { detail: result }));
  return result || null;
}
export async function listWorkspaceFiles(projectId) {
  const desktop = desktopRuntime();
  return desktop ? desktop.workspace.list(projectId) : cloudFetch(projectId, "/v1/files");
}
export async function readWorkspaceFile(projectId, filePath) {
  const desktop = desktopRuntime();
  if (desktop) return desktop.workspace.read(projectId, filePath);
  return cloudFetch(projectId, `/v1/file?path=${encodeURIComponent(filePath)}`);
}
export async function writeWorkspaceFile(projectId, filePath, content) {
  const desktop = desktopRuntime();
  const result = desktop ? await desktop.workspace.write(projectId, filePath, content) : await cloudFetch(projectId, "/v1/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: filePath, content }) });
  window.dispatchEvent(new CustomEvent("medantir:workspace-changed", { detail: { projectId } }));
  return result;
}
export async function runWorkspaceCommand(projectId, command) {
  const desktop = desktopRuntime();
  if (desktop) throw new Error("Local terminal command execution not directly supported via agent in desktop mode.");
  return cloudFetch(projectId, "/v1/exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
}
export async function readCodebaseFile(projectId, filePath) {
  const desktop = desktopRuntime();
  if (desktop) return desktop.workspace.read(projectId, filePath);
  return cloudFetch(projectId, `/v1/self-improve/file?path=${encodeURIComponent(filePath)}`);
}
export async function writeCodebaseFile(projectId, filePath, content) {
  const desktop = desktopRuntime();
  if (desktop) return desktop.workspace.write(projectId, filePath, content);
  return cloudFetch(projectId, "/v1/self-improve/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: filePath, content }) });
}
export async function runHostCommand(projectId, command) {
  const desktop = desktopRuntime();
  if (desktop) throw new Error("Local host command execution not directly supported via agent in desktop mode.");
  return cloudFetch(projectId, "/v1/self-improve/exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command }) });
}

const dataListeners = new Set();
const exitListeners = new Set();
const cloudSessions = new Map();
const cloudTerminal = {
  async start({ projectId }) {
    const existing = cloudSessions.get(projectId);
    if (existing?.running) return { root: "/workspace", buffer: existing.buffer || "" };
    const grant = await cloudFetch(projectId, "/v1/session", { method: "POST" });
    const socketUrl = new URL(grant.websocketUrl, RUNTIME_API).toString().replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const socket = new WebSocket(socketUrl);
    const state = { socket, running: false, buffer: "" };
    cloudSessions.set(projectId, state);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Cloud terminal connection failed; retry in a moment.")), { once: true });
      socket.addEventListener("close", (event) => reject(new Error(`Cloud terminal closed before starting (code ${event.code}).`)), { once: true });
    });
    state.running = true;
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", async (event) => {
      const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data);
      state.buffer = (state.buffer + data).slice(-100_000);
      dataListeners.forEach((listener) => listener({ projectId, data }));
    });
    socket.addEventListener("close", (event) => { state.running = false; exitListeners.forEach((listener) => listener({ projectId, exitCode: event.code === 1000 ? 0 : event.code })); });
    return { root: "/workspace", authorized: true, buffer: state.buffer };
  },
  async write(projectId, data) {
    const state = cloudSessions.get(projectId);
    if (!state?.running || state.socket.readyState !== WebSocket.OPEN) throw new Error("Cloud terminal is not running");
    state.socket.send(data);
  },
  // The cloud transport is a raw byte stream with no control channel, so a resize
  // cannot reach the remote PTY. Reporting that honestly lets the caller keep the
  // terminal at the PTY's own geometry instead of rendering at a width the remote
  // shell knows nothing about, which is what produced wrapped, garbled output.
  async resize() { return { ok: false, supported: false, reason: "The cloud terminal transport has no resize channel; the remote PTY keeps its initial geometry." }; },
  async kill(projectId) { const state = cloudSessions.get(projectId); if (state?.socket) state.socket.close(1000, "stopped"); },
  async status(projectId) { const state = cloudSessions.get(projectId); return { running: !!state?.running, buffer: state?.buffer || "" }; },
  onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
  onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
};

export function terminalRuntime() { return desktopRuntime()?.terminal || (cloudAuthEnabled() ? cloudTerminal : null); }
