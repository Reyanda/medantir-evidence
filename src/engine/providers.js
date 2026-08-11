// providers.js — AI provider registry, key vault, and real API calls.
//
// A pluggable model layer for the OPTIONAL AI sentiment pass. The lexicon in
// sentiment.js is always-on; when a provider here is enabled with a key, media
// text can additionally be scored by a real model. Deliberately provider-diverse
// and non-US-centric friendly: DeepSeek / OpenRouter / Qwen / Moonshot sit
// alongside Claude / OpenAI / Gemini.
//
// Non-secret provider preferences live in localStorage. API keys live only in the
// user-scoped encrypted vault (or a development-only environment variable).

import { getSecret, hasSecret, putSecret } from "./secureVault.js";
import { cloudAuthEnabled } from "./cloudAuth.js";
import { connectorRequest, credentialStatus } from "./serviceCredentials.js";

const SETTINGS_KEY = "medantir.providers.settings.v2";

// --- circuit breaker ---------------------------------------------------------
// Tracks consecutive failures per provider. After 3 failures within a 60-second
// window, the provider is skipped by activeProvider() — no per-request waste.
// On the next successful call the counter resets.
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 60_000;
const providerCircuit = new Map();

function cbState(id) {
  return providerCircuit.get(id) || { failures: 0, cooldownUntil: 0 };
}

function cbIsOpen(id) {
  const s = cbState(id);
  const now = Date.now();
  if (s.cooldownUntil > now) return true;
  if (s.failures >= CB_THRESHOLD && now - s.cooldownUntil > CB_COOLDOWN_MS) {
    s.cooldownUntil = now + CB_COOLDOWN_MS;
    providerCircuit.set(id, s);
    return true;
  }
  if (s.failures >= CB_THRESHOLD) {
    s.cooldownUntil = now + CB_COOLDOWN_MS;
    providerCircuit.set(id, s);
    return true;
  }
  return false;
}

function cbRecordSuccess(id) {
  providerCircuit.set(id, { failures: 0, cooldownUntil: 0 });
}

function cbRecordFailure(id) {
  const s = cbState(id);
  s.failures++;
  s.cooldownUntil = 0;
  providerCircuit.set(id, s);
}

export function circuitStatus(id) {
  const s = cbState(id);
  return { id, failures: s.failures, cooldownUntil: s.cooldownUntil, open: cbIsOpen(id) };
}

export function resetCircuit(id) {
  providerCircuit.delete(id);
}

