import React, { useState } from "react";
import { Search, Loader2, ExternalLink, Sparkles, Check, Database, Pencil, Plus, Trash2, X, LogIn, ShieldCheck } from "lucide-react";
import {
  DATA_SOURCES, sourceEnabled, isSearchable, selectableSources, allSearchableSources,
  setDataSource, PLATFORMS, loadPlatforms, setPlatform, platformEnabled, platformStatus, dataSourceStatus, platformsFor, fetchFullText,
  loadDataSources, loadCustomSources, addCustomSource, removeCustomSource, setCustomSourceEnabled, updateCustomSource,
} from "../engine/academic.js";
import { Download } from "lucide-react";
import { multiModelAsk } from "../engine/ensemble.js";
import { INSTITUTION_PRESETS, institutionPreset, institutionalLoginTarget, openInstitutionalLogin } from "../engine/institutionalAccess.js";
import { executeSearches } from "../engine/reviewsearch.js";
import { openInApp } from "../engine/openBus.js";

// coloured monogram (provider-card style) for a database/platform
function Mono({ name, color }) {
  return (
    <div className="h-8 w-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: color || "#64748b" }}>
      {name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}
    </div>
  );
}

export function SearchView({ goToSources, onPromote, initialQuestion = "" }) {
  const [q, setQ] = useState(initialQuestion);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [searches, setSearches] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [synth, setSynth] = useState(null);
  const [synthing, setSynthing] = useState(false);
  const [selected, setSelected] = useState(() => selectableSources());
  const [dl, setDl] = useState({}); // full-text sourcing status per result

  const getPdf = async (i, r) => {
    setDl((d) => ({ ...d, [i]: "…" }));
    const res = await fetchFullText({ doi: r.doi, title: r.title });
    setDl((d) => ({ ...d, [i]: res.ok ? "sourced" : "offline" }));
  };

  const allSources = allSearchableSources();
  // Keyless are always on; login/key sources toggleable
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Default: keyless on, everything else off
  const runnableIds = allSources.filter((source) => source.searchable && source.enabled).map((source) => source.id);
  const keylessIds = allSources.filter((source) => source.kind === "keyless" && source.searchable && source.enabled).map((source) => source.id);

  const run = async () => {
    const runnable = selected.filter((id) => runnableIds.includes(id));
    if (!q.trim() || !runnable.length) { setSearchError("Select at least one runnable source. Configure unavailable databases under Sources or use Protocol & Strategy → Run searches for browser-authenticated databases."); return; }
    setBusy(true);
    setSynth(null);
    setSearchError("");
    try {
      const result = await executeSearches(q, runnable, { n: 12, date: new Date().toISOString().slice(0, 10) });
      setResults(result.records);
      setSearches(result.searches);
      if (!result.records.length) setSearchError("The selected live sources returned no records. The per-source log below distinguishes a true zero from an error.");
    } catch (error) {
      setResults([]);
      setSearchError(String(error.message || error));
    } finally {
      setBusy(false);
    }
  };

  const synthesize = async () => {
    if (!results.length) return;
    setSynthing(true);
    const top = results.slice(0, 8).map((r, i) => `[${i + 1}] ${r.title} (${r.year || "n.d."}, ${r.cites ?? 0} cites)`).join("\n");
    const res = await multiModelAsk(
      `Question: "${q}". Based on these top retrieved papers, give a 3-sentence evidence synthesis with bracketed citations [n], and name the single biggest evidence gap.\n\n${top}`,
      { system: "You are a rigorous evidence-synthesis analyst. Only use the provided papers; never invent citations." }
    );
    setSynth(res);
    setSynthing(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Databases to search — all available</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(runnableIds)} className="text-[10px] font-mono text-indigo-500 hover:underline">all runnable</button>
            <button onClick={() => setSelected(keylessIds)} className="text-[10px] font-mono text-zinc-400 hover:underline">keyless only</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allSources.map((s) => {
            const on = selected.includes(s.id);
            const keyless = s.kind === 'keyless';
            const accessConfigured = sourceEnabled(s.id);
            const needsLogin = s.kind === 'login' && !accessConfigured;
            const hasLogin = s.kind === 'login' && accessConfigured;
            const needsKey = s.kind === 'key';
            const isBrowser = s.kind === 'browser';
            return (
              <button key={s.id} onClick={() => s.searchable && s.enabled ? toggle(s.id) : goToSources?.()} aria-disabled={!s.searchable || !s.enabled} title={`${s.platform} · ${s.controlled || '—'} · ${s.note}`}
                className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                  keyless && on ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600" :
                  keyless ? "border-emerald-500/30 bg-emerald-500/[0.02] text-emerald-600" :
                  needsLogin && on ? "border-amber-500/50 bg-amber-500/10 text-amber-600" :
                  needsLogin ? "border-amber-500/20 bg-amber-500/[0.02] text-amber-500" :
                  needsKey && on ? "border-[var(--color-brand-primary)]/50 bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]" :
                  needsKey ? "border-[var(--color-brand-primary)]/20 bg-[var(--color-brand-primary)]/[0.02] text-[var(--color-brand-primary)]" :
                  isBrowser ? "border-zinc-300 dark:border-zinc-600 text-zinc-400" :
                  on ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-500" :
                  "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}>
                <div className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${keyless || hasLogin ? 'bg-emerald-500' : needsLogin ? 'bg-amber-500' : needsKey ? 'bg-[var(--color-brand-primary)]' : 'bg-zinc-400'}`} />
                  {s.name}
                </div>
                <div className="text-[8px] opacity-60">{s.searchable && s.enabled ? "live query" : hasLogin ? "access confirmed" : needsLogin ? "login needed" : needsKey ? "API key needed" : isBrowser ? "strategy runner" : "configure"}</div>
              </button>
            );
          })}
          {allSources.length === 0 && <button onClick={goToSources} className="text-[11px] text-indigo-500 hover:underline">No sources enabled — open Data Sources →</button>}
        </div>
      </div>

      {searchError && <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/[0.03] p-2.5 text-[11px] text-amber-700 dark:text-amber-400">{searchError}</div>}
      {searches.length > 0 && <div className="flex flex-wrap gap-1.5">{searches.map((search) => <span key={search.db} className={`text-[9px] font-mono rounded border px-2 py-1 ${search.status === "ok" ? "border-emerald-500/30 text-emerald-600" : "border-amber-500/30 text-amber-600"}`}>{allSources.find((source) => source.id === search.db)?.name || search.db}: {search.status} · {search.count}</span>)}</div>}

      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="search the literature…" aria-label="Search the literature"
          className="flex-1 text-sm px-3 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 outline-none" />
        <button onClick={run} disabled={busy || !selected.length} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search {selected.length ? `(${selected.length})` : ""}
        </button>
        {results.length > 0 && (
          <button onClick={synthesize} disabled={synthing} className="flex items-center gap-2 border border-indigo-500/40 text-indigo-500 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-indigo-500/10">
            {synthing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Synthesize
          </button>
        )}
        {onPromote && <button onClick={() => onPromote({ question: q, sources: selected, results, executedAt: new Date().toISOString() })} disabled={!q.trim()} className="text-xs font-medium px-3 py-2.5 rounded-lg border border-teal-500/40 text-teal-600 hover:bg-teal-500/10">Use in protocol →</button>}
      </div>

      {synth && (
        <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/[0.04] p-3 space-y-2">
          {synth.ok ? synth.answers.map((a) => (
            <div key={a.providerId}><div className="text-[10px] font-mono font-bold text-indigo-500">{a.label}</div><div className="text-xs text-zinc-700 dark:text-zinc-300 mt-0.5">{a.text || a.error}</div></div>
          )) : <div className="text-[11px] font-mono text-zinc-400">{synth.reason} — enable a provider in AI Providers.</div>}
        </div>
      )}

      <div className="text-[10px] font-mono text-zinc-400">{results.length ? `${results.length} deduped results` : busy ? `searching ${selected.map((id) => allSources.find((s) => s.id === id)?.name || id).join(" + ")}…` : ""}</div>
      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3">
            <div className="flex items-start gap-3">
              <span className="text-[10px] font-mono text-zinc-400 w-5 shrink-0">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 leading-snug">
                  {r.url ? <button type="button" onClick={() => openInApp(r.url, { real: true })} className="text-left hover:underline inline-flex items-start gap-1">{r.title}<ExternalLink className="h-3 w-3 opacity-60 mt-0.5 shrink-0" /></button> : r.title}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-zinc-400 flex-wrap">
                  <span>{r.year || "n.d."}</span>{r.cites != null && <span>· {r.cites} cites</span>}
                  {r.authors?.length > 0 && <span>· {r.authors.slice(0, 3).join(", ")}{r.authors.length > 3 ? " et al." : ""}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    {r.sources.map((s) => <span key={s} className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{s}</span>)}
                    <button onClick={() => getPdf(i, r)} title="Source full text via Resource Shrimp" className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-500">
                      <Download className="h-3 w-3" />{dl[i] || "get PDF"}
                    </button>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthFields({ id, name, auth, vault, onChange, endpoint = "" }) {
  const cfg = vault[id] || {};
  const [institution, setInstitution] = useState(cfg.institutionPreset || "generic");
  const [message, setMessage] = useState("");

  const beginInstitutionalLogin = async () => {
    const target = institutionalLoginTarget(id, endpoint);
    if (!target.ok) { setMessage(target.error); return; }
    const preset = institutionPreset(institution);
    // Open while the click's user activation is still live. Awaiting storage first
    // makes browsers classify the new tab as an unsolicited pop-up.
    const opened = openInstitutionalLogin(target.url);
    await onChange(id, {
      enabled: false,
      accessConfirmed: false,
      institutionPreset: preset.id,
      institutionLabel: preset.label,
      loginProvider: target.provider,
      loginStartedAt: Date.now(),
    });
    setMessage(opened
      ? `${preset.hint} Complete credentials and MFA only in the provider's new browser tab.`
      : `Your browser blocked the sign-in tab. Allow pop-ups for Actiora and try again. ${preset.hint}`);
  };

  const loginAvailable = institutionalLoginTarget(id, endpoint).ok;
  const loginControls = (
      <div className="space-y-2">
        <label className="block text-[9px] font-mono text-zinc-400">Institution
          <select value={institution} onChange={(event) => setInstitution(event.target.value)} aria-label={`${name || id} institution`} className="mt-1 w-full text-[11px] px-2 py-1.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500">
            {INSTITUTION_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={beginInstitutionalLogin} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-indigo-500/40 text-indigo-500 hover:bg-indigo-500/10">
            <LogIn className="h-3.5 w-3.5" /> {cfg.loginStartedAt ? "Reopen institutional sign-in" : "Open institutional sign-in"}
          </button>
          {cfg.loginStartedAt && !cfg.accessConfirmed && (
            <button onClick={() => onChange(id, { enabled: true, accessConfirmed: true, accessConfirmedAt: Date.now() })} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10">
              <ShieldCheck className="h-3.5 w-3.5" /> I completed sign-in
            </button>
          )}
          {cfg.accessConfirmed && (
            <button onClick={() => onChange(id, { enabled: false, accessConfirmed: false, accessConfirmedAt: null })} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-emerald-500/40 text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Access confirmed · remove
            </button>
          )}
        </div>
        <div className="text-[9px] leading-relaxed text-zinc-400">{message || "Medantir opens the provider's native Shibboleth, OpenAthens, proxy, or organisation login in a separate browser tab. Passwords, MFA, cookies, and SAML assertions never enter this form or Medantir's shared browser bridge."}</div>
      </div>
  );

  if (auth === "apiKey")
    return <div className="space-y-2"><input type="password" defaultValue="" aria-label={`${name || id} API key`} onBlur={(e) => onChange(id, { key: e.target.value, enabled: !!e.target.value || cfg.hasCredentials })} placeholder={cfg.hasCredentials ? "stored in encrypted vault ••••" : "API key (unlock Vault first)"}
      className="w-full text-xs font-mono px-2.5 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />{loginAvailable && loginControls}</div>;
  if (auth === "login") return loginControls;
  return null;
}

const EMPTY_CUSTOM_SOURCE = {
  id: "",
  name: "",
  executionKind: "api",
  endpoint: "",
  map: { list: "results", title: "title", year: "year", doi: "doi", authors: "authors", cites: "cites", abstract: "abstract" },
};

export function SourcesView() {
  const [, force] = useState(0);
  const [customDraft, setCustomDraft] = useState(EMPTY_CUSTOM_SOURCE);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const bump = () => force((n) => n + 1);
  const dsVault = loadDataSources();
  const platVault = loadPlatforms();
  const standalone = DATA_SOURCES.filter((s) => platformsFor(s.id).length === 0);
  const customSources = loadCustomSources();

  const editCustom = (source) => {
    setCustomDraft({ ...EMPTY_CUSTOM_SOURCE, ...source, map: { ...EMPTY_CUSTOM_SOURCE.map, ...(source.map || {}) } });
    setShowCustomForm(true);
  };

  const saveCustom = () => {
    if (!customDraft.name.trim()) return;
    if (customDraft.executionKind === "api" && !customDraft.endpoint.trim()) return;
    addCustomSource({
      ...customDraft,
      id: customDraft.id || undefined,
      name: customDraft.name.trim(),
      endpoint: customDraft.endpoint.trim(),
      ...(customDraft.executionKind === "browser" && !customDraft.id ? { enabled: false, accessConfirmed: false } : {}),
    });
    setCustomDraft(EMPTY_CUSTOM_SOURCE);
    setShowCustomForm(false);
    bump();
  };

  const setMap = (key, value) => setCustomDraft((draft) => ({ ...draft, map: { ...draft.map, [key]: value } }));

  return (
    <div className="space-y-6">
      <div className="text-xs text-zinc-500">
        Platforms bundle many databases under one login (EBSCOhost, Ovid, Elsevier…). Configure a platform once and its
        databases unlock for protocol and strategy building. Keyless APIs are on by default. Browser, import, and manual
        sources are represented honestly and never masquerade as live APIs.
      </div>

      {/* Platforms (bundled) */}
      <div>
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Platforms (bundled access)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PLATFORMS.map((p) => {
            const on = platformEnabled(p.id);
            const readiness = platformStatus(p.id);
            return (
              <div key={p.id} className={`rounded-lg border p-3 ${on ? "border-emerald-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Mono name={p.name} color={p.color} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold flex items-center gap-1.5">{p.name}{on && <Check className="h-3.5 w-3.5 text-emerald-500" />}</div>
                    <div className="text-[9px] font-mono uppercase text-zinc-400">{p.auth === "apiKey" ? "api key" : "login"}</div>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 mb-2">{p.note}</div>
                <div className="text-[9px] font-mono text-zinc-400 mb-2">{readiness.label}</div>
                {p.bundles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {p.bundles.map((b) => (
                      <span key={b} className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${on ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500"}`}>
                        {DATA_SOURCES.find((s) => s.id === b)?.name || b}
                      </span>
                    ))}
                  </div>
                )}
                <AuthFields id={p.id} name={p.name} auth={p.auth} vault={platVault} onChange={async (id, patch) => { await setPlatform(id, patch); bump(); }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Standalone databases / APIs */}
      <div>
        <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Databases & APIs</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {standalone.map((s) => {
            const on = sourceEnabled(s.id);
            const connected = isSearchable(s.id);
            const readiness = dataSourceStatus(s.id);
            return (
              <div key={s.id} className={`rounded-lg border p-3 ${on ? "border-emerald-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <Mono name={s.name} color={s.color} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">{s.name}{on && <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}</div>
                    <div className="text-[9px] font-mono text-zinc-400">{s.platform} · {s.controlled}{connected ? " · live API" : ""}</div>
                  </div>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{s.kind}</span>
                </div>
                <div className="text-[11px] text-zinc-500 mb-2">{s.note}</div>
                <div className="text-[9px] font-mono text-zinc-400 mb-2">{readiness.label}</div>
                {s.auth !== "none" && <AuthFields id={s.id} name={s.name} auth={s.auth} vault={dsVault} onChange={async (id, patch) => { await setDataSource(id, patch); bump(); }} />}
                {(s.kind === "keyless" || s.kind === "service" || s.kind === "browser") && (
                  <button onClick={() => { setDataSource(s.id, { enabled: !on }); bump(); }} className={`text-[11px] font-medium px-2.5 py-1 rounded-md border ${on ? "border-emerald-500/40 text-emerald-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                    {on ? "enabled" : "disabled"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* User-defined databases and evidence routes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Custom databases & routes</h3>
            <p className="text-[11px] text-zinc-500 mt-1">Add a JSON search API, supervised browser database, import-only source, or manual source. API fields use dot paths.</p>
          </div>
          <button onClick={() => { setCustomDraft(EMPTY_CUSTOM_SOURCE); setShowCustomForm((open) => !open); }} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-indigo-500/40 text-indigo-500 hover:bg-indigo-500/10">
            {showCustomForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {showCustomForm ? "Close" : "Add source"}
          </button>
        </div>

        {showCustomForm && (
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.03] p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
              <label className="text-[10px] font-mono text-zinc-500">Source name
                <input value={customDraft.name} onChange={(event) => setCustomDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Institutional Repository" className="mt-1 w-full text-xs px-2.5 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
              </label>
              <label className="text-[10px] font-mono text-zinc-500">Execution mode
                <select value={customDraft.executionKind} onChange={(event) => setCustomDraft((draft) => ({ ...draft, executionKind: event.target.value }))} className="mt-1 w-full text-xs px-2.5 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500">
                  <option value="api">Live JSON API</option>
                  <option value="browser">Supervised browser</option>
                  <option value="import">Import only</option>
                  <option value="manual">Manual search</option>
                </select>
              </label>
            </div>
            {(customDraft.executionKind === "api" || customDraft.executionKind === "browser") && (
              <label className="block text-[10px] font-mono text-zinc-500">{customDraft.executionKind === "api" ? "Search URL template" : "Database URL"}
                <input value={customDraft.endpoint} onChange={(event) => setCustomDraft((draft) => ({ ...draft, endpoint: event.target.value }))} placeholder={customDraft.executionKind === "api" ? "https://example.org/search?q=${query}&limit=${n}" : "https://example.org/search"} className="mt-1 w-full text-xs px-2.5 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
              </label>
            )}
            {customDraft.executionKind === "api" && (
              <div>
                <div className="text-[10px] font-mono text-zinc-500 mb-1">Response mappings</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {["list", "title", "year", "doi", "authors", "cites", "abstract"].map((field) => (
                    <input key={field} value={customDraft.map[field] || ""} onChange={(event) => setMap(field, event.target.value)} aria-label={`${field} response path`} placeholder={`${field} path`} className="text-[11px] font-mono px-2 py-1.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] text-zinc-500">Credentials are intentionally configured separately in the encrypted vault; this form does not store secrets.</span>
              <button onClick={saveCustom} className="shrink-0 flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-2 rounded-lg"><Database className="h-3.5 w-3.5" /> Save source</button>
            </div>
          </div>
        )}

        {customSources.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {customSources.map((source) => {
              const kind = source.executionKind || "api";
              return (
                <div key={source.id} className={`rounded-lg border p-3 ${source.enabled !== false ? "border-emerald-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
                  <div className="flex items-center gap-2">
                    <Mono name={source.name} color="#64748b" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{source.name}</div>
                      <div className="text-[9px] font-mono uppercase text-zinc-400">{kind === "api" ? "live JSON API" : kind}</div>
                    </div>
                    <button onClick={() => editCustom(source)} title="Edit custom source" className="text-zinc-400 hover:text-indigo-500"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => { removeCustomSource(source.id); bump(); }} title="Remove custom source" className="text-zinc-400 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                  {source.endpoint && <div className="mt-2 text-[10px] font-mono text-zinc-500 truncate" title={source.endpoint}>{source.endpoint}</div>}
                  {kind === "browser" && <div className="mt-2"><AuthFields id={source.id} name={source.name} auth="login" endpoint={source.endpoint} vault={Object.fromEntries(customSources.map((item) => [item.id, item]))} onChange={async (id, patch) => { updateCustomSource(id, patch); bump(); }} /></div>}
                  <button onClick={() => { setCustomSourceEnabled(source.id, source.enabled === false); bump(); }} className={`mt-2 text-[11px] font-medium px-2.5 py-1 rounded-md border ${source.enabled !== false ? "border-emerald-500/40 text-emerald-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>
                    {source.enabled !== false ? "enabled" : "disabled"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-[11px] text-zinc-500">No custom sources yet. LIVIVO is already available above as a free supervised-browser source.</div>}
      </div>
    </div>
  );
}
