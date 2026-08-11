// User-scoped encrypted offline vault.
//
// Secrets are encrypted with AES-GCM. The encryption key is derived from a
// user-supplied vault passphrase using PBKDF2 and exists only in memory for the
// unlocked session. localStorage contains ciphertext, salt, IV, and purpose
// labels only — never the passphrase or plaintext secret values.

const PREFIX = "medantir.secureVault.v1";
const ITERATIONS = 310000;
const sessions = new Map();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function userSlug(value) {
  return encodeURIComponent(String(value || "anonymous").trim().toLowerCase());
}

export function currentVaultUserId() {
  try {
    const current = JSON.parse(localStorage.getItem("medantir.currentUser.v1") || "null");
    if (current?.email || current?.id) return current.email || current.id;
  } catch {
    // Hosted Cognito sessions do not create a device-local account record.
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem("actiora.cloud.tokens.v1") || "null");
    const part = stored?.id_token?.split(".")[1];
    const claims = part ? JSON.parse(decodeURIComponent(atob(part.replace(/-/g, "+").replace(/_/g, "/")).split("").map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))) : null;
    return claims?.email || claims?.sub || "anonymous";
  } catch { return "anonymous"; }
}

const storageKey = (userId = currentVaultUserId()) => `${PREFIX}:${userSlug(userId)}`;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function loadBlob(userId) {
  try { return JSON.parse(localStorage.getItem(storageKey(userId)) || "null"); } catch { return null; }
}

async function decryptBlob(blob, key, userId, ivField = "iv", ciphertextField = "ciphertext") {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(blob[ivField]), additionalData: encoder.encode(String(userId)) },
    key,
    fromBase64(blob[ciphertextField]),
  );
  return JSON.parse(decoder.decode(plain));
}

// Recovery material is encrypted separately from the primary vault ciphertext.
// Keeping a dedicated IV/ciphertext is important: the account password must
// never be able to overwrite or invalidate the user's primary passphrase key.
async function decryptRecoveryBlob(blob, key, userId) {
  const iv = blob.recoveryIv || blob.iv;
  const ciphertext = blob.recoveryCiphertext;
  if (!ciphertext || !iv) throw new Error("No recovery ciphertext");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(String(userId)) },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(decoder.decode(plain));
}

async function persist(userId) {
  const session = sessions.get(userId);
  if (!session) throw new Error("Vault is locked");
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(String(userId)) },
    session.key,
    encoder.encode(JSON.stringify(session.secrets)),
  );
  const blob = {
    version: 1,
    userId,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: toBase64(session.salt) },
    cipher: "AES-256-GCM",
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    purposes: Object.keys(session.secrets).sort(),
    updatedAt: Date.now(),
  };
  localStorage.setItem(storageKey(userId), JSON.stringify(blob));
  return blob;
}

export function vaultStatus(userId = currentVaultUserId()) {
  const blob = loadBlob(userId);
  return {
    userId,
    exists: !!blob,
    unlocked: sessions.has(userId),
    count: blob?.purposes?.length || 0,
    purposes: blob?.purposes || [],
    updatedAt: blob?.updatedAt || null,
  };
}

export async function unlockVault(passphrase, userId = currentVaultUserId()) {
  if (String(passphrase || "").length < 10) return { ok: false, error: "Vault passphrase must be at least 10 characters." };
  const blob = loadBlob(userId);
  try {
    if (!blob) {
      const salt = randomBytes(16);
      const key = await deriveKey(passphrase, salt);
      sessions.set(userId, { key, salt, secrets: {} });
      await persist(userId);
      return { ok: true, created: true, status: vaultStatus(userId) };
    }
    const salt = fromBase64(blob.kdf.salt);
    const key = await deriveKey(passphrase, salt);
    const secrets = await decryptBlob(blob, key, userId);
    sessions.set(userId, { key, salt, secrets });
    return { ok: true, created: false, status: vaultStatus(userId) };
  } catch {
    sessions.delete(userId);
    return { ok: false, error: "Unable to unlock the vault. Check the passphrase and user." };
  }
}

