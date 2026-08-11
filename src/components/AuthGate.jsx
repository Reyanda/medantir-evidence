import React, { useEffect, useState } from "react";
import { HeartPulse, Loader2, ShieldCheck, UserPlus, LogIn } from "lucide-react";
import { signup, login, SUDO_EMAILS } from "../engine/accounts.js";
import { beginCloudLogin, cloudAuthEnabled, completeCloudCallback } from "../engine/cloudAuth.js";

export default function AuthGate({ onAuthed }) {
  const managed = cloudAuthEnabled();
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const willBeSudo = SUDO_EMAILS.includes(email.trim().toLowerCase());

  useEffect(() => {
    if (!managed || window.location.pathname !== "/auth/callback") return;
    setBusy(true); setErr("");
    completeCloudCallback()
      .then((user) => user && onAuthed(user))
      .catch((cause) => setErr(String(cause.message || cause)))
      .finally(() => setBusy(false));
  }, [managed]);

  const submit = async () => {
    setBusy(true); setErr("");
    const result = mode === "signup" ? await signup({ email, password, name }) : await login({ email, password });
    setBusy(false);
    if (result.ok) onAuthed(result.user); else setErr(result.error);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-4 font-sans selection:bg-[var(--color-brand-primary)] selection:text-white">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <div className="bg-[var(--color-brand-primary)] p-2.5 rounded-lg text-white shadow-lg shadow-[var(--color-brand-primary)]/30">
            <HeartPulse className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-wider text-white">MEDANTIR</div>
            <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest">Global Intelligence</div>
          </div>
        </div>

        {/* Auth Card */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 shadow-2xl space-y-4 backdrop-blur-md">
          {managed ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-zinc-300">
              <div className="flex items-center gap-2 font-semibold text-emerald-400 mb-1">
                <ShieldCheck className="h-4 w-4" /> Managed Actiora Identity
              </div>
              Authentication and profiles are secured using Cognito user pool authentication.
            </div>
          ) : (
            <>
              {/* Form Toggles */}
              <div className="flex rounded-lg border border-zinc-800 overflow-hidden text-xs bg-zinc-900/40 p-0.5">
                <button 
                  onClick={() => setMode("signup")} 
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md transition-all ${mode === "signup" ? "bg-[var(--color-brand-primary)] text-white font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
                >
                  <UserPlus className="h-3.5 w-3.5" /> Sign Up
                </button>
                <button 
                  onClick={() => setMode("login")} 
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md transition-all ${mode === "login" ? "bg-[var(--color-brand-primary)] text-white font-semibold" : "text-zinc-400 hover:text-zinc-200"}`}
                >
                  <LogIn className="h-3.5 w-3.5" /> Sign In
                </button>
              </div>

              {/* Form Inputs */}
              {mode === "signup" && (
                <input 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  placeholder="name (optional)" 
                  aria-label="Name (optional)" 
                  autoComplete="name" 
                  className="w-full text-sm px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 outline-none focus:border-[var(--color-brand-primary)] focus:bg-zinc-900/80 transition-colors text-white placeholder-zinc-500" 
                />
              )}
              <input 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                type="email" 
                placeholder="email address" 
                aria-label="Email" 
                autoComplete="email" 
                className="w-full text-sm px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 outline-none focus:border-[var(--color-brand-primary)] focus:bg-zinc-900/80 transition-colors text-white placeholder-zinc-500" 
              />
              <input 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                onKeyDown={(e) => e.key === "Enter" && submit()} 
                type="password" 
                placeholder="password" 
                aria-label="Password" 
                autoComplete={mode === "signup" ? "new-password" : "current-password"} 
                className="w-full text-sm px-3.5 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 outline-none focus:border-[var(--color-brand-primary)] focus:bg-zinc-900/80 transition-colors text-white placeholder-zinc-500" 
              />
              {willBeSudo && mode === "signup" && (
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" /> detected as SUDO — administrator clearance
                </div>
              )}
            </>
          )}

          {err && <div role="alert" className="text-[11px] font-mono text-rose-500 text-center">{err}</div>}

          {/* Action Button */}
          <button 
            onClick={managed ? beginCloudLogin : submit} 
            disabled={busy} 
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-sm font-semibold py-3 rounded-lg shadow-lg shadow-[var(--color-brand-primary)]/15"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} 
            {managed ? "Sign in securely" : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
        </div>

        {/* Card Footer */}
        <div className="text-[9px] font-mono text-zinc-500 text-center mt-4">
          {managed ? "OAuth 2.0 PKCE · Multi-tenant Session Isolation" : `Device-local accounts. First account or ${SUDO_EMAILS[0]} = administrator.`}
        </div>
      </div>
    </div>
  );
}
