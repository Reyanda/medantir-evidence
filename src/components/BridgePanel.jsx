import React, { useState, useEffect, useCallback } from "react";
import {
  pickLocalFolder, getFolderHandle, listFolderContents, removeFolderHandle,
  isFolderApiAvailable, folderBackend,
} from "../engine/folderSource.js";
import { getProject, updateProject, putFile } from "../engine/projectstore.js";
import { PROVIDERS, providerStatus, setProviderConfig, testProvider } from "../engine/providers.js";
import { tracerBaseUrl, setTracerBaseUrl, tracerHealth, tracerStartCommand, setTracerStartCommand } from "../engine/tracerEngine.js";

// The bridge: where the operator attaches their own machine to the workbench.
// Two things can be attached — the working folder the review's documents live
// in, and the compute the LLM stages run on. Both stay on the operator's
// hardware. A hosted tier is described here as an offer, not shown as a running
// service, because nothing is provisioned.

const COMPUTE_TARGETS = [
  {
    id: "ollama",
    label: "Ollama (local)",
    hint: "http://127.0.0.1:11434 — models run on this machine, nothing leaves it",
    start: "ollama serve   # then: ollama pull llama3.1",
  },
  {
    id: "lmstudio",
    label: "LM Studio / OpenAI-compatible",
    hint: "any endpoint speaking the OpenAI chat-completions shape",
    start: "start your server, then paste its base URL into the provider entry",
  },
];

