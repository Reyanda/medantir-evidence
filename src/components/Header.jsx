import React, { useState } from "react";
import { Globe2, ChevronDown, Check, User, LogOut, Menu, Layers3, SlidersHorizontal } from "lucide-react";
import { PROFILES, geoChildren, geoPath, currentLocation } from "../engine/session.js";
import { currentUser, logout, isSudo, getAutoLogout, setAutoLogout, getWipeOnLogout, setWipeOnLogout } from "../engine/accounts.js";
import { geocodePlace } from "../engine/connectors.js";
import { allowedModes, getOperatingMode } from "../engine/operatingModes.js";
import DesignSettings from "./DesignSettings.jsx";
import useClickOutside from "../hooks/useClickOutside.js";

export default function Header({ isDarkMode, designSettings, updateDesignSettings, scope, setScope, profile, setProfile, activeMode, setActiveMode, effectiveMode, onMenu, compact = false, panel = false }) {
  const [open, setOpen] = useState(false);
  const scopeRef = useClickOutside(open, setOpen);
  const [navCode, setNavCode] = useState("GLOBAL"); // node being browsed in the drill-down
  const [osmq, setOsmq] = useState("");
  const [osmResults, setOsmResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [scopeKind, setScopeKind] = useState(() => currentLocation().scopeKind || "aggregate");
  const [shellOpen, setShellOpen] = useState(false);
  const shellRef = useClickOutside(shellOpen, setShellOpen);
  const [autolog, setAutolog] = useState(getAutoLogout());
  const [wipe, setWipe] = useState(getWipeOnLogout());
  const user = currentUser();

  const loc = currentLocation();
  const crumbs = geoPath(navCode);
  const children = geoChildren(navCode);
  const pick = (nodeOrLoc, kind = nodeOrLoc?.osm ? "atomic" : "aggregate") => {
    setScopeKind(kind);
    setScope(nodeOrLoc, kind);
    setOpen(false);
  };

  const osmSearch = async (q) => {
    setOsmq(q);
    if (q.trim().length < 3) { setOsmResults([]); return; }
    setSearching(true);
    setOsmResults(await geocodePlace(q));
    setSearching(false);
  };
  const prof = PROFILES.find((p) => p.id === profile) || PROFILES[0];
  const mode = getOperatingMode(effectiveMode);

  if (compact) return (
    <div ref={shellRef} className="relative">
      <button onClick={() => setShellOpen((value) => !value)} aria-expanded={shellOpen} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] font-medium" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)", borderWidth: "var(--surface-border-width)" }}>
        <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: "var(--color-brand-primary)" }} /> Settings <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${shellOpen ? "rotate-180" : ""}`} />
      </button>
      {shellOpen && <div className="chrome-surface absolute bottom-full mb-2 left-0 z-[80] w-72 max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-xl p-2.5 shadow-xl space-y-2">
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[9px] font-mono text-zinc-500">Mode
            <select aria-label="Operating mode" value={activeMode} onChange={(event) => setActiveMode(event.target.value)} className="mt-0.5 w-full text-[10px] px-1.5 py-1 rounded bg-transparent border outline-none" style={{ borderColor: "var(--color-border-subtle)" }}>{allowedModes(profile).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
          <label className="text-[9px] font-mono text-zinc-500">Profile
            <select aria-label="Deployment profile" value={profile} onChange={(event) => setProfile(event.target.value)} className="mt-0.5 w-full text-[10px] px-1.5 py-1 rounded bg-transparent border outline-none" style={{ borderColor: "var(--color-border-subtle)" }}>{PROFILES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
        </div>

        <details className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--color-border-subtle)" }}>
          <summary className="cursor-pointer list-none flex items-center text-[10px] font-medium"><Globe2 className="h-3.5 w-3.5 mr-1.5 text-[var(--color-brand-primary)]" />Context · {loc.name}<ChevronDown className="h-3 w-3 ml-auto" /></summary>
          <div className="pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg p-1" role="tablist" aria-label="Context scope resolution" style={{ background: "var(--color-bg-elevated)" }}>
              {[['aggregate', 'Aggregate'], ['atomic', 'Atomic']].map(([id, label]) => <button key={id} role="tab" aria-selected={scopeKind === id} onClick={() => setScopeKind(id)} className="rounded-md px-2 py-1 text-[9px] font-medium" style={scopeKind === id ? { background: "var(--color-bg-surface)", color: "var(--color-brand-primary)", boxShadow: "var(--surface-shadow)" } : { color: "var(--color-text-secondary)" }}>{label}</button>)}
            </div>
            {scopeKind === "atomic" ? <label className="block text-[9px] font-mono text-zinc-500">Search an exact place
              <input value={osmq} onChange={(event) => osmSearch(event.target.value)} placeholder="Search country, region, city…" className="mt-0.5 w-full text-[10px] px-2 py-1.5 rounded bg-transparent border outline-none" style={{ borderColor: "var(--color-border-subtle)" }} />
            </label> : null}
            {scopeKind === "atomic" && searching && <div className="text-[9px] text-zinc-400">Searching…</div>}
            {scopeKind === "atomic" && osmResults.slice(0, 5).map((result) => <button key={result.code} onClick={() => { pick(result, "atomic"); setOsmq(""); setOsmResults([]); }} title={result.fullName} className="block w-full text-left text-[10px] px-1.5 py-1 rounded hover:bg-[var(--color-brand-primary)]/10"><span>{result.name}</span><span className="ml-1 text-[8px] font-mono text-zinc-400">{result.type}</span></button>)}

            {scopeKind === "aggregate" && <div className="space-y-1.5">
              <div className="text-[9px] font-mono text-zinc-500">Aggregate hierarchy</div>
              <div className="flex items-center gap-1 overflow-x-auto text-[9px] font-mono whitespace-nowrap">
                {crumbs.map((crumb, index) => <React.Fragment key={crumb.code}><button onClick={() => setNavCode(crumb.code)} className={index === crumbs.length - 1 ? "font-semibold text-[var(--color-brand-primary)]" : "text-zinc-400 hover:text-[var(--color-brand-primary)]"}>{crumb.name}</button>{index < crumbs.length - 1 && <span className="text-zinc-300">/</span>}</React.Fragment>)}
              </div>
              <button onClick={() => pick(navCode, "aggregate")} className="w-full flex items-center justify-between text-left text-[10px] px-1.5 py-1 rounded hover:bg-[var(--color-brand-primary)]/10"><span>Use {crumbs[crumbs.length - 1]?.name}</span>{scope === navCode && <Check className="h-3 w-3 text-emerald-500" />}</button>
              <div className="max-h-36 overflow-y-auto rounded border p-0.5" style={{ borderColor: "var(--color-border-subtle)" }}>
                {children.map((child) => <div key={child.code} className="flex items-center rounded hover:bg-[var(--color-brand-primary)]/10">
                  <button onClick={() => pick(child.code, "aggregate")} className="flex-1 flex items-center justify-between text-left text-[10px] px-1.5 py-1"><span>{child.name}</span>{scope === child.code && <Check className="h-3 w-3 text-emerald-500" />}</button>
                  {child.children && <button onClick={() => setNavCode(child.code)} aria-label={`Drill into ${child.name}`} title={`Drill into ${child.name}`} className="p-1 text-zinc-400 hover:text-[var(--color-brand-primary)]"><ChevronDown className="h-3 w-3 -rotate-90" /></button>}
                </div>)}
                {!children.length && <div className="px-1.5 py-1 text-[9px] text-zinc-400">No lower aggregate level.</div>}
              </div>
            </div>}
          </div>
        </details>

        <details className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--color-border-subtle)" }}>
          <summary className="cursor-pointer list-none flex items-center text-[10px] font-medium"><SlidersHorizontal className="h-3.5 w-3.5 mr-1.5 text-violet-500" />Appearance & design<ChevronDown className="h-3 w-3 ml-auto" /></summary>
          <div className="pt-2"><DesignSettings inline settings={designSettings} onChange={updateDesignSettings} /></div>
        </details>

        <details className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--color-border-subtle)" }}>
          <summary className="cursor-pointer list-none flex items-center text-[10px] font-medium"><User className="h-3.5 w-3.5 mr-1.5 text-emerald-500" /><span className="truncate">{user?.email}</span><ChevronDown className="h-3 w-3 ml-auto shrink-0" /></summary>
          <div className="pt-2 space-y-2">
            <label className="block text-[9px] font-mono text-zinc-500">Idle logout
              <select value={autolog} onChange={(event) => { const value = Number(event.target.value); setAutoLogout(value); setAutolog(value); }} className="mt-0.5 w-full text-[10px] px-1.5 py-1 rounded bg-transparent border" style={{ borderColor: "var(--color-border-subtle)" }}><option value={0}>Off</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></select>
            </label>
            <label className="flex items-center gap-1.5 text-[9px] text-zinc-500"><input type="checkbox" checked={wipe} onChange={(event) => { setWipe(event.target.checked); setWipeOnLogout(event.target.checked); }} />Wipe local data on sign-out</label>
            <button onClick={async () => { await logout(); window.location.reload(); }} className="flex items-center gap-1 text-[10px] text-rose-500"><LogOut className="h-3 w-3" />Sign out</button>
          </div>
        </details>
      </div>}
    </div>
  );
  // The full-width header is not mounted by the shell; this render is reused
  // inside the compact Workspace & design popup in the sidebar.

  return (
    <header className={`chrome-surface ${panel ? "w-full flex-col items-stretch p-3 gap-3" : "chrome-shell-header px-3 py-3 items-center justify-between gap-2"} border-0 flex z-20`}>
      {/* mobile: open the nav drawer */}
      <button onClick={onMenu} aria-label="Open navigation menu" className="md:hidden p-2 -ml-1 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <Menu className="h-5 w-5" />
      </button>
      {!panel && <div className="hidden md:block" />}

      <div className={`flex items-center gap-2 md:gap-4 flex-wrap ${panel ? "justify-start" : "justify-end"}`}>
        {/* Operating mode controls content; deployment profile only controls permission. */}
        <label className="flex items-center gap-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 rounded-lg px-2.5 py-1.5">
          <Layers3 className="h-4 w-4 shrink-0" style={{ color: mode.color }} />
          <span className="sr-only">Operating mode</span>
          <select
            aria-label="Operating mode"
            value={activeMode}
            onChange={(event) => setActiveMode(event.target.value)}
            className="text-xs font-medium bg-transparent outline-none max-w-40"
          >
            {allowedModes(profile).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>

        {/* Combined Operator & Source (Geolocator) controller */}
        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            <User className={`h-4 w-4 ${isSudo() ? "text-emerald-500" : "text-[var(--color-brand-primary)]"}`} />
            <span className="truncate max-w-[220px]">
              {user?.name || user?.email?.split("@")[0]} ({loc.name}) · {prof.name}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
          </button>
          {open && (
            <div
              ref={scopeRef}
              className="absolute right-0 top-10 w-80 max-h-[80vh] overflow-y-auto bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg z-50 p-3 space-y-4 text-xs"
            >
              {/* Section 1: Session & Account */}
              <div className="space-y-2">
                <div className="text-[10px] font-mono font-bold text-zinc-400">OPERATOR SESSION</div>
                <div className="text-zinc-700 dark:text-zinc-300 font-medium truncate">{user?.email}</div>
                <div className="text-[10px] font-mono text-zinc-500">role: {user?.role} {isSudo() && <span className="text-[8px] font-mono text-emerald-500 font-bold ml-1">SUDO</span>}</div>

                <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                  <div>
                    <label className="text-[10px] font-mono text-zinc-400 block mb-1">Auto-logout (idle)</label>
                    <select value={autolog} onChange={(e) => { const v = Number(e.target.value); setAutoLogout(v); setAutolog(v); }} className="w-full text-xs px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
                      <option value={0}>Off</option>
                      <option value={5}>5 minutes</option>
                      <option value={15}>15 minutes</option>
                      <option value={30}>30 minutes</option>
                      <option value={60}>60 minutes</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-[10px] font-mono text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={wipe} onChange={(e) => { setWipe(e.target.checked); setWipeOnLogout(e.target.checked); }} className="rounded" />
                    Wipe all data on sign-out
                  </label>
                </div>
                <button onClick={async () => { await logout(); window.location.reload(); }} className="flex items-center gap-1.5 text-xs text-rose-500 pt-1 hover:underline"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
              </div>

              {/* Section 2: Deployment Profile */}
              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                <div className="text-[10px] font-mono font-bold text-zinc-400">DEPLOYMENT TIER</div>
                <div className="space-y-1">
                  {PROFILES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setProfile(p.id); }}
                      className="w-full flex items-start justify-between gap-2 px-2 py-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
                    >
                      <div>
                        <div className="text-xs font-semibold flex items-center gap-1.5">{p.name}<span className="text-[9px] font-mono text-zinc-400">L{p.clearance}</span></div>
                        <div className="text-[10px] text-zinc-500 leading-normal">{p.note}</div>
                      </div>
                      {p.id === profile && <Check className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section 3: Geolocator Scope (Source) */}
              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                <div className="text-[10px] font-mono font-bold text-zinc-400">GEOLOCATOR SCOPE</div>
                <div>
                  <input
                    value={osmq}
                    onChange={(e) => osmSearch(e.target.value)}
                    placeholder="search any place (OSM)…"
                    className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]"
                  />
                  {searching && <div className="text-[10px] font-mono text-zinc-400 mt-1">searching OSM…</div>}
                  {osmResults.map((r) => (
                    <button key={r.code} onClick={() => { pick(r); setOsmq(""); setOsmResults([]); }} title={r.fullName} className="w-full text-left px-2 py-1.5 mt-1 rounded hover:bg-[var(--color-brand-primary)]/10 text-xs">
                      <span className="text-zinc-700 dark:text-zinc-200">{r.name}</span>
                      <span className="text-[9px] font-mono text-zinc-400 ml-1">{r.type}</span>
                    </button>
                  ))}
                </div>
                {/* breadcrumb drill-down */}
                <div className="flex items-center gap-1 flex-wrap text-[10px] font-mono text-zinc-500">
                  {crumbs.map((c, i) => (
                    <span key={c.code} className="flex items-center gap-1">
                      <button onClick={() => setNavCode(c.code)} className={`hover:text-[var(--color-brand-primary)] ${i === crumbs.length - 1 ? "text-zinc-700 dark:text-zinc-200 font-bold" : "text-zinc-400"}`}>{c.name}</button>
                      {i < crumbs.length - 1 && <span className="text-zinc-300">/</span>}
                    </span>
                  ))}
                </div>
                {/* use current region */}
                <button onClick={() => pick(navCode)} className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-[var(--color-brand-primary)]/10 text-left text-xs border border-zinc-200 dark:border-zinc-800">
                  <span className="flex items-center gap-2 text-[var(--color-brand-primary)]"><Globe2 className="h-3.5 w-3.5" /> Use {crumbs[crumbs.length - 1]?.name}</span>
                  {scope === navCode && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                </button>
                {/* children */}
                <div className="space-y-0.5 max-h-40 overflow-y-auto border border-zinc-100 dark:border-zinc-800 rounded-lg p-1">
                  {children.map((c) => (
                    <div key={c.code} className="flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded">
                      <button onClick={() => pick(c.code)} className="flex-1 flex items-center justify-between px-2 py-1 text-left text-[11px]">
                        <span className="flex items-center gap-1.5"><span className="font-mono text-[9px] text-zinc-400 w-8">{c.code}</span>{c.name}</span>
                        {c.code === scope && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                      </button>
                        {c.children && <button onClick={() => setNavCode(c.code)} title="Drill in" className="px-1.5 py-1 text-zinc-400 hover:text-[var(--color-brand-primary)]"><ChevronDown className="h-3.5 w-3.5 -rotate-90" /></button>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DesignSettings settings={designSettings} onChange={updateDesignSettings} />

      </div>
    </header>
  );
}
