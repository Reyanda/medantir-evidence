import React, { useState, useEffect, useCallback } from "react";
import {
  PROVIDERS, providerStatus, setProviderConfig, testProvider,
  getAIMode, setAIMode, discoverModels, discoveredModels, beginOpenRouterSignIn,
} from "../engine/providers.js";
import {
  vaultStatus, unlockVault, lockVault, unlockVaultWithAccountPassword,
  exportEncryptedVault, importEncryptedVault, setVaultRecovery,
} from "../engine/secureVault.js";
import {
  saveInstitutionalCredentials, forgetInstitutionalCredentials, storedCredentialProviders,
} from "../engine/institutionalAccess.js";
import { tracerBaseUrl, setTracerBaseUrl, tracerHealth, TRACER_START_COMMAND } from "../engine/tracerEngine.js";

// Settings as a workbench surface: two dense tables and a service block, not a
// wall of cards. Keys are written straight into the encrypted vault; nothing is
// held in component state after it is stored.
export default function SettingsPanel({ tab = "Providers" }) {
  const [, force] = useState(0);
  const refresh = useCallback(() => force((v) => v + 1), []);

  if (tab === "Logins") return <Logins refresh={refresh} />;
  if (tab === "Services") return <Services />;
  return <Providers refresh={refresh} />;
}