export default function BridgePanel({ projectId, onNote }) {
  const [folder, setFolder] = useState({ attached: false, entries: [], name: "", busy: false, error: "" });
  const [tracer, setTracer] = useState({ url: tracerBaseUrl(), ok: null });
  const [computeTest, setComputeTest] = useState({});
  const project = projectId ? getProject(projectId) : null;
  const backend = folderBackend();

  const refreshFolder = useCallback(async () => {
    if (!projectId) return;
    const handle = await getFolderHandle(projectId);
    if (!handle) { setFolder({ attached: false, entries: [], name: "", busy: false, error: "" }); return; }
    setFolder((f) => ({ ...f, busy: true }));
    try {
      const entries = await listFolderContents(handle);
      setFolder({ attached: true, entries, name: handle.name || project?.folderName || "attached folder", busy: false, error: "" });
    } catch (e) {
      setFolder({ attached: true, entries: [], name: project?.folderName || "attached folder", busy: false, error: String(e.message || e) });
    }
  }, [projectId, project?.folderName]);

  useEffect(() => { refreshFolder(); }, [refreshFolder]);
  useEffect(() => { tracerHealth().then((r) => setTracer((t) => ({ ...t, ok: r.ok }))); }, []);

  const attach = async () => {
    if (!projectId) { onNote?.("Select a project before attaching a folder.", "warn"); return; }
    setFolder((f) => ({ ...f, busy: true, error: "" }));
    try {
      const result = await pickLocalFolder(projectId, project?.name);
      if (!result?.ok) {
        setFolder((f) => ({ ...f, busy: false, error: result?.error || "The folder was not attached." }));
        return;
      }
      updateProject(projectId, { folderName: result.name || result.handle?.name || "attached folder", folderAttachedAt: Date.now() });
      onNote?.(`Working folder attached: ${result.name || result.handle?.name}. Files stay on this machine; the workbench reads them on demand.`, "ok");
      refreshFolder();
    } catch (e) {
      setFolder((f) => ({ ...f, busy: false, error: String(e.message || e) }));
    }
  };

  const detach = async () => {
    await removeFolderHandle(projectId);
    updateProject(projectId, { folderName: null, folderAttachedAt: null });
    onNote?.("Working folder detached. Nothing on disk was changed.", "warn");
    refreshFolder();
  };

  const importEntry = async (entry) => {
    // Copying a file into the project store makes it part of the review's own
    // record; the folder itself is never written to.
    try {
      const { readFolderFile } = await import("../engine/folderSource.js");
      const content = await readFolderFile(projectId, entry.path);
      putFile(projectId, { path: `imported/${entry.name}`, name: entry.name, type: "text", content: String(content).slice(0, 400_000), meta: { from: entry.path } });
      onNote?.(`${entry.name} copied into the project as imported/${entry.name}.`, "ok");
    } catch (e) {
      onNote?.(`${entry.name} could not be read: ${String(e.message || e)}`, "err");
    }
  };

  const testCompute = async (id) => {
    setComputeTest((c) => ({ ...c, [id]: "testing" }));
    const res = await testProvider(id);
    setComputeTest((c) => ({ ...c, [id]: res.ok ? `ok · ${res.model || "responded"}` : res.error }));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100%", minHeight: 0 }}>
      {/* working document */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">Working folder</div>
        <div className="wb-prop"><span className="k">Project</span><span className="v">{project?.name || "none selected"}</span></div>
        <div className="wb-prop">
          <span className="k">Bridge</span>
          <span className="v mono">
            {backend === "desktop" ? "desktop IPC — any folder, full read access" : isFolderApiAvailable() ? "browser File System Access — folder picker, read on demand" : "unavailable in this browser"}
          </span>
        </div>
        <div className="wb-prop">
          <span className="k">Attached</span>
          <span className="v mono" style={{ color: folder.attached ? "var(--ok)" : "var(--fg-faint)" }}>
            {folder.attached ? folder.name : "nothing attached"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, padding: "4px 8px" }}>
          <button className="wb-btn on" onClick={attach} disabled={folder.busy || !projectId || (!isFolderApiAvailable() && backend !== "desktop")}>
            {folder.busy ? "working…" : folder.attached ? "Attach a different folder" : "Attach working folder"}
          </button>
          {folder.attached && <button className="wb-btn" onClick={refreshFolder}>Re-read</button>}
          {folder.attached && <button className="wb-btn danger" onClick={detach}>Detach</button>}
        </div>
        {folder.error && <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--err)" }}>{folder.error}</div>}
        {!isFolderApiAvailable() && backend !== "desktop" && (
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--warn)", lineHeight: 1.6 }}>
            This browser has no folder-picker API. Use the desktop build, or Chrome or Edge, to attach a folder.
          </div>
        )}

        <div className="wb-insp-title">Folder contents <span className="wb-count">{folder.entries.length}</span></div>
        {folder.entries.length === 0 ? (
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-faint)" }}>
            {folder.attached ? "No readable file was found." : "Attach a folder to read protocols, PDFs and data files without uploading them anywhere."}
          </div>
        ) : (
          <table className="wb-grid">
            <thead><tr><th>Path</th><th style={{ width: 70 }}>Type</th><th style={{ width: 74 }} /></tr></thead>
            <tbody>
              {folder.entries.slice(0, 300).map((entry) => (
                <tr key={entry.path}>
                  <td title={entry.path}>{entry.path}</td>
                  <td style={{ color: "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{entry.type || entry.kind || ""}</td>
                  <td><button className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => importEntry(entry)}>Copy in</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* compute */}
      <div style={{ overflow: "auto" }}>
        <div className="wb-insp-title">Your own compute</div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
          The LLM stages route wherever you point them. Nothing here is hosted by the workbench:
          an endpoint you run is an endpoint you own.
        </div>
        <table className="wb-grid">
          <thead><tr><th style={{ width: 150 }}>Target</th><th style={{ width: 78 }}>State</th><th>Endpoint</th><th style={{ width: 60 }} /></tr></thead>
          <tbody>
            {COMPUTE_TARGETS.map((target) => {
              const provider = PROVIDERS.find((p) => p.id === target.id) || PROVIDERS.find((p) => p.shape === "local");
              const status = provider ? providerStatus(provider.id) : null;
              return (
                <tr key={target.id}>
                  <td title={target.hint}>{target.label}</td>
                  <td style={{ color: status?.enabled ? "var(--ok)" : "var(--fg-faint)" }}>
                    {computeTest[provider?.id] === "testing" ? "testing" : status?.enabled ? "enabled" : "off"}
                  </td>
                  <td>
                    <input
                      className="wb-cell-input" style={{ textAlign: "left" }}
                      defaultValue={status?.endpoint || ""}
                      placeholder="base URL"
                      onBlur={(e) => provider && setProviderConfig(provider.id, { endpoint: e.target.value, enabled: true })}
                    />
                  </td>
                  <td>{provider && <button className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => testCompute(provider.id)}>Test</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.entries(computeTest).filter(([, v]) => v && v !== "testing").map(([id, v]) => (
          <div key={id} style={{ padding: "2px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: String(v).startsWith("ok") ? "var(--ok)" : "var(--err)" }}>{id}: {v}</div>
        ))}
        <div style={{ padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.7, userSelect: "text" }}>
          {COMPUTE_TARGETS.map((t) => <div key={t.id}>{t.start}</div>)}
        </div>

        <div className="wb-insp-title">Local services</div>
        <div className="wb-prop">
          <span className="k">Tracer</span>
          <input className="wb-input" value={tracer.url} onChange={(e) => setTracer({ ...tracer, url: e.target.value })}
            onBlur={() => { setTracerBaseUrl(tracer.url); tracerHealth().then((r) => setTracer((t) => ({ ...t, ok: r.ok }))); }} />
        </div>
        <div className="wb-prop">
          <span className="k">State</span>
          <span className="v mono" style={{ color: tracer.ok ? "var(--ok)" : "var(--err)" }}>{tracer.ok ? "reachable" : "unreachable"}</span>
        </div>
        {!tracer.ok && (
          <div className="wb-prop">
            <span className="k">Start command</span>
            <input
              className="wb-input" defaultValue={tracerStartCommand()}
              placeholder="however you start it on this machine"
              onBlur={(e) => setTracerStartCommand(e.target.value)}
            />
          </div>
        )}
        <div className="wb-prop">
          <span className="k">In-browser</span>
          <span className="v">always available — no network, minutes per stage, model cached after first use</span>
        </div>

        <div className="wb-insp-title">Hosted tier — not provisioned</div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.7 }}>
          A managed stack would cover the parts a laptop does badly: full-corpus screening, licensed
          database access under an institutional agreement, PDF retrieval at volume, and long
          extraction runs. None of it is running, so nothing in this build depends on it —
          every stage above executes on your own machine or against a key you hold.
        </div>
      </div>
    </div>
  );
}
