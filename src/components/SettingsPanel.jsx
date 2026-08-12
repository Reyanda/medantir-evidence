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
import { tracerBaseUrl, setTracerBaseUrl, tracerHealth, tracerStartCommand, setTracerStartCommand } from "../engine/tracerEngine.js";
import {
  DATA_SOURCES, PLATFORMS, loadDataSources, setDataSource, sourceEnabled, platformEnabled,
  setPlatform, loadCustomSources, addCustomSource, removeCustomSource, setCustomSourceEnabled,
  searchSource, isSearchable,
} from "../engine/academic.js";

// Settings as a workbench surface: two dense tables and a service block, not a
// wall of cards. Keys are written straight into the encrypted vault; nothing is
// held in component state after it is stored.
export default function SettingsPanel({ tab = "AI models", onNote }) {
  const [, force] = useState(0);
  const refresh = useCallback(() => force((v) => v + 1), []);

  if (tab === "Logins") return <Logins refresh={refresh} />;
  if (tab === "Services") return <Services />;
  if (tab === "Databases") return <Databases refresh={refresh} onNote={onNote} />;
  return <Providers refresh={refresh} />;
}

// Which bibliographic databases this workbench may search, and on what terms.
// The distinction that matters is `kind`: keyless sources run now, key sources
// run once a key is in the vault, and login sources are subscription platforms
// that no browser can query directly — for those the workbench compiles the
// native syntax to paste, and says so rather than implying it can run them.
const KIND_NOTE = {
  keyless: "runs now — no credential needed",
  key: "runs once an API key is stored",
  login: "subscription platform — syntax is compiled to paste, not executed",
  browser: "compiled here, executed through a supervised browser route",
  service: "local service — must be running",
};

