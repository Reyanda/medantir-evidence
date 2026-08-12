// tracerEngine.js — client for the local Tracer raster-to-vector service
// (~/Documents/Tracer, FastAPI on 127.0.0.1:7999). Figures that arrive as
// bitmaps — a forest plot lifted from a PDF, a scanned flow diagram — become
// editable SVG here instead of being re-drawn by hand.
//
// The service is local and optional. Every call reports plainly whether it is
// reachable; nothing in the studio pretends a conversion happened offline.

const BASE_KEY = "medantir.tracer.baseUrl.v1";
export const DEFAULT_TRACER_URL = "http://127.0.0.1:7999";

// Where the service lives is the operator's business, not this file's. An
// earlier version hardcoded a path that has since moved, which is exactly the
// failure mode a hardcoded command invites: the workbench states what it needs
// (an endpoint speaking the Tracer API) and remembers whatever command the
// operator tells it starts one.
const START_KEY = "medantir.tracer.startCommand.v1";

export function tracerStartCommand() {
  try { return localStorage.getItem(START_KEY) || ""; } catch { return ""; }
}

export function setTracerStartCommand(command) {
  try { localStorage.setItem(START_KEY, String(command || "")); } catch { /* storage disabled */ }
}

export function tracerBaseUrl() {
  try { return localStorage.getItem(BASE_KEY) || DEFAULT_TRACER_URL; } catch { return DEFAULT_TRACER_URL; }
}

export function setTracerBaseUrl(url) {
  try { localStorage.setItem(BASE_KEY, String(url || "").replace(/\/$/, "") || DEFAULT_TRACER_URL); } catch { /* storage disabled */ }
}

export const OUTPUT_MODES = [
  { id: "pure_vector", label: "Pure vector", hint: "editable geometry only" },
  { id: "hybrid_parity", label: "Hybrid parity", hint: "vector plus a raster residual where the proof differs" },
  { id: "exact_wrapper", label: "Exact wrapper", hint: "embed the original raster at exact dimensions" },
];

async function call(path, { method = "GET", body, timeoutMs = 180_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${tracerBaseUrl()}${path}`, { method, body, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const detail = data?.detail;
      const message = typeof detail === "string" ? detail : detail?.message || `Tracer returned ${res.status}`;
      return { ok: false, status: res.status, error: message, errors: detail?.errors || [], warnings: detail?.warnings || [] };
    }
    return { ok: true, data };
  } catch (e) {
    const aborted = e.name === "AbortError";
    return {
      ok: false,
      offline: !aborted,
      error: aborted
        ? "Tracer did not answer in time."
        : `Tracer is not reachable at ${tracerBaseUrl()}.${tracerStartCommand() ? ` Recorded start command: ${tracerStartCommand()}` : " No start command recorded — set the endpoint and, if you want, the command that starts it."}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function tracerHealth() {
  return call("/api/health", { timeoutMs: 4000 });
}

export function tracerAnalyze(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  return call("/api/analyze", { method: "POST", body: form, timeoutMs: 60_000 });
}

// Returns { svg, document, metrics, validity } shaped by the Tracer service.
export function tracerConvert(file, {
  outputMode = "hybrid_parity",
  controlMode = "automatic",
  preset = "complex_map_ui",
  qualityProfile = "balanced",
  verify = true,
  targetQuality = 0.985,
  maxDim = 4096,
} = {}) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("output_mode", outputMode);
  form.append("control_mode", controlMode);
  form.append("preset", preset);
  form.append("quality_profile", qualityProfile);
  form.append("verify", String(verify));
  form.append("target_quality", String(targetQuality));
  form.append("max_dim", String(maxDim));
  return call("/api/convert", { method: "POST", body: form });
}
