import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, FileCode, Loader2, RefreshCw } from "lucide-react";
import ReactECharts from "echarts-for-react";
import { metaAnalyze } from "../engine/metaanalysis.js";
import { forestRScript, forestSpec, funnelSpec, nullValue, prismaFlowSpec } from "../engine/plotSpecs.js";
import { loadReview } from "../engine/reviewengine.js";
import { activeProject, putFile } from "../engine/projectstore.js";

import { renderVellumFigure } from "../engine/vellumEngine.js";

// PlotTool — the analysis surface in the right pane.
//
// Two registers, deliberately separated. INTERACTIVE charts render here from the
// review's own numbers, so exploration is immediate and cannot drift from the
// data. PUBLICATION figures are produced by real R written into the project, so
// what goes in the manuscript comes from the same toolchain a methods section
// would cite — not from a screenshot of a web chart.

const VIEWS = [
  { id: "forest", label: "Forest" },
  { id: "funnel", label: "Funnel" },
  { id: "prisma", label: "PRISMA" },
];

/** Studies with a usable effect and standard error, drawn from the review's
 *  extracted studies. Anything without both is not silently coerced to zero. */
function studiesFromReview(review) {
  return (review?.objects?.studies || [])
    .map((study) => ({
      name: study.name || study.title || study.id,
      effect: Number(study.effect ?? study.extracted?.effect),
      se: Number(study.se ?? study.extracted?.se),
    }))
    .filter((study) => Number.isFinite(study.effect) && Number.isFinite(study.se) && study.se > 0);
}

export default function PlotTool({ project }) {
  const [view, setView] = useState("forest");
  const [model, setModel] = useState("random");
  const [measure, setMeasure] = useState("RR");
  const [review, setReview] = useState(null);
  const [note, setNote] = useState("");
  const [writing, setWriting] = useState(false);
  const projectId = project?.id || activeProject();

  useEffect(() => {
    if (!projectId) { setReview(null); return; }
    try { setReview(loadReview(projectId)); } catch { setReview(null); }
  }, [projectId]);

  const studies = useMemo(() => studiesFromReview(review), [review]);
  const meta = useMemo(() => (studies.length ? metaAnalyze(studies, { measure }) : null), [studies, measure]);
  const counts = review?.objects?.report?.counts || null;

  const option = useMemo(() => {
    const spec = view === "forest" ? forestSpec(meta, { model })
      : view === "funnel" ? funnelSpec(meta)
      : prismaFlowSpec(counts || {});
    if (!spec) return null;
    const { markLineValue, _rows, _stages, ...echart } = spec;
    // The null line is what makes a forest plot readable at a glance.
    if (markLineValue != null && echart.series?.[0]) {
      echart.series[0] = {
        ...echart.series[0],
        markLine: { silent: true, symbol: "none", data: [{ xAxis: markLineValue }], lineStyle: { type: "dashed", width: 1 } },
      };
    }
    return { ...echart, tooltip: { trigger: "item" }, animation: false, textStyle: { fontSize: 10 } };
  }, [view, meta, model, counts]);

  const writeRScript = async () => {
    if (!meta?.ok || !projectId) return;
    setWriting(true);
    try {
      const script = forestRScript(meta, { model });
      putFile(projectId, { path: "scripts/r/forest-plot.R", name: "forest-plot.R", type: "script", content: script });
      const rResult = await renderVellumFigure({ projectId, rScriptPath: "scripts/r/forest-plot.R" });
      if (rResult.ok) {
        setNote("Wrote & rendered scripts/r/forest-plot.R via system R (Rscript). Output generated.");
      } else {
        setNote(`Wrote scripts/r/forest-plot.R. ${rResult.error || "Run: Rscript scripts/r/forest-plot.R"}`);
      }
    } finally {
      setWriting(false);
    }
  };

  if (!projectId) return <Empty text="Select a project to plot its analyses." />;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-2 py-1.5 border-b flex items-center gap-1.5 flex-wrap" style={{ borderColor: "var(--color-border-subtle)" }}>
        {VIEWS.map((entry) => (
          <button key={entry.id} onClick={() => setView(entry.id)} className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={view === entry.id ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}>
            {entry.label}
          </button>
        ))}
        {view !== "prisma" && (
          <>
            <select value={measure} onChange={(event) => setMeasure(event.target.value)} aria-label="Effect measure" className="text-[9px] px-1 py-0.5 rounded border ml-auto" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }}>
              {["RR", "OR", "HR", "MD", "SMD"].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </select>
            {view === "forest" && (
              <select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Model" className="text-[9px] px-1 py-0.5 rounded border" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }}>
                <option value="random">Random</option>
                <option value="fixed">Fixed</option>
              </select>
            )}
          </>
        )}
        <button onClick={() => setReview(loadReview(projectId))} title="Reload from the review" aria-label="Reload plot data" className="p-1" style={{ color: "var(--color-text-secondary)" }}><RefreshCw className="h-3 w-3" /></button>
      </div>

      <div className="flex-1 min-h-0 p-1">
        {view === "prisma" && !counts ? (
          <Empty text="No PRISMA counts yet — run the review's report stage." />
        ) : view !== "prisma" && !meta?.ok ? (
          <Empty text={studies.length ? "Studies found, but none carry both an effect and a standard error." : "No extracted studies with effect sizes yet. Complete the extraction stage."} />
        ) : option ? (
          <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
        ) : <Empty text="Nothing to plot." />}
      </div>

      {meta?.ok && view !== "prisma" && (
        <div className="px-2 py-1 border-t text-[9px] font-mono flex items-center gap-2 flex-wrap" style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-secondary)" }}>
          <span>k={meta.k}</span>
          <span>I²={Math.round(meta.heterogeneity?.I2 ?? 0)}%</span>
          <span>τ²={Number(meta.heterogeneity?.tau2 ?? 0).toFixed(3)}</span>
          <span>{meta.heterogeneity?.interpretation}</span>
          <span>{model} {meta[model].effect} [{meta[model].ci[0]}, {meta[model].ci[1]}]</span>
          <span>null={nullValue(meta.measure)}</span>
        </div>
      )}

      <div className="px-2 py-1.5 border-t flex items-center gap-1.5 flex-wrap" style={{ borderColor: "var(--color-border-subtle)" }}>
        <button onClick={writeRScript} disabled={!meta?.ok || writing} title="Write an R script that reproduces these figures at publication quality" className="flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded border disabled:opacity-40" style={{ borderColor: "var(--color-border-subtle)" }}>
          {writing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileCode className="h-3 w-3" />} R script
        </button>
        <span className="text-[9px]" style={{ color: "var(--color-text-secondary)" }}>interactive here · R for publication</span>
      </div>
      {note && <div className="px-2 pb-1.5 text-[9px] break-words" style={{ color: "var(--color-brand-primary)" }}>{note}</div>}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5 p-4 text-center">
      <BarChart3 className="h-5 w-5" style={{ color: "var(--color-text-secondary)" }} />
      <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{text}</span>
    </div>
  );
}