function Databases({ refresh, onNote }) {
  const [drafts, setDrafts] = useState({});
  const [test, setTest] = useState({});
  const [custom, setCustom] = useState(() => loadCustomSources());
  const [newSource, setNewSource] = useState({ name: "", url: "", enabled: true });
  const cfg = loadDataSources();

  const save = async (id, patch) => {
    await setDataSource(id, patch);
    setDrafts((d) => ({ ...d, [id]: { ...d[id], key: "" } }));
    refresh();
  };

  const probe = async (id) => {
    setTest((t) => ({ ...t, [id]: "testing" }));
    try {
      // searchSource returns a retrieval envelope, not a bare array — reporting
      // its own status and hit count is the point of probing.
      const res = await searchSource(id, "covid-19", { n: 3 });
      const retrieved = res?.retrieved ?? res?.records?.length ?? 0;
      const hits = res?.hitCount != null ? ` of ${res.hitCount.toLocaleString()}` : "";
      setTest((t) => ({
        ...t,
        [id]: res?.status === "error" || res?.error
          ? String(res.error || "error").slice(0, 90)
          : `ok · ${retrieved}${hits}`,
      }));
    } catch (e) {
      setTest((t) => ({ ...t, [id]: String(e.message || e).slice(0, 90) }));
    }
  };

  const byKind = (kind) => DATA_SOURCES.filter((s) => s.kind === kind);

  const Row = ({ source }) => {
    const enabled = sourceEnabled(source.id);
    const stored = cfg[source.id] || {};
    const runnable = isSearchable?.(source.id) ?? false;
    return (
      <tr>
        <td title={source.note}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: source.color, marginRight: 6 }} />
          {source.name}
        </td>
        <td style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-faint)" }}>{source.controlled}</td>
        <td style={{ color: enabled ? "var(--ok)" : "var(--fg-faint)" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => save(source.id, { enabled: e.target.checked })} />
        </td>
        <td>
          {source.auth === "apiKey" ? (
            <input
              className="wb-cell-input" type="password" style={{ textAlign: "left" }}
              placeholder={stored.hasCredentials ? "stored in vault" : "API key"}
              value={drafts[source.id]?.key || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [source.id]: { key: e.target.value } }))}
              onBlur={() => drafts[source.id]?.key && save(source.id, { key: drafts[source.id].key, enabled: true })}
            />
          ) : source.auth === "login" ? (
            <span style={{ color: "var(--fg-faint)", fontSize: 10.5 }}>credentials live in Logins</span>
          ) : (
            <span style={{ color: "var(--fg-faint)", fontSize: 10.5 }}>none needed</span>
          )}
        </td>
        <td style={{ fontSize: 10.5, color: runnable ? "var(--ok)" : "var(--warn)" }} title={KIND_NOTE[source.kind]}>
          {runnable ? "executable" : source.kind}
        </td>
        <td style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: String(test[source.id] || "").startsWith("ok") ? "var(--ok)" : "var(--err)" }} title={test[source.id] || ""}>
          {test[source.id] || ""}
        </td>
        <td>
          {runnable && <button className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => probe(source.id)}>Test</button>}
        </td>
      </tr>
    );
  };

  const Section = ({ title, kind }) => {
    const rows = byKind(kind);
    if (!rows.length) return null;
    return (
      <>
        <div className="wb-insp-title">{title} <span className="wb-count">{rows.length}</span></div>
        <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)" }}>{KIND_NOTE[kind]}</div>
        <table className="wb-grid">
          <thead>
            <tr>
              <th>Database</th><th style={{ width: 120 }}>Thesaurus</th><th style={{ width: 42 }}>On</th>
              <th style={{ width: 170 }}>Credential</th><th style={{ width: 92 }}>Execution</th>
              <th style={{ width: 150 }}>Probe</th><th style={{ width: 52 }} />
            </tr>
          </thead>
          <tbody>{rows.map((s) => <Row key={s.id} source={s} />)}</tbody>
        </table>
      </>
    );
  };

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
        This page is the catalogue: which databases exist, how each authenticates, and whether it
        can be executed at all. <strong style={{ color: "var(--fg)" }}>Which databases a given
        review searches is a protocol decision</strong>, made per review in the Search module and
        recorded in the PRISMA-S log — so it lives with the review, not here.
      </div>
      <div style={{ padding: "0 8px 6px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
        Keyless sources run from the browser now; key sources run once their key is in the vault;
        subscription platforms cannot be queried from a browser at all, so the workbench compiles
        their native syntax for you to run and records that route in the search log.
      </div>

      <Section title="Keyless — searchable now" kind="keyless" />
      <Section title="API key required" kind="key" />
      <Section title="Subscription platforms" kind="login" />
      <Section title="Supervised browser route" kind="browser" />
      <Section title="Local services" kind="service" />

      <div className="wb-insp-title">Platform credentials <span className="wb-count">{PLATFORMS.length}</span></div>
      <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)" }}>
        Institutions buy access by platform, not by database — one credential unlocks everything it bundles.
      </div>
      <table className="wb-grid">
        <thead><tr><th style={{ width: 170 }}>Platform</th><th style={{ width: 42 }}>On</th><th>Bundles</th></tr></thead>
        <tbody>
          {PLATFORMS.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td><input type="checkbox" checked={platformEnabled(p.id)} onChange={(e) => { setPlatform(p.id, { enabled: e.target.checked }); refresh(); }} /></td>
              <td style={{ color: "var(--fg-faint)", fontSize: 10.5 }} title={(p.bundles || []).join(", ")}>
                {(p.bundles || []).map((b) => DATA_SOURCES.find((s) => s.id === b)?.name || b).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="wb-insp-title">Your own API sources <span className="wb-count">{custom.length}</span></div>
      <table className="wb-grid">
        <thead><tr><th style={{ width: 160 }}>Name</th><th>Endpoint</th><th style={{ width: 42 }}>On</th><th style={{ width: 34 }} /></tr></thead>
        <tbody>
          {custom.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-faint)" }} title={c.url}>{c.url}</td>
              <td><input type="checkbox" checked={c.enabled !== false} onChange={(e) => { setCustomSourceEnabled(c.id, e.target.checked); setCustom(loadCustomSources()); }} /></td>
              <td><button className="wb-btn danger" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => { removeCustomSource(c.id); setCustom(loadCustomSources()); }}>×</button></td>
            </tr>
          ))}
          {custom.length === 0 && <tr><td colSpan={4} style={{ color: "var(--fg-faint)" }}>None added.</td></tr>}
        </tbody>
      </table>
      <div className="wb-prop">
        <span className="k">Name</span>
        <input className="wb-input" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} placeholder="e.g. Institutional Discovery" />
      </div>
      <div className="wb-prop">
        <span className="k">Endpoint</span>
        <input className="wb-input" value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} placeholder="https://…/search?q={query}" />
      </div>
      <div style={{ padding: "4px 8px" }}>
        <button
          className="wb-btn"
          disabled={!newSource.name.trim() || !newSource.url.trim()}
          onClick={() => {
            addCustomSource({ name: newSource.name.trim(), url: newSource.url.trim(), enabled: true, executionKind: "api" });
            setCustom(loadCustomSources());
            setNewSource({ name: "", url: "", enabled: true });
            onNote?.(`Custom source "${newSource.name.trim()}" added. Probe it before relying on it.`, "ok");
          }}
        >
          Add source
        </button>
      </div>
    </div>
  );
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
      <div className="wb-prop">
        <span className="k">Start command</span>
        <input
          className="wb-input" defaultValue={tracerStartCommand()}
          placeholder="however you start it on this machine — recorded, never assumed"
          onBlur={(e) => setTracerStartCommand(e.target.value)}
        />
      </div>
      <div style={{ padding: "4px 8px" }}><button className="wb-btn" onClick={check}>Re-check</button></div>
    </div>
  );
}