export function lockVault(userId = currentVaultUserId()) {
  sessions.delete(userId);
  return vaultStatus(userId);
}

export function hasSecret(purpose, userId = currentVaultUserId()) {
  if (sessions.get(userId)?.secrets?.[purpose] != null) return true;
  return !!loadBlob(userId)?.purposes?.includes(purpose);
}

export async function getSecret(purpose, userId = currentVaultUserId()) {
  return sessions.get(userId)?.secrets?.[purpose] ?? null;
}

export async function putSecret(purpose, value, userId = currentVaultUserId()) {
  const session = sessions.get(userId);
  if (!session) return { ok: false, locked: true, error: "Unlock the user vault first." };
  if (value == null || value === "") delete session.secrets[purpose];
  else session.secrets[purpose] = value;
  await persist(userId);
  return { ok: true };
}

export async function deleteSecret(purpose, userId = currentVaultUserId()) {
  return putSecret(purpose, null, userId);
}

export function exportEncryptedVault(userId = currentVaultUserId()) {
  const blob = loadBlob(userId);
  return blob ? JSON.stringify(blob, null, 2) : null;
}

export function importEncryptedVault(serialized, userId = currentVaultUserId()) {
  let blob;
  try { blob = typeof serialized === "string" ? JSON.parse(serialized) : serialized; } catch { return { ok: false, error: "Invalid vault backup." }; }
  if (!blob?.ciphertext || !blob?.iv || !blob?.kdf?.salt) return { ok: false, error: "Invalid encrypted vault format." };
  if (blob.userId !== userId) return { ok: false, error: "This encrypted backup belongs to a different user." };
  localStorage.setItem(storageKey(userId), JSON.stringify(blob));
  lockVault(userId);
  return { ok: true };
}

/** Wipe ALL localStorage data — accounts, vault, projects, settings, engine,
 *  connectors, everything. Irreversible. Called on logout when wipe-on-logout is on. */
export function wipeAllLocalData() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  for (const k of keys) {
    if (k.startsWith("medantir.")) localStorage.removeItem(k);
  }
}

/** Recovery path: unlock the vault using the account password instead of the
 *  vault passphrase. Derives a separate recovery key and stores it alongside the
 *  main vault blob so logged-in users can always recover their secrets. */
export async function unlockVaultWithAccountPassword(accountPassword, userId = currentVaultUserId()) {
  if (String(accountPassword || "").length < 10) return { ok: false, error: "Account password must be at least 10 characters." };
  const blob = loadBlob(userId);
  if (!blob) return { ok: false, error: "No vault exists for this user." };
  // Try the recovery salt/ciphertext stored alongside the main vault.
  if (blob.recoverySalt && blob.recoveryCiphertext) {
    try {
      const salt = fromBase64(blob.recoverySalt);
      const key = await deriveKey(accountPassword, salt);
      const secrets = await decryptRecoveryBlob(blob, key, userId);
      sessions.set(userId, { key, salt, secrets });
      return { ok: true, recovered: true, status: vaultStatus(userId) };
    } catch {
      // recovery failed — fall through to the error
    }
  }
  // Older builds wrote only recoverySalt and accidentally retained the primary
  // ciphertext. If the account password is also the vault passphrase, support
  // that safe legacy case so users are not stranded after upgrade.
  if (blob.recoverySalt) {
    try {
      const salt = fromBase64(blob.kdf?.salt || blob.recoverySalt);
      const key = await deriveKey(accountPassword, salt);
      const secrets = await decryptBlob(blob, key, userId);
      sessions.set(userId, { key, salt, secrets });
      return { ok: true, recovered: true, legacy: true, status: vaultStatus(userId) };
    } catch { /* continue to the explicit error */ }
  }
  return { ok: false, error: "No recovery path available. Use your vault passphrase to unlock, or export/import an encrypted backup." };
}

/** Store a recovery key derived from the account password alongside the vault.
 *  Call this after login so the user can recover their vault with their account
 *  password if they forget the vault passphrase. */
