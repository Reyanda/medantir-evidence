// auth.js — Real authentication linked to the Khwelero engine.
//
// Sign-in authenticates against the operator's own Khwelero PaaS auth API and
// stores the returned token, which then authorizes calls to Khwelero-hosted
// modules. Non-blocking: the platform stays live-from-start for the local operator;
// auth is available (not a wall) and gracefully degrades when Khwelero is offline.

import { callModule } from "./modules.js";
import { deleteSecret, getSecret, hasSecret, putSecret } from "./secureVault.js";

const KEY = "medantir.auth.v1";

export function authState() {
  try {
    const state = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!state) return null;
    const { token: _legacyToken, ...safe } = state;
    return { ...safe, hasToken: safe.hasToken || hasSecret("session/khwelero/token") };
  } catch {
    return null;
  }
}
export function isAuthed() {
  return hasSecret("session/khwelero/token");
}
export async function authToken() {
  return getSecret("session/khwelero/token");
}

function persist(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// Authenticate against Khwelero (/api/auth/login). Returns {ok, user|error}.
export async function login(email, password) {
  const r = await callModule("khwelero", "/api/auth/login", { method: "POST", body: { email, password } });
  if (r.ok && (r.data?.token || r.data?.access_token)) {
    const secret = await putSecret("session/khwelero/token", r.data.token || r.data.access_token);
    if (!secret.ok) return { ok: false, error: "Unlock Security & Vault before signing in." };
    const state = { email, hasToken: true, user: r.data.user || { email }, at: Date.now() };
    persist(state);
    return { ok: true, user: state.user };
  }
  return { ok: false, error: r.error || r.data?.message || `Khwelero auth failed (${r.status || "offline"})` };
}

export async function logout() {
  await deleteSecret("session/khwelero/token");
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
