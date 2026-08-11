// accounts.js — Account creation, login, and role (sudo) management.
//
// Client-side account store (salted PBKDF2 password records via SubtleCrypto). The first
// account created — and always the designated sudo email — becomes the SUDO user
// with full clearance and every engine. Regular accounts get the standard tier.
//
// NOTE: this is device-local auth. It is structured so login()/signup() can be
// swapped to a Khwelero/Cognito backend later without changing the UI.

import { saveSession, applyProfile, loadSession } from "./session.js";
import { lockVault } from "./secureVault.js";
import { clearCloudSession, cloudAuthEnabled, cloudCurrentUser } from "./cloudAuth.js";

const USERS_KEY = "medantir.accounts.v1";
const CURRENT_KEY = "medantir.currentUser.v1";
export const SUDO_EMAILS = ["gmanda@outlook.com"];

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PASSWORD_ITERATIONS = 210000;
const bytesToHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex) => Uint8Array.from(String(hex).match(/.{1,2}/g) || [], (byte) => parseInt(byte, 16));

async function passwordRecord(password, salt = null) {
  const actualSalt = salt || crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: actualSalt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, material, 256);
  return { algorithm: "PBKDF2-SHA256", iterations: PASSWORD_ITERATIONS, salt: bytesToHex(actualSalt), hash: bytesToHex(new Uint8Array(bits)) };
}

async function passwordMatches(password, record) {
  const candidate = await passwordRecord(password, hexToBytes(record.salt));
  if (candidate.hash.length !== record.hash.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.hash.length; index++) difference |= candidate.hash.charCodeAt(index) ^ record.hash.charCodeAt(index);
  return difference === 0;
}

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "{}"); } catch { return {}; }
}
function saveUsers(u) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch { /* ignore */ }
}

export function currentUser() {
  if (cloudAuthEnabled()) return cloudCurrentUser();
  try { return JSON.parse(localStorage.getItem(CURRENT_KEY) || "null"); } catch { return null; }
}
function setCurrent(user) {
  const safe = { email: user.email, name: user.name, role: user.role };
  try { localStorage.setItem(CURRENT_KEY, JSON.stringify(safe)); } catch { /* ignore */ }
  return safe;
}

export function isSudo(user = currentUser()) {
  return user?.role === "sudo";
}

// Map an account onto the runtime session (profile / clearance / identity).
export function applyAccountToSession(user = currentUser()) {
  if (!user) return;
  const prior = loadSession();
  if (user.role === "sudo") {
    applyProfile("operator");
    // Authentication restores the user's working context; it must not silently
    // reset an atomic/aggregate location selection on every page load.
    saveSession({ name: user.name || "Operator", clearance: 4, scope: prior.scope, scopeKind: prior.scopeKind, scopeLoc: prior.scopeLoc });
  } else {
    applyProfile("personal");
    saveSession({ name: user.name || user.email, clearance: 2 });
  }
}

export async function signup({ email, password, name }) {
  email = (email || "").trim().toLowerCase();
  if (!email || !password) return { ok: false, error: "Email and password required" };
  if (password.length < 10) return { ok: false, error: "Password must be at least 10 characters" };
  const users = loadUsers();
  if (users[email]) return { ok: false, error: "Account already exists — sign in instead" };
  // sudo if designated email, or if this is the very first account
  const role = SUDO_EMAILS.includes(email) || Object.keys(users).length === 0 ? "sudo" : "user";
  const user = { email, name: name || email.split("@")[0], password: await passwordRecord(password), role, createdAt: Date.now() };
  users[email] = user;
  saveUsers(users);
  const cur = setCurrent(user);
  applyAccountToSession(cur);
  // Establish the same account↔vault link on first signup so the first session
  // does not immediately hit a locked-vault dead end when configuring keys.
  try {
    const { unlockVault, setVaultRecovery } = await import("./secureVault.js");
    const created = await unlockVault(password, email);
    if (created.ok) await setVaultRecovery(password, email);
  } catch { /* vault unavailable; the user can create it from Security & Vault */ }
  return { ok: true, user: cur };
}