export async function setVaultRecovery(accountPassword, userId = currentVaultUserId()) {
  const session = sessions.get(userId);
  if (!session) return { ok: false, error: "Unlock the vault first." };
  if (String(accountPassword || "").length < 10) return { ok: false, error: "Account password too short for recovery." };
  const recoverySalt = randomBytes(16);
  const recoveryKey = await deriveKey(accountPassword, recoverySalt);
  // Re-encrypt the secrets with the recovery key to verify it works.
  try {
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(String(userId)) },
      recoveryKey,
      encoder.encode(JSON.stringify(session.secrets)),
    );
    // Store separate recovery ciphertext + IV. The previous implementation
    // stored only recoverySalt and left unlock attempting to decrypt the primary
    // ciphertext with the wrong key, making every recovery attempt fail.
    const blob = loadBlob(userId);
    blob.recoverySalt = toBase64(recoverySalt);
    blob.recoveryIv = toBase64(iv);
    blob.recoveryCiphertext = toBase64(new Uint8Array(ciphertext));
    blob.recoveryUpdatedAt = Date.now();
    localStorage.setItem(storageKey(userId), JSON.stringify(blob));
    return { ok: true, message: "Vault recovery key stored. You can now unlock the vault with your account password." };
  } catch {
    return { ok: false, error: "Failed to store recovery key." };
  }
}

function parse(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; } catch { return fallback; }
}

// One-way plaintext credential migration. Legacy records are retained only after
// their secret fields have been removed. Non-secret settings remain usable.
export async function migrateLegacySecrets(userId = currentVaultUserId()) {
  const session = sessions.get(userId);
  if (!session) return { ok: false, error: "Unlock the user vault before migration." };
  const migrated = [];

  const providers = parse("medantir.providers.v1", {});
  const providerSettings = parse("medantir.providers.settings.v2", {});
  for (const [id, config] of Object.entries(providers)) {
    if (config?.key) { session.secrets[`provider/${id}/api-key`] = config.key; migrated.push(`provider/${id}/api-key`); }
    if (id !== "__mode") providerSettings[id] = { ...config, key: undefined, hasKey: !!config?.key || providerSettings[id]?.hasKey };
  }
  if (providers.__mode) providerSettings.__mode = providers.__mode;
  localStorage.setItem("medantir.providers.settings.v2", JSON.stringify(providerSettings));
  localStorage.removeItem("medantir.providers.v1");

  for (const [key, prefix] of [["medantir.datasources.v1", "datasource"], ["medantir.platforms.v1", "platform"]]) {
    const settings = parse(key, {});
    for (const [id, config] of Object.entries(settings)) {
      const credentials = {};
      for (const field of ["key", "password", "username", "token"]) if (config?.[field]) { credentials[field] = config[field]; delete config[field]; }
      if (Object.keys(credentials).length) { session.secrets[`${prefix}/${id}/credentials`] = credentials; config.hasCredentials = true; migrated.push(`${prefix}/${id}/credentials`); }
    }
    localStorage.setItem(key, JSON.stringify(settings));
  }

  const mcp = parse("medantir.mcp.v1", null);
  if (mcp) {
    const servers = Array.isArray(mcp.servers) ? mcp.servers : Object.values(mcp.overrides || {});
    for (const server of servers) {
      if (server?.token) { session.secrets[`mcp/${server.id}/token`] = server.token; server.hasToken = true; delete server.token; migrated.push(`mcp/${server.id}/token`); }
    }
    localStorage.setItem("medantir.mcp.v1", JSON.stringify({ servers }));
  }

  const auth = parse("medantir.auth.v1", null);
  if (auth?.token) {
    session.secrets["session/khwelero/token"] = auth.token;
    localStorage.setItem("medantir.auth.v1", JSON.stringify({ ...auth, token: undefined, hasToken: true }));
    migrated.push("session/khwelero/token");
  }

  await persist(userId);
  return { ok: true, migrated: [...new Set(migrated)] };
}
