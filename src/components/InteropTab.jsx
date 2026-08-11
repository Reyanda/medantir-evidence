import React, { useState } from "react";
import {
  CheckCircle2,
  CircleOff,
  Database,
  ExternalLink,
  KeyRound,
  Loader2,
  Plug,
  Server,
  Settings,
  Boxes,
  Wrench,
  XCircle,
} from "lucide-react";
import { MCP_CATALOG, beginMcpOAuth, loadMCP, setServer, mcpListTools, mcpReadiness } from "../engine/mcp.js";
import { connectorHome } from "../engine/connectorRegistry.js";
import { openProjectSurface } from "../engine/projectSurfaceBus.js";
import { moduleConnectors, moduleUrl, moduleReadiness, setModuleUrl, probeModule } from "../engine/modules.js";
import {
  DATA_SOURCES,
  PLATFORMS,
  dataSourceStatus,
  platformStatus,
  testDataSource,
  setDataSource,
  setPlatform,
  loadDataSources,
  loadPlatforms,
  platformsFor,
  sourceEnabled,
} from "../engine/academic.js";

const STATE_STYLE = {
  ready: "text-emerald-600 bg-emerald-500/10",
  configured: "text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10",
  supervised: "text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10",
  "local-service": "text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10",
  disabled: "text-zinc-500 bg-zinc-500/10",
  "setup-required": "text-amber-600 bg-amber-500/10",
  "access-required": "text-amber-600 bg-amber-500/10",
  "authentication-required": "text-amber-600 bg-amber-500/10",
  offline: "text-rose-600 bg-rose-500/10",
  "http-error": "text-rose-600 bg-rose-500/10",
  unavailable: "text-rose-600 bg-rose-500/10",
};

