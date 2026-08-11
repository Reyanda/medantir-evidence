import React, { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FolderOpen, Play, RefreshCw, Square } from "lucide-react";
import { projectRuntimeAvailable, selectWorkspace, terminalRuntime, workspaceInfo } from "../engine/projectRuntime.js";

export default function TerminalTool({ project }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const runningRef = useRef(false);
  const [workspace, setWorkspace] = useState(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = projectRuntimeAvailable();
  const projectId = project?.id || null;

  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    if (!available || !projectId || !containerRef.current) return undefined;
    const computed = getComputedStyle(document.documentElement);
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      scrollback: 10000,
      theme: {
        background: "#09090b",
        foreground: "#d4d4d8",
        cursor: computed.getPropertyValue("--color-brand-primary").trim() || "#60a5fa",
        selectionBackground: "#3f3f4680",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.writeln(`\x1b[90mActiora project terminal — ${window.__medantirDesktop__?.isAvailable?.() ? "local Bash with your desktop account's permissions" : "cloud Bash, scoped to this user and project"}.\x1b[0m`);

    const api = terminalRuntime();
    const input = terminal.onData((data) => { if (runningRef.current) api?.write(projectId, data).catch((cause) => setError(String(cause.message || cause))); });
    const offData = api?.onData(({ projectId: sourceId, data }) => { if (sourceId === projectId) terminal.write(data); });
    const offExit = api?.onExit(({ projectId: sourceId, exitCode }) => {
      if (sourceId !== projectId) return;
      runningRef.current = false;
      setRunning(false);
      terminal.writeln(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m`);
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (runningRef.current) api?.resize(projectId, terminal.cols, terminal.rows).catch(() => {});
    });
    observer.observe(containerRef.current);

    Promise.all([workspaceInfo(projectId), api?.status(projectId)]).then(([root, status]) => {
      setWorkspace(root);
      setRunning(!!status?.running);
      runningRef.current = !!status?.running;
      if (status?.buffer) terminal.write(status.buffer);
      if (status?.running) api.resize(projectId, terminal.cols, terminal.rows).catch(() => {});
    }).catch((cause) => setError(String(cause.message || cause)));

    return () => {
      observer.disconnect();
      input.dispose();
      offData?.();
      offExit?.();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [available, projectId]);

  const start = async () => {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const terminal = terminalRef.current;
      const result = await terminalRuntime().start({ projectId: project.id, projectName: project.name, cols: terminal?.cols || 80, rows: terminal?.rows || 24 });
      setWorkspace({ projectId: project.id, root: result.root, authorized: true });
      window.dispatchEvent(new CustomEvent("medantir:workspace-changed", { detail: { projectId: project.id, root: result.root, authorized: true } }));
      if (result.buffer) terminal?.write(result.buffer);
      setRunning(true);
      runningRef.current = true;
      terminal?.focus();
    } catch (cause) {
      setError(String(cause.message || cause));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!projectId) return;
    await terminalRuntime()?.kill(projectId);
    setRunning(false);
    runningRef.current = false;
  };

  const relink = async () => {
    if (!projectId) return;
    setError("");
    try {
      if (running) await stop();
      const root = await selectWorkspace(projectId);
      if (root) setWorkspace(root);
    } catch (cause) {
      setError(String(cause.message || cause));
    }
  };

  if (!project) return <div className="p-4 text-xs" style={{ color: "var(--color-text-secondary)" }}>Select a project to open its terminal.</div>;
  if (!available) return (
    <div className="p-4 space-y-2">
      <div className="text-xs font-semibold">Open the desktop app to use the terminal</div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
        A browser tab cannot spawn a shell — there is no API for it. The desktop shell runs a real Bash
        session for this project with your own account's permissions.
      </p>
      <p className="text-[11px] leading-relaxed font-mono" style={{ color: "var(--color-text-secondary)" }}>npm run desktop:dev</p>
      <p className="text-[10px] leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
        Run <span className="font-mono">npm run desktop:doctor</span> first if it does not open — that checks
        the Electron runtime and the terminal's native module and tells you exactly what to fix.
      </p>
    </div>
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-zinc-950 text-zinc-200">
      <div className="px-2 py-2 border-b border-zinc-800 space-y-1.5">
        <div className="flex items-center gap-1.5">
          {!running ? <button onClick={start} disabled={busy} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] bg-emerald-600 text-white disabled:opacity-50"><Play className="h-3 w-3" /> Start Bash</button> : <button onClick={stop} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] bg-zinc-800"><Square className="h-3 w-3" /> Stop</button>}
          <button onClick={relink} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] bg-zinc-800"><FolderOpen className="h-3 w-3" /> {workspace ? "Change folder" : "Link folder"}</button>
          <button onClick={() => { terminalRef.current?.clear(); terminalRef.current?.focus(); }} title="Clear terminal display" className="ml-auto p-1 text-zinc-400"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
        <div className="truncate text-[9px] font-mono text-zinc-500" title={workspace?.root || ""}>{workspace?.root || "A safe default project folder will be created when Bash starts."}</div>
        <div className="text-[9px] text-amber-400">{window.__medantirDesktop__?.isAvailable?.() ? "Local Bash has your desktop account's filesystem and process permissions." : "Cloud Bash is non-root, resource-limited, network-isolated, and mounted only to this project."}</div>
        {error && <div role="alert" className="text-[9px] text-rose-400">{error}</div>}
      </div>
      <div ref={containerRef} aria-label={`${project.name} Bash terminal`} className="flex-1 min-h-0 p-1" />
    </div>
  );
}
