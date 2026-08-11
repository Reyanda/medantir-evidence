import React, { useEffect, useRef, useState } from "react";
import { KeyRound, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { CONFIRMATION_PHRASE, authoriseDeletion } from "../engine/destructiveGuard.js";
import { currentUser } from "../engine/accounts.js";

// Credential + typed-phrase gate standing in front of every irreversible action.
// Nothing is deleted here: the dialog only mints an authorisation that the caller
// passes to the store, so a store refuses to destroy anything it did not see
// confirmed. Reversible operations (detaching a folder, archiving a project)
// deliberately do not route through this.

const field = "w-full px-2.5 py-1.5 rounded-md text-xs bg-[var(--color-bg-canvas)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-primary)]";
const label = "text-[11px] font-medium text-[var(--color-text-secondary)]";

// Destructive affordances read from the semantic state layer, so a palette or
// appearance change restyles this dialog without touching it.
const danger = "rgb(var(--state-danger-rgb))";

export default function ConfirmDelete({ subject, detail = "", onConfirm, onCancel }) {
  const [email, setEmail] = useState(() => currentUser()?.email || "");
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef(null);

  useEffect(() => { passwordRef.current?.focus(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const authorisation = await authoriseDeletion({ email, password, phrase, subject, detail });
    setBusy(false);
    setPassword("");
    if (!authorisation.ok) { setError(authorisation.error); return; }
    onConfirm?.(authorisation);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onKeyDown={(event) => { if (event.key === "Escape") onCancel?.(); }}
    >
      <form
        onSubmit={submit}
        style={{ borderColor: "rgb(var(--state-danger-rgb) / 0.45)" }}
        className="chrome-surface w-full max-w-md space-y-4 border p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" style={{ color: danger }} />
          <div className="min-w-0">
            <h2 id="confirm-delete-title" className="text-sm font-semibold text-[var(--color-text-primary)]">
              Permanently delete this item?
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--color-text-secondary)]" title={subject}>{subject}</p>
            {detail ? <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">{detail}</p> : null}
            <p className="mt-2 text-[11px]" style={{ color: danger }}>This cannot be undone.</p>
          </div>
        </div>

        <div className="space-y-1">
          <span className={label}>Account email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
        </div>

        <div className="space-y-1">
          <span className={`${label} flex items-center gap-1.5`}><KeyRound className="h-3 w-3" />Password</span>
          <input
            ref={passwordRef}
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />
        </div>

        <div className="space-y-1">
          <span className={`${label} flex items-center gap-1.5`}>
            <Lock className="h-3 w-3" />Type “{CONFIRMATION_PHRASE}” to confirm
          </span>
          <input
            type="text"
            value={phrase}
            spellCheck={false}
            autoComplete="off"
            placeholder={CONFIRMATION_PHRASE}
            onChange={(event) => setPhrase(event.target.value)}
            className={field}
          />
        </div>

        {error ? <p className="text-[11px]" style={{ color: danger }} role="alert">{error}</p> : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            Keep it
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{ backgroundColor: danger }}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {busy ? "Verifying…" : "Delete permanently"}
          </button>
        </div>
      </form>
    </div>
  );
}
