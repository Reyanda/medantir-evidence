import React, { useState } from "react";
import { Calculator, Plus, Save, Trash2 } from "lucide-react";
import { effectFromBinary, metaAnalyze } from "../engine/metaanalysis.js";
import { activeProject, putFile } from "../engine/projectstore.js";
import ForestPlotView, { forestPlotSvg } from "./ForestPlotView.jsx";

export default function MetaAnalysisWorkbench() {
  const [rows, setRows] = useState([]);
  const [measure, setMeasure] = useState("RR");
  const [result, setResult] = useState(null);
  const [note, setNote] = useState("");
  const update = (index, key, value) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: key === "name" ? value : Number(value) } : row));

  const run = () => {
    const studies = rows.map((row) => ({ name: row.name, ...effectFromBinary(row, measure) }));
    setResult(metaAnalyze(studies, { measure }));
    setNote("");
  };

  const save = () => {
    const projectId = activeProject();
    if (!projectId || !result) { setNote("Select an active project first."); return; }
    const stamp = Date.now();
    const path = `analysis/meta-analysis-${stamp}.json`;
    const figurePath = `analysis/forest-plot-${stamp}.svg`;
    putFile(projectId, { path, name: "Meta-analysis", type: "statistical-analysis", content: JSON.stringify({ measure, studies: rows, result }, null, 2) });
    putFile(projectId, { path: figurePath, name: "Forest plot", type: "scientific-figure", content: forestPlotSvg(result, { title: `${measure} forest plot` }), meta: { kind: "forest-plot", analysisPath: path, measure } });
    setNote(`Saved analysis and vector forest plot to ${path} and ${figurePath}`);
  };

  return (
    <div className="space-y-4">
      <div className="ui-panel flex items-start justify-between gap-3 flex-wrap"><div><div className="text-sm font-semibold flex items-center gap-1.5"><Calculator className="h-4 w-4" style={{ color: "var(--color-text-secondary)" }} /> Binary-outcome meta-analysis</div><div className="text-[11px] text-zinc-500 mt-1">Computes study effects, fixed and DerSimonian–Laird random effects, Q, I², τ², and 95% confidence intervals. The forest plot renders from the same result object; it does not recalculate the statistics.</div></div><select value={measure} onChange={(event) => setMeasure(event.target.value)} className="text-xs px-2 py-1.5 rounded border" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }}><option>RR</option><option>OR</option></select></div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800"><table className="w-full text-xs"><thead className="bg-zinc-50 dark:bg-zinc-900 text-[10px] font-mono uppercase text-zinc-400"><tr>{["Study", "Events Tx", "N Tx", "Events Ctrl", "N Ctrl", ""].map((label) => <th key={label} className="text-left px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-zinc-100 dark:border-zinc-800">{["name", "events_t", "n_t", "events_c", "n_c"].map((key) => <td key={key} className="p-1.5"><input type={key === "name" ? "text" : "number"} min={key === "name" ? undefined : 0} value={row[key]} onChange={(event) => update(index, key, event.target.value)} aria-label={`${key} study ${index + 1}`} className="w-full min-w-20 px-2 py-1.5 rounded border outline-none" style={{ background: "var(--color-bg-surface)", borderColor: "var(--color-border-subtle)" }} /></td>)}<td className="p-1.5"><button onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-zinc-400 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button></td></tr>)}{rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No study data. Add a study to begin.</td></tr>}</tbody></table></div>
      <div className="flex items-center gap-2"><button onClick={() => setRows((current) => [...current, { name: `Study ${current.length + 1}`, events_t: 0, n_t: 1, events_c: 0, n_c: 1 }])} className="ui-secondary-button px-3 py-2 text-xs"><Plus className="h-3.5 w-3.5" /> Add study</button><button onClick={run} disabled={!rows.length} className="ml-auto ui-primary-button disabled:opacity-40 text-xs px-3 py-2"><Calculator className="h-3.5 w-3.5" /> Calculate</button></div>
      {result && (result.ok ? <div className="grid grid-cols-1 md:grid-cols-3 gap-3"><div className="ui-card"><div className="ui-kicker">Random effect {measure}</div><div className="ui-stat-value mt-1">{result.random.effect}</div><div className="text-xs text-zinc-500">95% CI {result.random.ci[0]}–{result.random.ci[1]}</div></div><div className="ui-card"><div className="ui-kicker">Fixed effect {measure}</div><div className="ui-stat-value mt-1">{result.fixed.effect}</div><div className="text-xs text-zinc-500">95% CI {result.fixed.ci[0]}–{result.fixed.ci[1]}</div></div><div className="ui-card"><div className="ui-kicker">Heterogeneity</div><div className="ui-stat-value mt-1">I² {result.heterogeneity.I2}%</div><div className="text-xs text-zinc-500">τ² {result.heterogeneity.tau2} · {result.heterogeneity.interpretation}</div></div><div className="md:col-span-3"><button onClick={save} className="ui-secondary-button text-xs px-3 py-2"><Save className="h-3.5 w-3.5" /> Save analysis + SVG</button>{note && <span className="ml-2 text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{note}</span>}</div><div className="md:col-span-3"><ForestPlotView result={result} title={`${measure} forest plot`} /></div></div> : <div className="text-xs text-rose-500">{result.error}</div>)}
    </div>
  );
}