function StateBadge({ state, label }) {
  return <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${STATE_STYLE[state] || "text-zinc-500 bg-zinc-500/10"}`}>{label || state}</span>;
}

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ${checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
    </button>
  );
}

function McpCard({ id, onChange }) {
  const server = loadMCP().find((item) => item.id === id) || MCP_CATALOG.find((item) => item.id === id);
  const [url, setUrl] = useState(server.url);
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const readiness = mcpReadiness(server);
  const home = connectorHome(server.id);
  const oauthOnly = server.access === "oauth-bridge";
  const local = server.access === "local-daemon";
  const testableWithDraft = server.enabled && !oauthOnly && (server.auth !== "token" || server.hasToken || !!token);

  const persist = async (patch) => {
    const saved = await setServer(id, patch);
    onChange?.();
    return saved;
  };
  const test = async () => {
    const saved = await persist({ ...(local ? { url } : {}), ...(token ? { token } : {}) });
    if (!saved.ok) { setResult({ ok: false, state: "authentication-required", error: saved.error }); return; }
    setBusy(true);
    setResult(await mcpListTools(id));
    setBusy(false);
  };

  return (
    <div className={`rounded-lg border p-3 ${server.enabled ? "border-emerald-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Server className="h-4 w-4 text-cyan-500" />
        <span className="text-sm font-semibold min-w-0 truncate">{server.name}</span>
        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 ml-auto">{server.category}</span>
        {!oauthOnly && <Toggle checked={server.enabled} label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`} onChange={() => persist({ enabled: !server.enabled, ...(local ? { url } : {}) })} />}
      </div>
      <div className="flex items-center gap-1.5 mb-2"><StateBadge state={readiness.state} label={readiness.label} /><span className="text-[9px] font-mono text-zinc-400">{server.transport}</span></div>
      <div className="text-[10px] text-zinc-500 mb-2">{server.note}</div>
      <div className="flex items-center justify-between gap-2 mb-2"><span className="text-[9px] font-mono text-zinc-400">Home: {home?.home || "Project Integrations"}</span><button onClick={() => openProjectSurface("integrations")} className="text-[10px] text-cyan-600 hover:underline shrink-0">Open home</button></div>
      <input
        value={url}
        readOnly={!local}
        onChange={(event) => setUrl(event.target.value)}
        onBlur={() => local && persist({ url })}
        aria-label={`${server.name} endpoint`}
        className={`w-full text-[11px] font-mono px-2.5 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none mb-1.5 ${local ? "focus:border-cyan-500" : "text-zinc-400 cursor-default"}`}
      />

      {oauthOnly ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-amber-600">{server.enabled ? "Connected through the project-scoped OAuth bridge; tokens remain server-side." : "Connect interactively with OAuth PKCE; no password or bearer token is collected here."}</span>
          <div className="flex items-center gap-2"><button onClick={async () => { setBusy(true); const connected = await beginMcpOAuth(id); if (!connected.ok) setResult(connected); setBusy(false); }} disabled={busy || (id !== "notion")} className="text-[10px] px-2 py-1 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-brand-primary)" }}>{server.enabled ? "Reconnect" : "Connect"}</button>{server.setupUrl && <a href={server.setupUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] text-[var(--color-brand-primary)] hover:underline shrink-0">Guide <ExternalLink className="h-3 w-3" /></a>}</div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {server.auth === "token" && (
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} onBlur={() => token && persist({ token })} placeholder={server.hasToken ? "stored in encrypted vault ••••" : "scoped bearer token (unlock Vault first)"} aria-label={`${server.name} token`} className="w-full text-[11px] font-mono px-2.5 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-cyan-500" />
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-zinc-500">{local ? "Start the loopback daemon, enable it, then test." : "Enable individually, then perform MCP initialize and tool discovery."}</span>
            <button onClick={test} disabled={busy || !testableWithDraft} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 shrink-0">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />} Test
            </button>
          </div>
        </div>
      )}
      {result && <div className={`mt-2 text-[10px] font-mono flex items-start gap-1.5 ${result.ok ? "text-emerald-500" : result.state === "authentication-required" ? "text-amber-500" : "text-rose-500"}`}>{result.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}<span>{result.ok ? `${result.tools.length} tools · ${result.tools.slice(0, 5).map((tool) => tool.name).join(", ") || "protocol ready"}` : `${result.state || "error"} · ${result.error}`}</span></div>}
    </div>
  );
}

function ModuleCard({ module, onChange }) {
  const [url, setUrl] = useState(moduleUrl(module) || "");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const readiness = moduleReadiness({ ...module, api: url });
  const test = async () => {
    setModuleUrl(module.id, url);
    onChange?.();
    setBusy(true);
    setResult(await probeModule(module.id));
    setBusy(false);
  };
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-2 mb-1"><Boxes className="h-4 w-4 text-[var(--color-brand-primary)]" /><span className="text-sm font-semibold">{module.name}</span><span className="ml-auto"><StateBadge state={result?.state || readiness.state} label={result ? (result.ok ? "Reachable" : result.state) : readiness.label} /></span></div>
      <div className="text-[10px] text-zinc-500 mb-2">Health route: <span className="font-mono">{module.probe?.apiBase || ""}{module.probe?.path || "/health"}</span></div>
      <div className="flex gap-1.5">
        <input value={url} onChange={(event) => setUrl(event.target.value)} onBlur={() => setModuleUrl(module.id, url)} aria-label={`${module.name} endpoint`} className="flex-1 min-w-0 text-[11px] font-mono px-2.5 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]" />
        <button onClick={test} disabled={busy || !readiness.canTest} className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />} Test</button>
      </div>
      {result && <div className={`mt-1.5 text-[10px] font-mono flex items-start gap-1 ${result.ok ? "text-emerald-500" : result.state === "authentication-required" ? "text-amber-500" : "text-rose-500"}`}>{result.ok ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <XCircle className="h-3 w-3 shrink-0" />}<span>{result.ok ? `${result.status} · ready` : `${result.state} · ${result.error}`}</span></div>}
    </div>
  );
}

function DataSourceCard({ source, onChange }) {
  const config = loadDataSources()[source.id] || {};
  const status = dataSourceStatus(source.id);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const directAccess = !!config.accessConfirmed;
  const simpleToggle = ["keyless", "browser", "service"].includes(source.kind);
  const enabled = sourceEnabled(source.id);
  const providerNames = platformsFor(source.id).map((platform) => platform.name);

  const update = async (patch) => { await setDataSource(source.id, patch); onChange?.(); };
  const test = async () => { setBusy(true); setResult(await testDataSource(source.id)); setBusy(false); };

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4" style={{ color: source.color }} />
        <span className="text-sm font-semibold min-w-0 truncate">{source.name}</span>
        <StateBadge state={status.state} label={status.label} />
      </div>
      <div className="text-[10px] text-zinc-500 mb-2">{source.note}</div>
      <div className="text-[9px] font-mono text-zinc-400 mb-2">{source.platform} · {source.controlled} · {source.kind}{providerNames.length ? ` · via ${providerNames.join(" / ")}` : ""}</div>
      <div className="flex items-center justify-between gap-2">
        {simpleToggle ? (
          <><span className="text-[10px] text-zinc-500">{status.runnable ? "Live query adapter" : source.kind === "browser" ? "Supervised browser/export" : "Module-backed service"}</span><Toggle checked={enabled} label={`${enabled ? "Disable" : "Enable"} ${source.name}`} onChange={() => update({ enabled: !enabled })} /></>
        ) : (
          <button onClick={() => update({ enabled: !directAccess, accessConfirmed: !directAccess })} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${directAccess ? "border-emerald-500/30 text-emerald-600" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}><KeyRound className="h-3 w-3" /> {directAccess ? "Access recorded (not tested)" : "Record institutional access"}</button>
        )}
        {status.runnable && <button onClick={test} disabled={busy || status.state === "disabled"} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-40">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />} Test query</button>}
      </div>
      {result && <div className={`mt-2 text-[10px] font-mono ${result.ok ? "text-emerald-500" : "text-rose-500"}`}>{result.ok ? `ready · ${result.sample}` : `${result.state} · ${result.error}`}</div>}
    </div>
  );
}

function PlatformCard({ platform, onChange }) {
  const config = loadPlatforms()[platform.id] || {};
  const status = platformStatus(platform.id);
  const confirmed = !!config.accessConfirmed;
  const update = async () => { await setPlatform(platform.id, { enabled: !confirmed, accessConfirmed: !confirmed }); onChange?.(); };
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-2 mb-1"><KeyRound className="h-4 w-4" style={{ color: platform.color }} /><span className="text-sm font-semibold">{platform.name}</span><span className="ml-auto"><StateBadge state={status.state} label={status.label} /></span></div>
      <div className="text-[10px] text-zinc-500 mb-2">{platform.note}</div>
      <div className="text-[9px] font-mono text-zinc-400 mb-2">{platform.bundles.length ? `Provides: ${platform.bundles.join(", ")}` : "Access platform; not a query adapter"}</div>
      <button onClick={update} className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${confirmed ? "border-emerald-500/30 text-emerald-600" : "border-zinc-200 dark:border-zinc-700 text-zinc-500"}`}>{confirmed ? <CheckCircle2 className="h-3 w-3" /> : <CircleOff className="h-3 w-3" />} {confirmed ? "Access recorded (not tested)" : "Record institutional access"}</button>
    </div>
  );
}