// `icon` matches a named export of @lobehub/icons. `shape` selects the request adapter.
// Registry order is preference order: Kimi is the platform default engine, so it
// leads — activeProvider/activeToolProvider pick the first ready entry.
export const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek", icon: "DeepSeek", shape: "openai",
    endpoint: "https://api.deepseek.com/chat/completions", defaultModel: "deepseek-v4-flash",
    note: "Direct DeepSeek V4 flash/pro. Low cost, strong reasoning." },
  { id: "moonshot", label: "Moonshot (Kimi)", icon: "Moonshot", shape: "openai", omitTemperature: true,
    endpoint: "https://api.moonshot.ai/v1/chat/completions", defaultModel: "kimi-k2.5",
    brokerService: "kimi",
    note: "Platform default. Kimi K2.5/K2.6 multimodal 256K, K2 Thinking (reasoning), K2.7 Code. Temperature is managed by the model." },
  { id: "openrouter", label: "OpenRouter", icon: "OpenRouter", shape: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "deepseek/deepseek-chat",
    note: "Gateway to DeepSeek, Qwen, Llama, Claude, GPT & more via one key. Browser-friendly." },
  { id: "hermes", label: "Hermes (Nous)", icon: "OpenRouter", shape: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "nousresearch/hermes-4.3-36b",
    note: "Nous Hermes 4.3 — frontier hybrid reasoning, SOTA function-calling and schema adherence. The Office sub-agent brain when configured; falls back to the platform orchestrator otherwise." },
  { id: "qwen", label: "Qwen (Alibaba)", icon: "Qwen", shape: "openai",
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", defaultModel: "qwen-plus",
    note: "Alibaba Qwen via OpenAI-compatible endpoint." },
  { id: "anthropic", label: "Claude", icon: "Claude", shape: "anthropic",
    endpoint: "https://api.anthropic.com/v1/messages", defaultModel: "claude-sonnet-4-6",
    note: "Anthropic Claude. Browser calls need direct-access header (enabled)." },
  { id: "openai", label: "ChatGPT (OpenAI)", icon: "OpenAI", shape: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini",
    note: "OpenAI GPT models." },
  { id: "google", label: "Gemini (Google)", icon: "Gemini", shape: "google",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models", defaultModel: "gemini-1.5-flash",
    note: "Google Gemini." },
  { id: "mistral", label: "Mistral", icon: "Mistral", shape: "openai",
    endpoint: "https://api.mistral.ai/v1/chat/completions", defaultModel: "mistral-small-latest",
    note: "European Mistral models." },
  { id: "groq", label: "Groq", icon: "Groq", shape: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions", defaultModel: "llama-3.3-70b-versatile",
    note: "Ultra-low-latency inference for open models." },
  { id: "xai", label: "Grok (xAI)", icon: "Grok", shape: "openai",
    endpoint: "https://api.x.ai/v1/chat/completions", defaultModel: "grok-2-latest",
    note: "xAI Grok." },
  { id: "perplexity", label: "Perplexity", icon: "Perplexity", shape: "openai",
    endpoint: "https://api.perplexity.ai/chat/completions", defaultModel: "sonar",
    note: "Perplexity Sonar (web-grounded)." },
  { id: "ollama", label: "Ollama (local)", icon: "Ollama", shape: "openai", keyless: true,
    endpoint: "http://localhost:11434/v1/chat/completions", defaultModel: "llama3.1",
    note: "Local models — private, offline, no key." },
  { id: "local", label: "On-device (embedded)", icon: "Ollama", shape: "local", keyless: true,
    defaultModel: "embedded",
    note: "On-device embedded engines (Gemini Nano / Transformers.js / WebLLM). Route via taskRouter — not callProvider." },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