function Providers({ refresh }) {
  const vault = vaultStatus();
  const [mode, setMode] = useState(getAIMode());
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState({});

  const setDraft = (id, patch) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const persist = async (id, patch) => {
    setBusy(id);
    const res = await setProviderConfig(id, patch);
    setBusy("");
    if (res.ok && patch.key) setDraft(id, { key: "" });
    setResult((r) => ({ ...r, [id]: res.ok ? null : res.error }));
    refresh();
  };

  const test = async (id) => {
    setBusy(id);
    const res = await testProvider(id);
    setBusy("");
    setResult((r) => ({ ...r, [id]: res.ok ? `ok · ${res.model || "responded"}` : res.error }));
  };

  const discover = async (id) => {
    setBusy(id);
    const res = await discoverModels(id);
    setBusy("");
    setResult((r) => ({ ...r, [id]: res.ok ? `${res.models.length} models` : res.error }));
    refresh();
  };

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div className="wb-insp-title">Engine mode</div>
      <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
        {[["single", "Single model", "One enabled model answers. Fast, deterministic."],
          ["ensemble", "Multi-model", "Every enabled model answers; disagreement is reported."]].map(([id, label, hint]) => (
          <button key={id} className={`wb-tag ${mode === id ? "on" : ""}`} title={hint} onClick={() => { setAIMode(id); setMode(id); }}>
            {label}
          </button>
        ))}
      </div>

      {!vault.unlocked && (
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--warn)" }}>
          The vault is locked. Keys can be typed but not stored until it is unlocked on the Logins tab.
        </div>
      )}

      <div className="wb-insp-title">Providers</div>
      <table className="wb-grid">
        <thead>
          <tr>
            <th style={{ width: 150 }}>Provider</th>
            <th style={{ width: 54 }}>On</th>
            <th style={{ width: 220 }}>API key</th>
            <th style={{ width: 200 }}>Model</th>
            <th style={{ width: 92 }}>State</th>
            <th>Message</th>
            <th style={{ width: 150 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {PROVIDERS.map((p) => {
            const s = providerStatus(p.id);
            const draft = drafts[p.id] || {};
            const models = [...new Set([...(s.routingModels || []), ...(discoveredModels(p.id) || [])])];
            const state = s.enabled ? (s.hasKey || p.shape === "local" ? "configured" : "no key") : "off";
            return (
              <tr key={p.id}>
                <td title={p.note}>{p.label}</td>
                <td>
                  <input
                    type="checkbox" checked={!!s.enabled}
                    onChange={(e) => persist(p.id, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  {p.shape === "local" ? (
                    <span style={{ color: "var(--fg-faint)" }}>local, no key</span>
                  ) : (
                    <input
                      className="wb-input" type="password" style={{ width: "100%" }}
                      placeholder={s.hasKey ? "stored in vault" : "paste key"}
                      value={draft.key || ""}
                      onChange={(e) => setDraft(p.id, { key: e.target.value })}
                      onBlur={() => draft.key && persist(p.id, { key: draft.key, enabled: true })}
                    />
                  )}
                </td>
                <td>
                  <select
                    className="wb-select" style={{ width: "100%" }}
                    value={s.model || s.defaultModel || ""}
                    onChange={(e) => persist(p.id, { model: e.target.value })}
                  >
                    {[s.model, s.defaultModel, ...models].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </td>
                <td style={{ color: state === "configured" ? "var(--ok)" : state === "no key" ? "var(--warn)" : "var(--fg-faint)" }}>
                  {busy === p.id ? "working" : state}
                </td>
                <td style={{ color: result[p.id]?.startsWith?.("ok") ? "var(--ok)" : "var(--err)", fontFamily: "var(--mono)", fontSize: 10.5 }} title={result[p.id] || ""}>
                  {result[p.id] || ""}
                </td>
                <td>
                  <button className="wb-btn" onClick={() => test(p.id)} disabled={!!busy}>Test</button>
                  <button className="wb-btn" onClick={() => discover(p.id)} disabled={!!busy}>Models</button>
                  {p.id === "openrouter" && <button className="wb-btn" onClick={() => beginOpenRouterSignIn()}>Sign in</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Logins({ refresh }) {
  const status = vaultStatus();
  const [passphrase, setPassphrase] = useState("");
  const [accountPw, setAccountPw] = useState("");
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState([]);
  const [cred, setCred] = useState({ provider: "default", username: "", password: "" });

  useEffect(() => { storedCredentialProviders().then(setProviders).catch(() => setProviders([])); }, [status.unlocked, message]);

  const act = async (fn, ok) => { const res = await fn(); setMessage(res?.ok === false ? res.error : ok); refresh(); };

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div className="wb-insp-title">Encrypted vault</div>
      <div className="wb-prop"><span className="k">State</span>
        <span className="v mono" style={{ color: status.unlocked ? "var(--ok)" : "var(--warn)" }}>
          {status.exists ? (status.unlocked ? "unlocked for this session" : "locked") : "not created"}
        </span>
      </div>
      <div className="wb-prop">
        <span className="k">Passphrase</span>
        <input className="wb-input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={status.exists ? "unlock" : "create a vault"} />
      </div>
      <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
        <button className="wb-btn on" onClick={() => act(() => unlockVault(passphrase), "Vault unlocked for this session.")} disabled={!passphrase}>
          {status.exists ? "Unlock" : "Create"}
        </button>
        <button className="wb-btn" onClick={() => { lockVault(); setMessage("Vault locked."); refresh(); }} disabled={!status.unlocked}>Lock</button>
        <button
          className="wb-btn"
          title="Store a recovery key derived from your account password, so a forgotten vault passphrase is not a dead end"
          onClick={() => act(() => setVaultRecovery(accountPw), "Account-password recovery armed.")}
          disabled={!status.unlocked || !accountPw}
        >
          Arm recovery
        </button>
      </div>
      <div className="wb-prop">
        <span className="k">Recover</span>
        <input className="wb-input" type="password" value={accountPw} onChange={(e) => setAccountPw(e.target.value)} placeholder="account password" />
      </div>
      <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
        <button className="wb-btn" onClick={() => act(() => unlockVaultWithAccountPassword(accountPw), "Vault recovered with the account password.")} disabled={!accountPw}>Recover</button>
        <button className="wb-btn" onClick={() => {
          const blob = new Blob([exportEncryptedVault() || ""], { type: "application/json" });
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "medantir-vault.encrypted.json"; a.click(); URL.revokeObjectURL(a.href);
        }}>Export</button>
        <label className="wb-btn" style={{ cursor: "default" }}>
          Import
          <input
            type="file" accept="application/json" style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const res = importEncryptedVault(await f.text());
              setMessage(res?.ok === false ? res.error : "Vault imported. Unlock it with its own passphrase.");
              refresh();
            }}
          />
        </label>
      </div>

      <div className="wb-insp-title">Institutional and database logins</div>
      <div className="wb-prop">
        <span className="k">Provider</span>
        <input className="wb-input" value={cred.provider} onChange={(e) => setCred({ ...cred, provider: e.target.value })} placeholder="ovid, ebsco, shibboleth…" />
      </div>
      <div className="wb-prop">
        <span className="k">Username</span>
        <input className="wb-input" value={cred.username} onChange={(e) => setCred({ ...cred, username: e.target.value })} autoComplete="off" />
      </div>
      <div className="wb-prop">
        <span className="k">Password</span>
        <input className="wb-input" type="password" value={cred.password} onChange={(e) => setCred({ ...cred, password: e.target.value })} autoComplete="off" />
      </div>
      <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
        <button
          className="wb-btn on"
          disabled={!status.unlocked || (!cred.username && !cred.password)}
          onClick={async () => {
            await saveInstitutionalCredentials({ username: cred.username.trim(), password: cred.password, providerId: cred.provider });
            setCred({ ...cred, username: "", password: "" });
            setMessage(`Credentials for ${cred.provider} stored, encrypted in the vault.`);
          }}
        >
          Store
        </button>
      </div>

      <table className="wb-grid">
        <thead><tr><th>Stored provider</th><th style={{ width: 120 }}>Action</th></tr></thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p}>
              <td>{p}</td>
              <td><button className="wb-btn danger" onClick={async () => { await forgetInstitutionalCredentials(p); setMessage(`Credentials for ${p} removed.`); }}>Forget</button></td>
            </tr>
          ))}
          {providers.length === 0 && <tr><td colSpan={2} style={{ color: "var(--fg-faint)" }}>No stored logins.</td></tr>}
        </tbody>
      </table>

      {message && <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)" }}>{message}</div>}
    </div>
  );
}

function Services() {
  const [url, setUrl] = useState(tracerBaseUrl());
  const [health, setHealth] = useState(null);
  const check = async () => setHealth(await tracerHealth());
  useEffect(() => { check(); }, []);
  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div className="wb-insp-title">Tracer raster-to-vector service</div>
      <div className="wb-prop">
        <span className="k">Endpoint</span>
        <input className="wb-input" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => { setTracerBaseUrl(url); check(); }} />
      </div>
      <div className="wb-prop">
        <span className="k">State</span>
        <span className="v mono" style={{ color: health?.ok ? "var(--ok)" : "var(--err)" }}>{health?.ok ? "reachable" : "unreachable"}</span>
      </div>
      <div className="wb-prop"><span className="k">Start with</span><span className="v mono" style={{ userSelect: "text" }}>{TRACER_START_COMMAND}</span></div>
      <div style={{ padding: "4px 8px" }}><button className="wb-btn" onClick={check}>Re-check</button></div>
    </div>
  );
}