export default function InteropTab() {
  const [, force] = useState(0);
  const bump = () => force((value) => value + 1);
  const [category, setCategory] = useState("all");
  const categories = ["all", ...new Set(MCP_CATALOG.map((item) => item.category))];
  const mcps = MCP_CATALOG.filter((item) => category === "all" || item.category === category);
  const connectors = moduleConnectors();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Settings className="h-6 w-6 text-zinc-500" /> Connectors & Developer</h1>
      </div>

      <section aria-labelledby="mcp-heading">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h2 id="mcp-heading" className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">MCP servers</h2>
          <div className="flex flex-wrap gap-1">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={`text-[10px] px-2 py-0.5 rounded capitalize ${category === item ? "bg-cyan-500/10 text-cyan-500" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>{item}</button>)}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{mcps.map((item) => <McpCard key={item.id} id={item.id} onChange={bump} />)}</div>
      </section>

      <section aria-labelledby="module-connectors-heading">
        <h2 id="module-connectors-heading" className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Module connectors</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{connectors.map((module) => <ModuleCard key={module.id} module={module} onChange={bump} />)}</div>
      </section>

      <section aria-labelledby="database-sources-heading">
        <h2 id="database-sources-heading" className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Database sources</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{DATA_SOURCES.map((source) => <DataSourceCard key={source.id} source={source} onChange={bump} />)}</div>
      </section>

      <section aria-labelledby="database-platforms-heading">
        <h2 id="database-platforms-heading" className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 mb-2">Institutional database providers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">{PLATFORMS.map((platform) => <PlatformCard key={platform.id} platform={platform} onChange={bump} />)}</div>
      </section>
    </div>
  );
}