// --- OpenRouter account sign-in (OAuth PKCE) --------------------------------
// OpenRouter is the one AI provider that offers real account login instead of a
// pasted key: redirect to openrouter.ai with a PKCE challenge, the user signs in
// with their own email/password (or Google), and the exchange returns a
// user-controlled API key which is stored in the vault like any other key.
// (Moonshot/DeepSeek/etc. expose no OAuth — key paste is their only mechanism.)
const OR_PKCE_KEY = "medantir.openrouter.pkce.v1";
const OR_CALLBACK_PATH = "/auth/openrouter";
const orB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function beginOpenRouterSignIn() {
  const verifier = orB64(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  sessionStorage.setItem(OR_PKCE_KEY, JSON.stringify({ verifier, createdAt: Date.now() }));
  const callback = `${window.location.origin}${OR_CALLBACK_PATH}`;
  const params = new URLSearchParams({ callback_url: callback, code_challenge: orB64(new Uint8Array(digest)), code_challenge_method: "S256" });
  window.location.assign(`https://openrouter.ai/auth?${params}`);
}

// Runs at app bootstrap: completes the exchange when the URL is our callback.
// Returns true when a key was stored, null when the URL is not ours; throws on
// a present-but-invalid callback so the caller can surface the failure.
export async function completeOpenRouterSignIn() {
  if (typeof window === "undefined" || window.location.pathname !== OR_CALLBACK_PATH) return null;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const pending = JSON.parse(sessionStorage.getItem(OR_PKCE_KEY) || "null");
  history.replaceState({}, "", "/");
  sessionStorage.removeItem(OR_PKCE_KEY);
  if (!code || !pending?.verifier || Date.now() - pending.createdAt > 600_000) {
    throw new Error("OpenRouter sign-in could not be verified — start sign-in again.");
  }
  const res = await fetch("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: pending.verifier, code_challenge_method: "S256" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.key) throw new Error(body.error?.message || `OpenRouter sign-in failed (${res.status})`);
  const stored = await setProviderConfig("openrouter", { key: body.key });
  if (!stored.ok) throw new Error(stored.error || "Could not store the OpenRouter key.");
  return true;
}

// --- vault ---------------------------------------------------------------
// Dev-only key injection per provider. In production the `false` branch is
// dead-code-eliminated, so key literals are NEVER shipped in the bundle.
const ENV_KEYS = { openrouter: "VITE_OPENROUTER_API_KEY", moonshot: "VITE_KIMI_API_KEY", deepseek: "VITE_DEEPSEEK_API_KEY", google: "VITE_GOOGLE_API_KEY" };
function envKey(id) {
  try {
    if (!import.meta.env?.DEV) return "";
    const name = ENV_KEYS[id];
    return name ? import.meta.env[name] || "" : "";
  } catch {
    return "";
  }
}

export function loadVault() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveVault(vault) {
  try {
    const safe = Object.fromEntries(Object.entries(vault).map(([id, config]) => [id, config && typeof config === "object" ? { ...config, key: undefined } : config]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe));
  } catch {
    /* storage unavailable */
  }
}

export async function setProviderConfig(id, patch) {
  const { key, ...settings } = patch || {};
  if (key) {
    const stored = await putSecret(`provider/${id}/api-key`, String(key).trim());
    if (!stored.ok) return { ok: false, error: stored.error };
  }
  const vault = loadVault();
  vault[id] = { model: PROVIDER_BY_ID[id]?.defaultModel, enabled: false, ...(vault[id] || {}), ...settings, hasKey: hasSecret(`provider/${id}/api-key`) || !!envKey(id) };
  saveVault(vault);
  return { ok: true, config: vault[id] };
}

export function providerStatus(id) {
  const vault = loadVault();
  const cfg = vault[id] || {};
  const p = PROVIDER_BY_ID[id];
  const brokered = providerBrokered(id);
  const hasKey = p?.keyless || hasSecret(`provider/${id}/api-key`) || !!envKey(id) || brokered;
  const enabled = cfg.enabled !== undefined ? cfg.enabled : hasKey;
  const cooldown = cbIsOpen(id);
  return { ...p, ...cfg, hasKey, brokered, enabled, cooldown, ready: hasKey && enabled && !cooldown };
}

// The provider chosen for AI sentiment: first enabled+ready in registry order.
export function activeProvider() {
  for (const p of PROVIDERS) {
    const s = providerStatus(p.id);
    if (s.ready) return s;
  }
  return null;
}

// Every ready provider (used by the multi-model engine).
export function enabledProviders() {
  return PROVIDERS.map((p) => providerStatus(p.id)).filter((s) => s.ready);
}

// Auto-discover a provider's available models from its /models endpoint (no
// hardcoded model lists). OpenAI-compatible + OpenRouter return { data: [{id}] }.
// Results cache in the vault; defaultModel is only a last-resort fallback.
export async function discoverModels(id) {
  const p = PROVIDER_BY_ID[id];
  if (!p) return { ok: false, error: "unknown provider" };
  try {
    const key = await providerKey(id);
    const brokered = viaBroker(p, { key });
    if (!p.keyless && !key && !brokered) return { ok: false, error: "Unlock the user vault and store an API key first." };
    if (brokered) {
      const res = await connectorRequest(p.brokerService, "/models");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: `${p.label} broker ${res.status}` };
      const list = data.data || [];
      const models = list.map((m) => (m.id || "").trim()).filter(Boolean).sort();
      const vault = loadVault();
      vault[id] = { ...(vault[id] || {}), models };
      saveVault(vault);
      return { ok: true, models };
    }
    let url, headers = {};
    if (p.shape === "anthropic") {
      url = "https://api.anthropic.com/v1/models";
      headers = { "x-api-key": key || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    } else if (p.shape === "google") {
      url = `${p.endpoint}?key=${key || ""}`; // generativelanguage .../models?key=
    } else {
      // OpenAI-compatible: {base}/models with bearer auth
      url = `${p.endpoint.replace(/\/chat\/completions\/?$/, "")}/models`;
      if (!p.keyless && key) headers.Authorization = `Bearer ${key}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return { ok: false, error: `${p.label} ${res.status}` };
    const data = await res.json();
    // openai/anthropic: {data:[{id}]}; google: {models:[{name:"models/gemini-.."}]}
    const list = data.data || data.models || [];
    const models = list.map((m) => (m.id || m.name || "").replace(/^models\//, "")).filter(Boolean).sort();
    const vault = loadVault();
    vault[id] = { ...(vault[id] || {}), models };
    saveVault(vault);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

export function discoveredModels(id) {
  return loadVault()[id]?.models || [];
}

// --- cloud-brokered provider keys ----------------------------------------
// Any provider with a `brokerService` can be used WITHOUT a local key when the
// signed-in user has stored their own key for that service in the server-side
// credential broker: calls ride the authenticated runtime connector, which
// injects the user's KMS-encrypted key, so no provider key ever touches this
// browser. The configured-state is cached per service in settings; it is only
// ever a positive cache after a real broker status check.
export function brokeredServices() {
  return loadVault().__brokered || {};
}

export function providerBrokered(id) {
  const service = PROVIDER_BY_ID[id]?.brokerService;
  return cloudAuthEnabled() && !!service && brokeredServices()[service] === true;
}

// Refresh the brokered-state cache for every provider service at once (called
// once a cloud session is established). Fails closed per service.
export async function refreshBrokeredProviders() {
  if (!cloudAuthEnabled()) return {};
  const services = [...new Set(PROVIDERS.map((p) => p.brokerService).filter(Boolean))];
  const states = {};
  await Promise.all(services.map(async (service) => {
    try { states[service] = !!(await credentialStatus(service))?.configured; }
    catch { states[service] = false; }
  }));
  const vault = loadVault();
  vault.__brokered = states;
  saveVault(vault);
  return states;
}

// Route a request through the broker when the provider declares a broker
// service and there is no local key. (Plain helper — the name must not start
// with "use" or the react-hooks lint rule mistakes it for a React hook.)
function viaBroker(p, cfg) {
  return !!p.brokerService && !p.keyless && !cfg.key && providerBrokered(p.id);
}

// AI engine mode: "single" (one model) vs "multi" (all enabled models look at the
// same input and each give their own answer → cross-model uncertainty).
export function getAIMode() {
  const v = loadVault();
  return v.__mode === "multi" ? "multi" : "single";
}
export function setAIMode(mode) {
  const v = loadVault();
  v.__mode = mode === "multi" ? "multi" : "single";
  saveVault(v);
  return v.__mode;
}

// --- request adapters ----------------------------------------------------
async function callOpenAICompatible(p, cfg, messages, { json }) {
  const body = {
    model: cfg.model || p.defaultModel,
    messages,
    // Some models (e.g. Kimi K2.5+) reject any temperature but their own.
    ...(p.omitTemperature ? {} : { temperature: 0.1 }),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  if (viaBroker(p, cfg)) {
    // Brokered: the runtime injects the user's stored key; none exists here.
    const res = await connectorRequest(p.brokerService, "/chat/completions", { method: "POST", body });
    if (!res.ok) throw new Error(`${p.label} broker ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
  const headers = { "Content-Type": "application/json" };
  if (!p.keyless) headers.Authorization = `Bearer ${cfg.key}`;
  if (p.id === "openrouter") {
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://medantir.local";
    headers["X-Title"] = "Medantir";
  }
  const res = await fetch(p.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p.label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(p, cfg, messages, { json }) {
  const sys = messages.find((m) => m.role === "system")?.content;
  const rest = messages.filter((m) => m.role !== "system");
  const res = await fetch(p.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model || p.defaultModel,
      max_tokens: 512,
      ...(sys ? { system: sys + (json ? " Respond ONLY with valid JSON." : "") } : {}),
      messages: rest,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

async function callGoogle(p, cfg, messages) {
  const model = cfg.model || p.defaultModel;
  const url = `${p.endpoint}/${model}:generateContent?key=${cfg.key}`;
  const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function providerKey(id) {
  const env = envKey(id);
  if (env) return env.trim();
  // Pasted keys often carry stray whitespace/newlines — providers answer with
  // cryptic 401s (e.g. OpenRouter "User not found"), so trim on use.
  return String((await getSecret(`provider/${id}/api-key`)) || "").trim();
}

// First ready provider that speaks the OpenAI tool-calling protocol (for the agent).
export function activeToolProvider() {
  for (const p of PROVIDERS) {
    const s = providerStatus(p.id);
    if (s.ready && p.shape === "openai") return s;
  }
  return null;
}

// Raw OpenAI-compatible chat call returning the full response (so the agent can
// read tool_calls). Supports the `tools` param for function calling.
export async function callOpenAIRaw(id, { messages, tools, toolChoice, temperature = 0.2 }) {
  const p = PROVIDER_BY_ID[id];
  const cfg = { ...(loadVault()[id] || {}), key: await providerKey(id) };
  if (!p) throw new Error(`Unknown provider ${id}`);
  const body = { model: cfg.model || p.defaultModel, messages, ...(p.omitTemperature ? {} : { temperature }) };
  if (tools) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;
  if (viaBroker(p, cfg)) {
    const res = await connectorRequest(p.brokerService, "/chat/completions", { method: "POST", body });
    if (!res.ok) throw new Error(`${p.label} broker ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  const headers = { "Content-Type": "application/json" };
  if (!p.keyless) headers.Authorization = `Bearer ${cfg.key}`;
  if (id === "openrouter") {
    headers["HTTP-Referer"] = typeof window !== "undefined" ? window.location.origin : "https://medantir.local";
    headers["X-Title"] = "Medantir";
  }
  const res = await fetch(p.endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${p.label} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function callProvider(id, messages, opts = {}) {
  const p = PROVIDER_BY_ID[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  // Embedded engines are multi-path (Nano / Transformers / WebLLM) and must go
  // through taskRouter so cascade, prefs, and batch classification stay coherent.
  if (p.shape === "local") {
    throw new Error("Local provider must be called via taskRouter (not callProvider)");
  }
  const cfg = { ...(loadVault()[id] || {}), key: await providerKey(id) };
  if (!p.keyless && !cfg.key && !viaBroker(p, cfg)) throw new Error(`No API key set for ${p.label}`);
  try {
    let result;
    if (p.shape === "anthropic") result = await callAnthropic(p, cfg, messages, opts);
    else if (p.shape === "google") result = await callGoogle(p, cfg, messages, opts);
    else result = await callOpenAICompatible(p, cfg, messages, opts);
    cbRecordSuccess(id);
    return result;
  } catch (e) {
    cbRecordFailure(id);
    throw e;
  }
}

// Simple round-trip connection test used by the settings UI.
export async function testProvider(id) {
  try {
    const out = await callProvider(id, [{ role: "user", content: "Reply with the single word: OK" }]);
    return { ok: true, sample: (out || "").trim().slice(0, 40) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// --- AI sentiment enrichment --------------------------------------------
// Ask the active model to score one media item. Returns null on any failure so
// the caller can fall back to the lexicon result — the board never breaks.
export async function aiSentiment(text, providerId) {
  const id = providerId || activeProvider()?.id;
  if (!id) return null;
  const messages = [
    {
      role: "system",
      content:
        "You are a geopolitical media sentiment analyst. Score the tone of a news item toward global-security stability. Output strict JSON only.",
    },
    {
      role: "user",
      content:
        `Analyse this media item. Return JSON: {"sentiment": number in [-1,1] where -1=severe alarm/deterioration and 1=stabilising/positive, "domain": one of ["health","defence","climate","energy","economy","cyber","food","migration"], "rationale": short string}.\n\nITEM: ${text}`,
    },
  ];
  try {
    const raw = await callProvider(id, messages, { json: true });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.sentiment !== "number") return null;
    return {
      compound: Math.max(-1, Math.min(1, parsed.sentiment)),
      domain: parsed.domain,
      rationale: parsed.rationale,
      method: `ai:${id}`,
    };
  } catch {
    return null;
  }
}
