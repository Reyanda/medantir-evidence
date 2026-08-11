// OmniRoute integration for MEDANTIR.
//
// OmniRoute is a local-first OpenAI-compatible gateway. Registering it by
// extending the existing provider registry means Composer/tool calls, multi-model
// runs, circuit breaking, vault handling and model discovery all exercise the
// exact same MEDANTIR code path as direct providers.

import { PROVIDERS, PROVIDER_BY_ID, loadVault, saveVault } from "./providers.js";

// OmniRoute zero-config virtual routes. `:free` is a candidate-tier preference,
// not a zero-spend guarantee because upstream filtering is fail-open when no
// matching free candidate exists. Use the server-side strict budget ceiling for
// experiments that must not silently spill onto paid candidates.
export const OMNIROUTE_ROUTING_MODELS = Object.freeze([
  "auto",
  "auto/lkgp",
  "auto/coding",
  "auto/fast",
  "auto/cheap",
  "auto/smart",
  "auto/offline",
  "auto/chat:free",
  "auto/reasoning:free",
  "auto/coding:free",
  "auto/multimodal:free",
  "auto/vision:free",
]);

function configuredBaseUrl() {
  try {
    const configured = import.meta.env?.VITE_OMNIROUTE_BASE_URL;
    if (configured) return String(configured).replace(/\/$/, "");
  } catch {
    // import.meta.env is supplied by Vite; tests/non-Vite consumers use local default.
  }
  return "http://localhost:20128";
}

export const OMNIROUTE_PROVIDER = Object.freeze({
  id: "omniroute",
  label: "OmniRoute",
  icon: "OmniRoute",
  shape: "openai",
  endpoint: `${configuredBaseUrl()}/v1/chat/completions`,
  defaultModel: "auto",
  routingModels: OMNIROUTE_ROUTING_MODELS,
  note: "Local AI gateway. Routes MEDANTIR across connected models with health, quota, cost and quality-aware fallback. Free-tier routes require a strict budget cap if zero/near-zero spend must be enforced.",
});

function seedRoutingModels() {
  const vault = loadVault();
  const current = Array.isArray(vault.omniroute?.models) ? vault.omniroute.models : [];
  const merged = [...new Set([...OMNIROUTE_ROUTING_MODELS, ...current])];
  if (merged.length === current.length && merged.every((value, index) => value === current[index])) return;
  vault.omniroute = { ...(vault.omniroute || {}), models: merged };
  saveVault(vault);
}

export function registerOmniRouteProvider() {
  if (!PROVIDER_BY_ID.omniroute) {
    // Put an explicitly enabled OmniRoute ahead of direct providers so pipeline
    // experiments really exercise gateway routing instead of silently selecting a
    // previously configured direct provider. With no stored gateway key it remains
    // unready and has zero effect on the current default path.
    PROVIDERS.unshift(OMNIROUTE_PROVIDER);
    PROVIDER_BY_ID.omniroute = OMNIROUTE_PROVIDER;
  }
  seedRoutingModels();
  return PROVIDER_BY_ID.omniroute;
}

registerOmniRouteProvider();
