import React, { useEffect, useState } from "react";
import ReactECharts from "echarts-for-react";
import { ArrowDown, ArrowUp, Copy, Download, Loader2, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { askForViz, specToOption, demoSpecs, isMapSpec, parseRows, autoSpecs } from "../engine/vizspec.js";
import { activeProvider } from "../engine/providers.js";
import { getCanvasComposition, getFile, listFiles, recordCanvasEvent, saveCanvasComposition } from "../engine/projectstore.js";
import CanvasMap from "./CanvasMap.jsx";

function makeCanvasPanels(specs, { generation = "deterministic", source = { kind: "unknown", label: "Unspecified source" }, modeId, scope } = {}) {
  const stamp = Date.now();
  return (specs || []).map((spec, index) => ({
    ...spec,
    id: spec.id || `panel_${stamp}_${index}`,
    title: spec.title || `${spec.type || "visual"} panel`,
    generation: spec.generation || generation,
    source: spec.source || source,
    createdAt: spec.createdAt || stamp,
    mode: spec.mode || modeId || null,
    scope: spec.scope || scope || null,
  }));
}

function Panel({ spec, index, total, sourceUnavailable, onChange, onMove, onDuplicate, onRemove }) {
  let body;
  if (spec.type === "note") {
    body = <div className="min-h-40 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-200 p-2">{spec.text || "No note content."}</div>;
  } else if (isMapSpec(spec)) {
    body = <CanvasMap spec={spec} />;
  } else {
    let option = null;
    let error = null;
    try { option = specToOption(spec, true); } catch (cause) { error = String(cause.message || cause); }
    body = error
      ? <div className="h-64 flex items-center justify-center text-[11px] font-mono text-rose-500">{error}</div>
      : <ReactECharts option={option} style={{ height: 280 }} notMerge lazyUpdate />;
  }

  return (
    <article className="chrome-surface p-3" aria-label={`${spec.title} visual panel`}>
      <div className="flex items-start gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <input value={spec.title} onChange={(event) => onChange({ title: event.target.value })} aria-label={`Rename ${spec.title}`} className="w-full bg-transparent text-sm font-semibold outline-none border-b border-transparent focus:border-[var(--color-brand-primary)]" />
          <div className="text-[9px] font-mono text-zinc-400 truncate">{spec.type} · {spec.generation} · {spec.source?.label || "unspecified source"}{spec.scope ? ` · ${spec.scope}` : ""}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${spec.title} up`} className="p-1 text-zinc-500 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move ${spec.title} down`} className="p-1 text-zinc-500 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button onClick={onDuplicate} aria-label={`Duplicate ${spec.title}`} className="p-1 text-zinc-500"><Copy className="h-3.5 w-3.5" /></button>
          <button onClick={onRemove} aria-label={`Remove ${spec.title}`} className="p-1 text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {sourceUnavailable && <div role="status" className="mb-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">Source unavailable; this saved snapshot is retained. Restore the project file or remove the panel.</div>}
      {body}
    </article>
  );
}

