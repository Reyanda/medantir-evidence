// Production Cognito OAuth 2.0 / OIDC client. Tokens are session-scoped and
// never written to localStorage. Local development keeps device accounts.
const REGION = "us-east-1";
const USER_POOL_ID = "us-east-1_omlm2MVag";
const CLIENT_ID = "4u0ql33esenhoe009k2hd0ls29";
// Branded hosted-UI domain (Cognito custom domain; the legacy
// *.auth.us-east-1.amazoncognito.com prefix remains valid as a fallback).
const DOMAIN = "https://auth.actiora.com";
const TOKEN_KEY = "actiora.cloud.tokens.v1";
const PKCE_KEY = "actiora.cloud.pkce.v1";

const browser = () => typeof window !== "undefined";
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomValue = (size = 32) => b64url(crypto.getRandomValues(new Uint8Array(size)));
function decode(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
  } catch { return null; }
}
function loadTokens() {
  if (!browser()) return null;
  try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null"); } catch { return null; }
}
function saveTokens(tokens) {
  const value = { ...(loadTokens() || {}), ...tokens, savedAt: Date.now() };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value));
  return value;
}

export function cloudAuthEnabled() {
  if (!browser()) return false;
  const hostname = window.location.hostname;
  return import.meta.env?.VITE_CLOUD_AUTH === "1" || hostname === "platform.actiora.com" || hostname === "reyanda.github.io";
}

export function cloudCurrentUser() {
  if (!cloudAuthEnabled()) return null;
  const claims = decode(loadTokens()?.id_token || "");
  if (!claims || Number(claims.exp || 0) * 1000 <= Date.now()) return null;
  const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [];
  return { id: claims.sub, sub: claims.sub, email: claims.email || "", name: claims.name || claims.email || "Actiora user", role: groups.includes("actiora-operator") ? "sudo" : "user", groups, auth: "cognito" };
}

export async function beginCloudLogin() {
  const verifier = randomValue(64);
  const state = randomValue(24);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, returnTo: returnTo === "/auth/callback" ? "/" : returnTo, createdAt: Date.now() }));
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", scope: "openid email profile", redirect_uri: `${window.location.origin}/auth/callback`, state, code_challenge_method: "S256", code_challenge: b64url(new Uint8Array(digest)) });
  window.location.assign(`${DOMAIN}/oauth2/authorize?${params}`);
}

async function tokenRequest(params) {
  const response = await fetch(`${DOMAIN}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description || body.error || `Sign-in failed (${response.status})`);
  return saveTokens(body);
}

export async function completeCloudCallback() {
  if (!cloudAuthEnabled() || window.location.pathname !== "/auth/callback") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("error")) throw new Error(params.get("error_description") || params.get("error"));
  const pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null");
  if (!params.get("code") || !pending?.verifier || params.get("state") !== pending.state || Date.now() - pending.createdAt > 600_000) throw new Error("The sign-in response could not be verified. Start sign-in again.");
  await tokenRequest({ grant_type: "authorization_code", client_id: CLIENT_ID, code: params.get("code"), redirect_uri: `${window.location.origin}/auth/callback`, code_verifier: pending.verifier });
  sessionStorage.removeItem(PKCE_KEY);
  const returnTo = pending.returnTo && pending.returnTo.startsWith("/") && !pending.returnTo.startsWith("//") ? pending.returnTo : "/";
  history.replaceState({}, "", returnTo);
  return cloudCurrentUser();
}

export async function cloudAccessToken() {
  if (!cloudAuthEnabled()) return null;
  let tokens = loadTokens();
  const claims = decode(tokens?.access_token || "");
  if (claims && Number(claims.exp || 0) * 1000 > Date.now() + 60_000) return tokens.access_token;
  if (!tokens?.refresh_token) return null;
  tokens = await tokenRequest({ grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: tokens.refresh_token });
  return tokens.access_token || null;
}

export async function cloudAuthHeaders(projectId, extra = {}) {
  const token = await cloudAccessToken();
  if (!token) throw new Error("Your Actiora session has expired. Sign in again.");
  if (!projectId) throw new Error("Select an active project first.");
  return { ...extra, Authorization: `Bearer ${token}`, "X-Actiora-Project": String(projectId) };
}

export function clearCloudSession({ redirect = false } = {}) {
  if (!browser()) return;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (redirect && cloudAuthEnabled()) {
    const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: `${window.location.origin}/` });
    window.location.assign(`${DOMAIN}/logout?${params}`);
  }
}

export const cloudAuthConfig = Object.freeze({ region: REGION, userPoolId: USER_POOL_ID, clientId: CLIENT_ID, domain: DOMAIN });
