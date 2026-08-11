// destructiveGuard.js — credential + typed-phrase gate for irreversible actions.
//
// Reversible operations stay ungated: detaching a folder only unlinks it, and
// archiving a project can be restored. Only operations that destroy data pass
// through here, and each one requires three independent signals — the signed-in
// account's email, its password, and the confirmation phrase typed out in full.
//
// Every confirmed deletion is appended to a local audit trail so an irreversible
// action can always be traced back to the account that authorised it.

import { verifyCredentials } from "./accounts.js";

export const CONFIRMATION_PHRASE = "I want to delete";

const AUDIT_KEY = "medantir.destructive.audit.v1";
const AUDIT_LIMIT = 200;

/** Collapse whitespace so natural typing matches, while the wording must be exact. */
function normalisePhrase(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function phraseMatches(typed) {
  return normalisePhrase(typed) === normalisePhrase(CONFIRMATION_PHRASE);
}

function readAudit() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function listDeletionAudit() {
  return readAudit();
}

function recordDeletion(entry) {
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify([entry, ...readAudit()].slice(0, AUDIT_LIMIT)));
  } catch {
    // A full or unavailable quota must not block the deletion the user authorised.
  }
}

/**
 * Authorise one irreversible action.
 *
 * Fails closed: any missing signal, mismatched account, or wrong phrase returns
 * an error and the caller must not proceed. Returns the audit entry on success.
 */
export async function authoriseDeletion({ email, password, phrase, subject, detail = "" }) {
  if (!phraseMatches(phrase)) {
    return { ok: false, error: `Type “${CONFIRMATION_PHRASE}” exactly to confirm.`, field: "phrase" };
  }
  const verified = await verifyCredentials({ email, password });
  if (!verified.ok) return { ok: false, error: verified.error, field: "credentials" };

  const entry = { at: Date.now(), email: verified.email, subject: String(subject || "Unnamed item"), detail: String(detail || "") };
  recordDeletion(entry);
  return { ok: true, entry };
}
