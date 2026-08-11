// Provider-native institutional authentication routes. Medantir opens these in
// the supervised browser; credentials, MFA, SAML assertions, and cookies remain
// with the institution/provider and are never collected by the SPA.

const PROVIDER_ROUTES = {
  ebscohost: { provider: "EBSCOhost", url: "https://search.ebscohost.com/login.aspx?authtype=shib" },
  ovid: { provider: "Ovid", url: "https://ovidsp.ovid.com/" },
  elsevier: { provider: "Elsevier", url: "https://www.scopus.com/" },
  clarivate: { provider: "Web of Science", url: "https://www.webofscience.com/" },
  research4life: { provider: "Research4Life", url: "https://login.research4life.org/tacgw/login.cshtml" },
  proquest: { provider: "ProQuest", url: "https://www.proquest.com/" },
  cochrane: { provider: "Cochrane Library", url: "https://www.cochranelibrary.com/" },
  gisaid: { provider: "GISAID", url: "https://www.gisaid.org/" },
};

const SOURCE_TO_PROVIDER = {
  ovid_medline: "ovid",
  ovid_embase: "ovid",
  cinahl: "ebscohost",
  psycinfo: "ebscohost",
  embase_com: "elsevier",
  scopus: "elsevier",
  wos: "clarivate",
  research4life: "research4life",
  cochrane: "cochrane",
  gisaid: "gisaid",
};

export const INSTITUTION_PRESETS = [
  { id: "generic", label: "Find my institution", hint: "Use the provider's organisation discovery page." },
  { id: "qmul", label: "Queen Mary University of London", hint: "Choose Queen Mary University of London when the provider asks for your institution." },
];

export function safeInstitutionalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function institutionalLoginTarget(id, customEndpoint = "") {
  const providerId = PROVIDER_ROUTES[id] ? id : SOURCE_TO_PROVIDER[id];
  const route = PROVIDER_ROUTES[providerId];
  if (route) return { ok: true, providerId, ...route };
  const url = safeInstitutionalUrl(customEndpoint);
  return url
    ? { ok: true, providerId: id, provider: "Custom institutional provider", url }
    : { ok: false, error: "Add a valid HTTPS provider login or database URL." };
}

export function institutionPreset(id) {
  return INSTITUTION_PRESETS.find((item) => item.id === id) || INSTITUTION_PRESETS[0];
}

// --- stored institutional credentials ---------------------------------------
// The same institutional login usually opens several providers, so retyping it
// per provider is pure friction. Credentials live in the existing AES-256-GCM
// vault (PBKDF2-derived key, per-user AAD, unlocked only in memory) and are read
// only to fill a form in the local browser. They are never sent to any server,
// never written to run state, and never logged.

const CREDENTIAL_PURPOSE = "institution/credentials";

/** One credential set shared by every provider that accepts it, plus optional
 *  per-provider overrides for the ones that differ. */
export async function saveInstitutionalCredentials({ username, password, providerId = "default" }) {
  const { getSecret, putSecret } = await import("./secureVault.js");
  const existing = (await getSecret(CREDENTIAL_PURPOSE).catch(() => null)) || {};
  const store = typeof existing === "object" && existing ? existing : {};
  store[providerId] = { username: String(username || ""), password: String(password || ""), savedAt: Date.now() };
  await putSecret(CREDENTIAL_PURPOSE, store);
  return { ok: true, providerId };
}

/** Resolve the credential for a database: its provider's own entry if one exists,
 *  otherwise the shared default. */
export async function institutionalCredentialsFor(databaseId) {
  const { getSecret, hasSecret } = await import("./secureVault.js");
  if (!hasSecret(CREDENTIAL_PURPOSE)) return null;
  const store = await getSecret(CREDENTIAL_PURPOSE).catch(() => null);
  if (!store || typeof store !== "object") return null;
  const providerId = SOURCE_TO_PROVIDER[databaseId] || databaseId;
  const entry = store[providerId] || store[databaseId] || store.default;
  return entry?.username || entry?.password ? { ...entry, providerId } : null;
}

export async function storedCredentialProviders() {
  const { getSecret, hasSecret } = await import("./secureVault.js");
  if (!hasSecret(CREDENTIAL_PURPOSE)) return [];
  const store = await getSecret(CREDENTIAL_PURPOSE).catch(() => null);
  return store && typeof store === "object" ? Object.keys(store) : [];
}

export async function forgetInstitutionalCredentials(providerId) {
  const { getSecret, putSecret, deleteSecret } = await import("./secureVault.js");
  const store = (await getSecret(CREDENTIAL_PURPOSE).catch(() => null)) || {};
  if (!providerId) return deleteSecret(CREDENTIAL_PURPOSE);
  delete store[providerId];
  return putSecret(CREDENTIAL_PURPOSE, store);
}

/** Fill the provider's sign-in form in the local browser from the vault.
 *  Submission stays manual so an MFA or consent step is never skipped. */
export async function fillStoredCredentials(databaseId) {
  const runtime = typeof window !== "undefined" ? window.__medantirDesktop__ : null;
  if (!runtime?.database?.autofill) {
    return { ok: false, error: "Autofill needs the desktop shell, which owns the browser session." };
  }
  const credential = await institutionalCredentialsFor(databaseId);
  if (!credential) {
    return { ok: false, error: "No institutional credentials are saved yet. Add them in Security & Vault." };
  }
  return runtime.database.autofill({ username: credential.username, password: credential.password });
}

export function openInstitutionalLogin(url) {
  const safeUrl = safeInstitutionalUrl(url);
  if (!safeUrl) return false;
  const opened = globalThis.open?.(safeUrl, "_blank", "noopener,noreferrer");
  return opened !== null && opened !== undefined;
}
