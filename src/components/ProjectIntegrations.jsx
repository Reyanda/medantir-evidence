import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileJson, FolderOpen, Loader2, Play, Plug, Save, ShieldAlert, Wrench } from "lucide-react";
import { attachFolderToProject, getProject, putFile } from "../engine/projectstore.js";
import { authorizeWorkspace, projectRuntimeAvailable } from "../engine/projectRuntime.js";
import { connectorRegistry, connectorResultPath, defaultToolArguments, isReadLikeTool } from "../engine/connectorRegistry.js";
import { loadMCP, mcpCallTool, mcpListTools, mcpReadiness } from "../engine/mcp.js";
import { askComposer } from "../engine/composerBus.js";

const BADGE = {
  ready: "text-emerald-600 bg-emerald-500/10",
  configured: "text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10",
  native: "text-[var(--color-brand-primary)] bg-[var(--color-brand-primary)]/10",
  disabled: "text-zinc-500 bg-zinc-500/10",
  unavailable: "text-rose-600 bg-rose-500/10",
  "setup-required": "text-amber-600 bg-amber-500/10",
  "authentication-required": "text-amber-600 bg-amber-500/10",
};

function Badge({ state, children }) {
  return <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${BADGE[state] || BADGE.disabled}`}>{children}</span>;
}

function NativeObsidian({ projectId, onOpenView, onChange }) {
  const project = getProject(projectId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const attach = async () => {
    setBusy(true); setMessage("");
    const result = await attachFolderToProject(projectId);
    setBusy(false);
    if (result.ok) { setMessage(`Vault attached: ${result.name} · ${result.fileCount} files`); onChange?.(); }
    else if (result.error) setMessage(result.error);
  };
  const authorize = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await authorizeWorkspace(projectId, project?.name);
      setMessage(result?.authorized ? `Project filesystem enabled: ${result.root}` : "Filesystem authorization was not completed.");
    } catch (error) {
      setMessage(String(error.message || error));
    } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-[var(--color-brand-primary)]/25 bg-[var(--color-brand-primary)]/[0.03] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <FolderOpen className="h-5 w-5 text-violet-500 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><h3 className="text-sm font-semibold">Obsidian vault</h3><Badge state="native">Native filesystem</Badge><span className="text-[9px] font-mono text-zinc-400">Knowledge</span></div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">Home: Project Files · Code composer · Search · Terminal</div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={attach} disabled={busy} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-violet-500/30 text-violet-600 disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />} {project?.localFolder ? "Replace attached vault" : "Attach Obsidian vault"}</button>
        {projectRuntimeAvailable() && <button onClick={authorize} disabled={busy} className="text-[11px] px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 disabled:opacity-50">Enable desktop filesystem</button>}
        <button onClick={() => onOpenView?.("files")} className="text-[11px] px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700">Open Files</button>
        <button onClick={() => askComposer("", { autofill: false, mode: "code" })} className="text-[11px] px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700">Open Code composer</button>
      </div>
      {project?.localFolder && <div className="text-[10px] font-mono text-emerald-600">Attached: {project.localFolder.name} · {project.localFolder.fileCount} files</div>}
      {message && <div className="text-[10px] font-mono text-zinc-500 break-all">{message}</div>}
    </div>
  );
}

function McpWorkbench({ connector, projectId }) {
  const server = loadMCP().find((item) => item.id === connector.id);
  const readiness = mcpReadiness(server);
  const [busy, setBusy] = useState("");
  const [tools, setTools] = useState([]);
  const [selected, setSelected] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const tool = tools.find((item) => item.name === selected);
  const discover = async () => {
    setBusy("discover"); setMessage(""); setResult(null);
    const response = await mcpListTools(connector.id);
    setBusy("");
    if (!response.ok) { setMessage(response.error || response.state); return; }
    setTools(response.tools || []);
    const first = response.tools?.[0];
    setSelected(first?.name || "");
    setArgsText(JSON.stringify(defaultToolArguments(first), null, 2));
    setMessage(`${response.tools?.length || 0} tools discovered`);
  };
  const chooseTool = (name) => {
    const next = tools.find((item) => item.name === name);
    setSelected(name); setArgsText(JSON.stringify(defaultToolArguments(next), null, 2)); setResult(null); setMessage("");
  };
  const run = async () => {
    let args;
    try { args = JSON.parse(argsText || "{}"); } catch { setMessage("Arguments must be valid JSON."); return; }
    if (!isReadLikeTool(selected) && !window.confirm(`Run potentially modifying tool “${selected}” on ${connector.name}? Review the arguments before continuing.`)) return;
    setBusy("run"); setMessage(""); setResult(null);
    const response = await mcpCallTool(connector.id, selected, args);
    setBusy("");
    if (!response.ok) { setMessage(response.error || response.state); return; }
    setResult({ payload: response.result, args, at: Date.now() });
    setMessage("Tool completed. Review the result before saving it to this project.");
  };
  const save = () => {
    if (!result) return;
    const path = connectorResultPath(connector.id, selected, result.at);
    const content = JSON.stringify({ provenance: { connector: connector.id, connectorName: connector.name, tool: selected, projectId, executedAt: new Date(result.at).toISOString() }, arguments: result.args, result: result.payload }, null, 2);
    putFile(projectId, { path, name: path.split("/").pop(), type: "connector-result", content, meta: { connector: connector.id, tool: selected, executedAt: result.at } });
    setMessage(`Saved ${path}`);
  };
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Plug className="h-4 w-4 text-cyan-500 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><h3 className="text-sm font-semibold">{connector.name}</h3><Badge state={readiness.state}>{readiness.label}</Badge><span className="text-[9px] font-mono text-zinc-400">{connector.domain}</span></div>
          <p className="text-[10px] text-zinc-500 mt-1">{connector.note}</p>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">Home: {connector.home}</div>
        </div>
        {connector.setupUrl && <a href={connector.setupUrl} target="_blank" rel="noreferrer" className="text-[10px] text-[var(--color-brand-primary)] flex items-center gap-1 shrink-0">Setup <ExternalLink className="h-3 w-3" /></a>}
      </div>
      {readiness.state === "unavailable" ? (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-600"><AlertTriangle className="h-4 w-4 shrink-0" /> This service is blocked because release verification found no working MCP endpoint.</div>
      ) : readiness.canTest ? (
        <div className="space-y-3">
          <button onClick={discover} disabled={!!busy} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-cyan-500/30 text-cyan-600 disabled:opacity-50">{busy === "discover" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />} Discover tools</button>
          {tools.length > 0 && <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
            <div><label className="text-[10px] font-mono text-zinc-400">Tool</label><select value={selected} onChange={(event) => chooseTool(event.target.value)} className="mt-1 w-full text-xs px-2 py-2 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">{tools.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select>{tool?.description && <p className="text-[10px] text-zinc-500 mt-1">{tool.description}</p>}{selected && !isReadLikeTool(selected) && <div className="flex items-center gap-1 text-[10px] text-amber-600 mt-2"><ShieldAlert className="h-3 w-3" /> Confirmation required</div>}</div>
            <div><label className="text-[10px] font-mono text-zinc-400">Arguments (JSON)</label><textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={7} className="mt-1 w-full text-[11px] font-mono px-2.5 py-2 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-cyan-500" /><button onClick={run} disabled={!!busy || !selected} className="mt-2 flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded bg-cyan-600 text-white disabled:opacity-50">{busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run selected tool</button></div>
          </div>}
          {result && <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.03] p-3 space-y-2"><div className="flex items-center gap-2 text-[11px] text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Result received; it is not yet a project file.</div><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[10px] font-mono text-zinc-600 dark:text-zinc-300">{JSON.stringify(result.payload, null, 2)}</pre><button onClick={save} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded border border-emerald-500/30 text-emerald-600"><Save className="h-3.5 w-3.5" /> Save result to project</button></div>}
        </div>
      ) : (
        <div className="text-[11px] text-amber-600">Complete connector setup in Connectors & Developer. No external request is made from this project until you explicitly discover tools.</div>
      )}
      {message && <div className="text-[10px] font-mono text-zinc-500 break-words">{message}</div>}
    </div>
  );
}

export default function ProjectIntegrations({ projectId, onOpenView, onChange }) {
  const registry = connectorRegistry();
  const mcp = registry.filter((item) => item.kind === "mcp");
  const domains = useMemo(() => [...new Set(mcp.map((item) => item.domain))], [mcp]);
  const [domain, setDomain] = useState("All");
  const shown = domain === "All" ? mcp : mcp.filter((item) => item.domain === domain);
  const operational = loadMCP().filter((server) => mcpReadiness(server).canTest).length;
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 flex items-start justify-between gap-3 flex-wrap">
        <h3 className="text-base font-bold flex items-center gap-2"><FileJson className="h-4 w-4 text-cyan-500" /> Project Integrations</h3>
        <div className="text-[10px] font-mono text-zinc-400">{operational} configured for testing</div>
      </div>
      <NativeObsidian projectId={projectId} onOpenView={onOpenView} onChange={onChange} />
      <div className="flex gap-1 flex-wrap">{["All", ...domains].map((item) => <button key={item} onClick={() => setDomain(item)} className={`text-[10px] px-2 py-1 rounded ${domain === item ? "bg-cyan-500/10 text-cyan-600" : "text-zinc-500"}`}>{item}</button>)}</div>
      <div className="space-y-3">{shown.map((connector) => <McpWorkbench key={connector.id} connector={connector} projectId={projectId} />)}</div>
    </div>
  );
}
