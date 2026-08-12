import React, { useState, useEffect, useCallback } from "react";
import {
  tracerHealth, tracerAnalyze, tracerConvert, tracerBaseUrl, setTracerBaseUrl,
  OUTPUT_MODES, tracerStartCommand, setTracerStartCommand,
} from "../engine/tracerEngine.js";
import { putFile, activeProject } from "../engine/projectstore.js";

// Raster figure in, editable SVG out, saved into the project alongside every
// other review artifact. The service is local; when it is down the panel says
// so and shows the command that starts it rather than failing quietly.
export default function TracerPanel({ projectId = null }) {
  const [health, setHealth] = useState(null);
  const [url, setUrl] = useState(tracerBaseUrl());
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("hybrid_parity");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const check = useCallback(async () => {
    setBusy("checking");
    const res = await tracerHealth();
    setHealth(res);
    setBusy("");
  }, []);

  useEffect(() => { check(); }, [check]);

  const onPick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setResult(null); setError(null); setAnalysis(null);
    setBusy("analyzing");
    const res = await tracerAnalyze(f);
    setBusy("");
    if (res.ok) setAnalysis(res.data); else setError(res.error);
  };

  const run = async () => {
    if (!file) return;
    setBusy("converting"); setError(null); setResult(null);
    const res = await tracerConvert(file, { outputMode: mode, verify });
    setBusy("");
    if (!res.ok) { setError([res.error, ...(res.errors || [])].filter(Boolean).join(" · ")); return; }
    setResult(res.data);
  };

  const save = () => {
    const svg = result?.svg || result?.document?.svg;
    if (!svg) return;
    const pid = projectId || activeProject();
    if (!pid) { setError("No active project to save into."); return; }
    const name = `${(file?.name || "figure").replace(/\.[^.]+$/, "")}.svg`;
    putFile(pid, { path: `figures/${name}`, name, type: "svg", content: svg, meta: { source: "tracer", mode } });
    setError(null);
    setResult({ ...result, _saved: `figures/${name}` });
  };

  const svg = result?.svg || result?.document?.svg || "";
  // The service reports parity per conversion; showing it is the difference
  // between "it produced an SVG" and "the SVG matches the source".
  const report = result?.report || null;
  const metrics = { ...report?.metrics, ...Object.fromEntries(Object.entries(report || {}).filter(([, v]) => typeof v === "number")) };
  const difference = result?.difference_png || null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">Service</div>
        <div className="wb-prop">
          <span className="k">Endpoint</span>
          <input
            className="wb-input" value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => { setTracerBaseUrl(url); check(); }}
          />
        </div>
        <div className="wb-prop">
          <span className="k">State</span>
          <span className="v mono" style={{ color: health?.ok ? "var(--ok)" : "var(--err)" }}>
            {busy === "checking" ? "checking" : health?.ok ? "reachable" : "unreachable"}
          </span>
        </div>
        {!health?.ok && (
          <div style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--fg-faint)", userSelect: "text", lineHeight: 1.6 }}>
            <div className="wb-prop" style={{ padding: 0 }}>
              <span className="k">Start command</span>
              <input
                className="wb-input" defaultValue={tracerStartCommand()}
                placeholder="however you start it on this machine"
                onBlur={(e) => setTracerStartCommand(e.target.value)}
              />
            </div>
            <div style={{ marginTop: 4 }}>
              Tracer accepts requests from http://localhost:5173 only. Serve the workbench there,
              or add this origin to the CORS list in Tracer&apos;s api.py.
            </div>
          </div>
        )}
        <div style={{ padding: "4px 8px" }}>
          <button className="wb-btn" onClick={check}>Re-check</button>
        </div>

        <div className="wb-insp-title">Source</div>
        <div style={{ padding: "4px 8px" }}>
          <input type="file" accept="image/*" onChange={onPick} style={{ fontSize: 11, color: "var(--fg-dim)" }} />
        </div>
        {file && <div className="wb-prop"><span className="k">File</span><span className="v mono">{file.name}</span></div>}
        {analysis?.statistics && Object.entries(analysis.statistics).slice(0, 6).map(([k, v]) => (
          <div className="wb-prop" key={k}><span className="k">{k}</span><span className="v mono">{String(typeof v === "number" ? Number(v.toFixed?.(4) ?? v) : v).slice(0, 28)}</span></div>
        ))}
        {analysis?.preset && <div className="wb-prop"><span className="k">Recommended</span><span className="v mono">{analysis.preset}</span></div>}

        <div className="wb-insp-title">Output contract</div>
        {OUTPUT_MODES.map((m) => (
          <div key={m.id} className={`wb-row ${mode === m.id ? "sel" : ""}`} onClick={() => setMode(m.id)} title={m.hint}>
            <span className="lbl">{m.label}</span>
          </div>
        ))}
        <div className="wb-prop">
          <span className="k">Verify</span>
          <span className="v"><input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} /> enforce output gates</span>
        </div>
        <div style={{ padding: "6px 8px", display: "flex", gap: 4 }}>
          <button className="wb-btn on" onClick={run} disabled={!file || !health?.ok || !!busy}>
            {busy === "converting" ? "Converting…" : "Convert"}
          </button>
          <button className="wb-btn" onClick={save} disabled={!svg}>Save to project</button>
        </div>
        {result?._saved && <div style={{ padding: "0 8px 6px", fontSize: 10.5, color: "var(--ok)", fontFamily: "var(--mono)" }}>saved {result._saved}</div>}
        {error && <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--err)", userSelect: "text" }}>{error}</div>}
      </div>

      <div style={{ overflow: "auto", background: "var(--bg-app)", padding: 10 }}>
        {!svg ? (
          <div style={{ color: "var(--fg-faint)", fontSize: 11 }}>
            {file ? "No conversion yet." : "Pick a raster figure to trace."}
          </div>
        ) : (
          <>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-dim)", marginBottom: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
              {Object.entries(metrics).filter(([, v]) => typeof v === "number").slice(0, 8).map(([k, v]) => (
                <span key={k}>{k}={Number(v).toFixed(4)}</span>
              ))}
              {difference && (
                <button className="wb-btn" onClick={() => setShowDiff((v) => !v)}>{showDiff ? "Show result" : "Show difference proof"}</button>
              )}
            </div>
            {showDiff && difference ? (
              <img alt="difference proof" src={`data:image/png;base64,${difference}`} style={{ border: "1px solid var(--line)", background: "#000" }} />
            ) : (
              <div
                style={{ background: "#fff", display: "inline-block", border: "1px solid var(--line)" }}
                // The SVG comes from the operator's own local service, on their own file.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
