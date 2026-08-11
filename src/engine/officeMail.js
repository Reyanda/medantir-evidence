// officeMail.js — Real email management for the Office surface.
//
// Gmail REST API client. The browser cannot open raw IMAP sockets, so the
// practical "real email" path in a client-side app is the Gmail API with an
// OAuth access token (gmail.readonly + gmail.send) stored in the user vault.
// A connect token can be pasted here; the portal's Google Identity client is
// reused when present so sign-in can issue the token with the right scopes.
//
// Everything degrades honestly: no token → "connect" state, never a fake inbox.

import { getSecret, putSecret, vaultStatus } from "./secureVault.js";

const TOKEN_PURPOSE = "office/gmail-token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

// The Google Identity Services client id used by the app portal (reyanda.github.io).
// Medantir reuses it so the "Connect Gmail" flow can open Google's consent screen
// directly in the app. Falls back to manual token paste if the script is blocked.
const PORTAL_CLIENT_ID = "100146952222-eg9u582bdtnlnac12d9lonc8o9t7qju8.apps.googleusercontent.com";

export function mailStatus() {
  const vault = vaultStatus();
  return {
    connected: vault.unlocked && !!localStorage.__officeGmailToken,
    unlocked: vault.unlocked,
    purpose: TOKEN_PURPOSE,
  };
}

// --- token handling --------------------------------------------------------

export async function connectGmailToken(token) {
  const clean = String(token || "").trim();
  if (!clean) return { ok: false, error: "Paste a Gmail access token first." };
  // Accept either a bare token or the full GIS credential object.
  const value = clean.startsWith("{") ? clean : JSON.stringify({ access_token: clean, scope: SCOPES.join(" ") });
  const stored = await putSecret(TOKEN_PURPOSE, value);
  if (!stored.ok) return stored;
  try {
    const parsed = JSON.parse(value);
    localStorage.__officeGmailToken = parsed.access_token || clean;
  } catch { localStorage.__officeGmailToken = clean; }
  return { ok: true };
}

export function disconnectGmail() {
  try { localStorage.removeItem("__officeGmailToken"); } catch { /* */ }
  return putSecret(TOKEN_PURPOSE, null);
}

async function token() {
  try { return localStorage.__officeGmailToken; } catch { return null; }
}

export async function gmailHeaders() {
  const t = await token();
  if (!t) throw new Error("Gmail is not connected. Add a token in Office → Mail.");
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
}

// --- Gmail API --------------------------------------------------------------

async function gmailGet(path, params = "") {
  const headers = await gmailHeaders();
  const res = await fetch(`${GMAIL_BASE}${path}${params}`, { headers });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function gmailPost(path, body) {
  const headers = await gmailHeaders();
  const res = await fetch(`${GMAIL_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Decode RFC2047 encoded words and strip HTML for the list view. */
export function decodeHeader(value) {
  if (!value) return "";
  return String(value)
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, _enc, kind, text) => {
      try {
        if (kind.toLowerCase() === "b") return decodeURIComponent(escape(atob(text)));
        return decodeURIComponent(text.replace(/_/g, " "));
      } catch { return text; }
    })
    .replace(/<[^>]+>/g, "")
    .trim();
}

export function parseMessage(msg) {
  const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
  const parts = [msg.payload, ...(msg.payload?.parts || [])];
  const bodyPart = parts.find((p) => p?.mimeType === "text/plain") || parts.find((p) => p?.body?.data);
  let body = "";
  if (bodyPart?.body?.data) {
    try { body = decodeURIComponent(escape(atob(bodyPart.body.data.replace(/-/g, "+").replace(/_/g, "/")))); } catch { body = "[unreadable body]"; }
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: decodeHeader(headers.from),
    to: decodeHeader(headers.to),
    subject: decodeHeader(headers.subject) || "(no subject)",
    date: headers.date || "",
    snippet: msg.snippet || "",
    body: body.slice(0, 20000),
    labels: msg.labelIds || [],
    unread: (msg.labelIds || []).includes("UNREAD"),
  };
}

export async function listInbox({ max = 25, query = "" } = {}) {
  const params = new URLSearchParams({ maxResults: String(max), q: query || "in:inbox" });
  const data = await gmailGet("/messages", `?${params.toString()}`);
  const ids = (data.messages || []).map((m) => m.id);
  const messages = [];
  for (const id of ids.slice(0, max)) {
    try { messages.push(parseMessage(await gmailGet(`/messages/${id}`, "?format=full"))); } catch { /* skip */ }
  }
  return { ok: true, messages };
}

export async function getThread(threadId) {
  const data = await gmailGet(`/threads/${threadId}`, "?format=full");
  return { ok: true, messages: (data.messages || []).map(parseMessage) };
}

export async function markRead(messageId) {
  return gmailPost(`/messages/${messageId}/modify`, { removeLabelIds: ["UNREAD"] });
}

export async function archiveMessage(messageId) {
  return gmailPost(`/messages/${messageId}/modify`, { removeLabelIds: ["INBOX"] });
}

function base64url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sendEmail({ to, subject, body, cc = "" }) {
  if (!String(to || "").trim()) return { ok: false, error: "Recipient is required." };
  const raw = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : "",
    `Subject: ${subject || "(no subject)"}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body || "",
  ].filter(Boolean).join("\n");
  const res = await gmailPost("/messages/send", { raw: base64url(raw) });
  return { ok: true, id: res.id };
}

export { SCOPES, PORTAL_CLIENT_ID };