export function CanvasView({ projectId = "", modeId, scope, pendingPanel, onPendingPanelConsumed, onDirtyChange }) {
  const [prompt, setPrompt] = useState("");
  const [specs, setSpecs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [dataText, setDataText] = useState("");
  const [rows, setRows] = useState(null);
  const [showData, setShowData] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const provider = activeProvider();
  const files = projectId ? listFiles(projectId).filter((file) => /\.(csv|json|tsv|md)$/i.test(file.path)) : [];

  useEffect(() => {
    const saved = projectId ? getCanvasComposition(projectId) : { panels: [], savedAt: null };
    const unavailable = (saved.panels || []).filter((panel) => panel.source?.kind === "project-file" && !getFile(projectId, panel.source.path));
    setSpecs(saved.panels || []);
    setSavedAt(saved.savedAt || null);
    setPrompt("");
    setRows(null);
    setDataText("");
    setNote(saved.panels?.length ? `${saved.panels.length} saved panel${saved.panels.length === 1 ? "" : "s"} restored without rerunning sources.${unavailable.length ? ` ${unavailable.length} source link${unavailable.length === 1 ? " is" : "s are"} unavailable.` : ""}` : "");
    unavailable.forEach((panel) => recordCanvasEvent(projectId, "source-link-broken", `Source unavailable for ${panel.title}`));
    setDirty(false);
  }, [projectId]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    try {
      if (dirty) sessionStorage.setItem("medantir.command-centre.canvas-dirty", "1");
      else sessionStorage.removeItem("medantir.command-centre.canvas-dirty");
    } catch { /* storage unavailable */ }
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const warn = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!pendingPanel?.requestId) return;
    const [panel] = makeCanvasPanels([pendingPanel], { generation: pendingPanel.generation || "command-centre-reference", source: pendingPanel.source, modeId, scope });
    setSpecs((current) => [...current, panel]);
    setDirty(true);
    setNote(`${panel.title} staged from ${panel.source?.label || "Command Centre"}; save to persist it.`);
    if (projectId) recordCanvasEvent(projectId, "panel-staged", `Staged ${panel.title}`);
    onPendingPanelConsumed?.();
  }, [modeId, onPendingPanelConsumed, pendingPanel, projectId, scope]);

  const addPanels = (rawSpecs, meta, message) => {
    const panels = makeCanvasPanels(rawSpecs, { ...meta, modeId, scope });
    if (!panels.length) return;
    setSpecs(panels);
    setDirty(true);
    setNote(message || `${panels.length} candidate views created.`);
  };
  const loadData = (text, source) => {
    const parsed = parseRows(text);
    if (!parsed.length) { setNote("Could not parse rows. Existing Canvas panels were left unchanged."); return; }
    const auto = autoSpecs(parsed, 4);
    setRows(parsed);
    if (auto.length) addPanels(auto, { generation: "deterministic-auto", source }, `${parsed.length} rows → ${auto.length} candidate views (${[...new Set(auto.map((item) => item.type))].join(", ")}).`);
    else setNote(`${parsed.length} rows loaded — describe a view above.`);
    if (projectId) recordCanvasEvent(projectId, "data-bound", `Bound ${parsed.length} rows from ${source.label}`);
  };
  const loadFromFile = (path) => {
    if (!projectId || !path) return;
    const file = getFile(projectId, path);
    if (!file) { setNote("The selected project file is no longer available."); return; }
    const text = file.content.slice(0, 20000);
    setDataText(text);
    loadData(text, { kind: "project-file", projectId, path, label: path });
  };
  const generate = async () => {
    if (!provider) { setNote("Prompt generation requires an enabled AI provider. Data and deterministic auto-visualisation remain available."); return; }
    setBusy(true);
    setNote("");
    const result = await askForViz(prompt, rows, 5);
    setBusy(false);
    if (result.ok) {
      addPanels(result.specs, { generation: "ai-prompt", source: rows ? { kind: "bound-data", label: "Current bound data" } : { kind: "prompt", label: "Visualisation intent" } }, `${result.specs.length} AI candidate views created.`);
      if (projectId) recordCanvasEvent(projectId, "panels-generated", `Generated ${result.specs.length} AI visual panels`);
    } else setNote(result.reason);
  };
  const save = () => {
    if (!projectId) { setNote("Select or create a project before saving this composition."); return; }
    const saved = saveCanvasComposition(projectId, { panels: specs });
    if (!saved) { setNote("The composition could not be saved. Existing project data was left unchanged."); return; }
    setSavedAt(saved.savedAt);
    setDirty(false);
    setNote(`Saved ${saved.panels.length} panel${saved.panels.length === 1 ? "" : "s"} to the selected project.`);
  };
  const exportComposition = () => {
    if (!projectId || dirty || !specs.length) return;
    const payload = {
      format: "medantir-command-centre-canvas",
      version: 1,
      projectId,
      mode: modeId || null,
      scope: scope || null,
      savedAt,
      exportedAt: new Date().toISOString(),
      status: "exploratory-composition",
      limitations: "Visual panels are project decision-support outputs and are not validated findings unless promoted through a governed workflow.",
      panels: specs,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `canvas-${projectId.replace(/[^a-z0-9_-]+/gi, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    recordCanvasEvent(projectId, "export-created", `Exported ${specs.length} Canvas panels`);
    setNote(`Exported ${specs.length} saved panel${specs.length === 1 ? "" : "s"} with provenance and limitations.`);
  };
  const changePanel = (index, patch) => { setSpecs((current) => current.map((panel, item) => item === index ? { ...panel, ...patch } : panel)); setDirty(true); };
  const movePanel = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= specs.length) return;
    setSpecs((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; });
    setDirty(true);
  };
  const duplicatePanel = (index) => {
    setSpecs((current) => { const next = [...current]; const copy = { ...current[index], id: `panel_${Date.now()}_copy`, title: `${current[index].title} copy`, createdAt: Date.now() }; next.splice(index + 1, 0, copy); return next; });
    setDirty(true);
  };
  const removePanel = (index) => { setSpecs((current) => current.filter((_, item) => item !== index)); setDirty(true); };

  return (
    <div className="space-y-5" aria-label="Command Centre Canvas">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Sparkles className="h-5 w-5" style={{ color: "var(--color-brand-primary)" }} /> Visual composition</h2>
        </div>
        <div className="flex items-center gap-2">
          <span role="status" className={`text-[10px] font-mono ${dirty ? "text-amber-500" : "text-zinc-400"}`}>{dirty ? "Unsaved changes" : savedAt ? `Saved ${new Date(savedAt).toLocaleString()}` : "Not yet saved"}</span>
          <button onClick={exportComposition} disabled={!projectId || dirty || !specs.length || !savedAt} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 disabled:opacity-40"><Download className="h-3.5 w-3.5" /> Export JSON</button>
          <button onClick={save} disabled={!dirty || !projectId} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md text-white disabled:opacity-40" style={{ background: "var(--color-brand-primary)" }}><Save className="h-3.5 w-3.5" /> Save Canvas</button>
        </div>
      </div>

      <div className="chrome-surface p-4 space-y-3">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={2} aria-label="Visualisation intent" placeholder="Describe the visual analysis you need…" className="w-full text-sm px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none resize-none focus:border-[var(--color-brand-primary)]" />
        <div className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Data {rows ? `· ${rows.length} rows bound` : "· none"}</span>
            <div className="flex items-center gap-2">
              {files.length > 0 && <select onChange={(event) => loadFromFile(event.target.value)} aria-label="Load a selected-project file" defaultValue="" className="text-[10px] px-1.5 py-1 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 outline-none max-w-[220px]"><option value="">Selected-project file…</option>{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select>}
              <button onClick={() => setShowData((value) => !value)} className="text-[11px] hover:underline" style={{ color: "var(--color-brand-primary)" }}>{showData ? "hide paste" : "paste data"}</button>
            </div>
          </div>
          {showData && <div className="space-y-1.5"><textarea value={dataText} onChange={(event) => setDataText(event.target.value)} rows={3} placeholder='Paste JSON, CSV, or TSV rows' aria-label="Paste data" className="w-full text-[11px] font-mono px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]" /><button onClick={() => loadData(dataText, { kind: "pasted-data", label: "Pasted data" })} className="text-[11px] text-white px-2.5 py-1 rounded" style={{ background: "var(--color-brand-primary)" }}>Load + auto-viz</button></div>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={generate} disabled={busy || !provider} className="flex items-center gap-2 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50" style={{ background: "var(--color-brand-primary)" }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {busy ? "Designing…" : "Generate views"}</button>
          <button onClick={() => { const demo = demoSpecs(); addPanels(demo, { generation: "explicit-demo", source: { kind: "demo", label: "Explicit demo data" } }, `${demo.length} demo panels loaded; they are not findings.`); if (projectId) recordCanvasEvent(projectId, "demo-loaded", "Loaded explicit Canvas demo"); }} className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700"><RefreshCw className="h-3.5 w-3.5" /> Load demo</button>
          {!provider && <span className="text-[11px] font-mono text-amber-500">Enable a provider for prompt generation; data workflows still work.</span>}
          {note && <span role="status" className="text-[11px] font-mono text-zinc-500">{note}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {specs.map((spec, index) => <Panel key={spec.id} spec={spec} index={index} total={specs.length} sourceUnavailable={spec.source?.kind === "project-file" && !getFile(projectId, spec.source.path)} onChange={(patch) => changePanel(index, patch)} onMove={(delta) => movePanel(index, delta)} onDuplicate={() => duplicatePanel(index)} onRemove={() => removePanel(index)} />)}
        {specs.length === 0 && <div className="lg:col-span-2 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center text-sm text-zinc-500">No visualisation yet. Supply selected-project data, paste rows, describe a view, or explicitly load the demo.</div>}
      </div>
    </div>
  );
}

export default CanvasView;