export async function login({ email, password }) {
  email = (email || "").trim().toLowerCase();
  const users = loadUsers();
  const user = users[email];
  if (!user) return { ok: false, error: "No account for that email" };
  const valid = user.password ? await passwordMatches(password, user.password) : user.hash === (await sha256(password));
  if (!valid) return { ok: false, error: "Incorrect password" };
  // Upgrade legacy unsalted SHA-256 records after a successful login.
  if (!user.password) { user.password = await passwordRecord(password); delete user.hash; users[email] = user; saveUsers(users); }
  // keep sudo email authoritative even if role drifted
  if (SUDO_EMAILS.includes(email) && user.role !== "sudo") { user.role = "sudo"; users[email] = user; saveUsers(users); }
  const cur = setCurrent(user);
  applyAccountToSession(cur);
  // Link the authenticated account session to its user-scoped vault. A first
  // login creates the vault with the account password as the recovery key; an
  // existing vault is recovered through its dedicated recovery ciphertext.
  // The password is used only in memory during this call and is never stored.
  try {
    const { unlockVault, unlockVaultWithAccountPassword, setVaultRecovery, vaultStatus } = await import("./secureVault.js");
    const status = vaultStatus(email);
    if (!status.unlocked) {
      let recovered = status.exists
        ? await unlockVaultWithAccountPassword(password, email)
        : await unlockVault(password, email);
      // Compatibility fallback for vaults created before account-password
      // recovery existed, where the user intentionally used the same password.
      if (status.exists && !recovered.ok) recovered = await unlockVault(password, email);
      // If the vault was created with a separate passphrase, do not replace it;
      // the user can explicitly unlock it later and then enable recovery.
      if (recovered.ok && recovered.legacy !== true) await setVaultRecovery(password, email);
    } else {
      // Refresh the recovery envelope after a successful authenticated login.
      await setVaultRecovery(password, email);
    }
  } catch { /* vault unavailable or no recovery key set */ }
  return { ok: true, user: cur };
}

/**
 * Re-verify credentials without touching session, role, or vault state.
 *
 * login() is the wrong tool for confirming a destructive action: it rotates the
 * current user, re-applies the profile, and unlocks the vault. This only answers
 * "does this password belong to this account", and fails closed when no local
 * password record exists (for example a cloud-auth session), so a destructive
 * action can never proceed unverified.
 */
export async function verifyCredentials({ email, password }) {
  const address = (email || "").trim().toLowerCase();
  if (!address || !password) return { ok: false, error: "Enter your account email and password." };
  const signedIn = currentUser();
  if (signedIn?.email && signedIn.email.trim().toLowerCase() !== address) {
    return { ok: false, error: "Confirm with the account that is currently signed in." };
  }
  const user = loadUsers()[address];
  if (!user) return { ok: false, error: "No local account for that email — cannot confirm here." };
  if (!user.password && !user.hash) return { ok: false, error: "This account has no local password record." };
  const valid = user.password ? await passwordMatches(password, user.password) : user.hash === (await sha256(password));
  return valid ? { ok: true, email: address } : { ok: false, error: "Incorrect password" };
}

export async function logout() {
  const user = currentUser();
  if (user) lockVault(user.email);
  // Wipe all local data if the user opted in.
  if (getWipeOnLogout()) {
    const { wipeAllLocalData } = await import("./secureVault.js");
    try { wipeAllLocalData(); } catch { /* storage unavailable */ }
  }
  try { localStorage.removeItem(CURRENT_KEY); } catch { /* ignore */ }
  if (cloudAuthEnabled()) clearCloudSession({ redirect: true });
}

// Wipe all localStorage on logout — clears accounts, vault, projects, settings,
// engine data, connector configs. Irreversible. Opt-in per user.
const WIPE_KEY = "medantir.wipeOnLogout";
export function getWipeOnLogout() {
  try { return localStorage.getItem(WIPE_KEY) === "1"; } catch { return false; }
}
export function setWipeOnLogout(enabled) {
  try { localStorage.setItem(WIPE_KEY, enabled ? "1" : "0"); } catch { /* ignore */ }
}

// Auto-logout after N minutes of inactivity (0 = off).
const AUTOLOGOUT_KEY = "medantir.autologout";
export function getAutoLogout() {
  try { return Number(localStorage.getItem(AUTOLOGOUT_KEY) || 0); } catch { return 0; }
}
export function setAutoLogout(minutes) {
  try { localStorage.setItem(AUTOLOGOUT_KEY, String(minutes || 0)); } catch { /* ignore */ }
}

// Sudo-only: list accounts and change roles (for subscription/tier management).
export function listAccounts() {
  return Object.values(loadUsers()).map((u) => ({ email: u.email, name: u.name, role: u.role, createdAt: u.createdAt }));
}
export function setRole(email, role) {
  if (!isSudo()) return { ok: false, error: "sudo required" };
  const users = loadUsers();
  if (!users[email]) return { ok: false, error: "no such account" };
  users[email].role = role;
  saveUsers(users);
  return { ok: true };
}
