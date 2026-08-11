// vizspec.js — the amorphous visualisation engine.
//
// A "viz spec" is a small JSON object describing WHAT to draw, not how. An LLM
// (or any producer) emits specs from a prompt + data; specToOption() deterministically
// turns any spec into an ECharts option, so the dashboard MORPHS to the intent —
// bar, line, scatter, pie, sankey, network graph, heatmap, treemap, radar, funnel,
// gauge — instead of a hardcoded chart. GIS (map) is handled by the Canvas via Leaflet.
//
// Spec shape:
//   { type, title, data, encodings?, style? }
//   type      one of TYPES
//   data      rows: [{...}] | nodes/links for graph/sankey | matrix for heatmap
//   encodings { x, y, value, name, source, target, series, group } — field names
//   style     { palette?, stack?, smooth?, horizontal?, colorField? }

export const TYPES = [
  "bar", "line", "area", "scatter", "pie", "sankey", "graph", "heatmap",
  "treemap", "sunburst", "radar", "funnel", "gauge", "boxplot", "map",
];

const PALETTES = {
  default: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"],
  cool: ["#0ea5e9", "#22d3ee", "#2dd4bf", "#34d399", "#a3e635", "#60a5fa"],
  warm: ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#ec4899", "#f43f5e"],
  mono: ["#64748b", "#94a3b8", "#cbd5e1", "#475569", "#334155"],
};

const num = (v) => (typeof v === "number" ? v : Number(v) || 0);

// Turn a spec (+ its data) into an ECharts option. Unknown types fall back to bar.
export function specToOption(spec, dark = true) {
  const s = spec || {};
  const enc = s.encodings || {};
  const st = s.style || {};
  const palette = PALETTES[st.palette] || PALETTES.default;
  const rows = Array.isArray(s.data) ? s.data : [];
  const axisText = dark ? "#a1a1aa" : "#52525b";
  const split = dark ? "rgba(120,120,130,0.15)" : "rgba(120,120,130,0.2)";

  const base = {
    backgroundColor: "transparent",
    color: palette,
    title: s.title ? { text: s.title, left: "center", textStyle: { color: dark ? "#e4e4e7" : "#18181b", fontSize: 13, fontWeight: 600 } } : undefined,
    tooltip: { trigger: "item" },
    grid: { left: 8, right: 16, top: s.title ? 40 : 16, bottom: 8, containLabel: true },
    textStyle: { color: axisText },
  };
  const catAxis = (data) => ({ type: "category", data, axisLabel: { color: axisText, fontSize: 10 }, axisLine: { lineStyle: { color: split } } });
  const valAxis = () => ({ type: "value", axisLabel: { color: axisText, fontSize: 10 }, splitLine: { lineStyle: { color: split } } });

  switch (s.type) {
    case "bar":
    case "line":
    case "area": {
      const x = enc.x || "x", y = enc.y || "y";
      const cats = rows.map((r) => r[x]);
      const series = {
        type: s.type === "area" ? "line" : s.type,
        data: rows.map((r) => num(r[y])),
        smooth: !!st.smooth,
        stack: st.stack ? "total" : undefined,
        areaStyle: s.type === "area" ? { opacity: 0.15 } : undefined,
        itemStyle: { borderRadius: s.type === "bar" ? [3, 3, 0, 0] : 0 },
        barMaxWidth: 28,
      };
      return { ...base, tooltip: { trigger: "axis" },
        xAxis: st.horizontal ? valAxis() : catAxis(cats),
        yAxis: st.horizontal ? catAxis(cats) : valAxis(),
        series: [series] };
    }
    case "scatter": {
      const x = enc.x || "x", y = enc.y || "y";
      return { ...base, xAxis: valAxis(), yAxis: valAxis(),
        series: [{ type: "scatter", symbolSize: 8, data: rows.map((r) => [num(r[x]), num(r[y]), r[enc.name] ?? ""]) }] };
    }
    case "pie":
    case "funnel": {
      const name = enc.name || "name", value = enc.value || "value";
      return { ...base, series: [{ type: s.type, radius: s.type === "pie" ? ["35%", "70%"] : undefined,
        data: rows.map((r) => ({ name: r[name], value: num(r[value]) })) }] };
    }
    case "radar": {
      const name = enc.name || "name", value = enc.value || "value";
      const indicator = rows.map((r) => ({ name: r[name], max: Math.max(...rows.map((x) => num(x[value]))) * 1.1 || 1 }));
      return { ...base, tooltip: { trigger: "item" }, radar: { indicator, axisName: { color: axisText, fontSize: 10 } },
        series: [{ type: "radar", data: [{ value: rows.map((r) => num(r[value])) }] }] };
    }
    case "gauge": {
      const value = num(rows[0]?.[enc.value || "value"] ?? rows[0]?.value ?? 0);
      return { ...base, series: [{ type: "gauge", progress: { show: true }, data: [{ value }], axisLine: { lineStyle: { width: 10 } } }] };
    }
    case "heatmap": {
      // rows: [{x, y, value}]
      const x = enc.x || "x", y = enc.y || "y", value = enc.value || "value";
      const xs = [...new Set(rows.map((r) => r[x]))], ys = [...new Set(rows.map((r) => r[y]))];
      const data = rows.map((r) => [xs.indexOf(r[x]), ys.indexOf(r[y]), num(r[value])]);
      const max = Math.max(1, ...rows.map((r) => num(r[value])));
      return { ...base, tooltip: { trigger: "item" }, grid: { ...base.grid, bottom: 24 },
        xAxis: catAxis(xs), yAxis: catAxis(ys),
        visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0, textStyle: { color: axisText }, inRange: { color: [palette[0] + "22", palette[0]] } },
        series: [{ type: "heatmap", data }] };
    }
    case "sankey": {
      // data: { nodes:[{name}], links:[{source,target,value}] } OR rows with source/target/value
      const g = graphData(s, enc);
      return { ...base, series: [{ type: "sankey", data: g.nodes, links: g.links, emphasis: { focus: "adjacency" },
        lineStyle: { color: "gradient", opacity: 0.4 }, label: { color: axisText, fontSize: 10 } }] };
    }
    case "graph": {
      const g = graphData(s, enc);
      return { ...base, series: [{ type: "graph", layout: "force", roam: true, data: g.nodes.map((n) => ({ ...n, symbolSize: n.value ? 8 + Math.min(30, num(n.value)) : 16 })),
        links: g.links, force: { repulsion: 120, edgeLength: 80 }, label: { show: true, color: axisText, fontSize: 9 },
        lineStyle: { opacity: 0.4, curveness: 0.1 } }] };
    }
    case "treemap":
    case "sunburst": {
      const name = enc.name || "name", value = enc.value || "value";
      return { ...base, series: [{ type: s.type, data: rows.map((r) => ({ name: r[name], value: num(r[value]) })), label: { color: "#fff", fontSize: 10 } }] };
    }
    case "boxplot": {
      const cats = [...new Set(rows.map((r) => r[enc.group || "group"]))];
      const data = cats.map((c) => {
        const vals = rows.filter((r) => r[enc.group || "group"] === c).map((r) => num(r[enc.value || "value"])).sort((a, b) => a - b);
        const q = (p) => vals[Math.floor(p * (vals.length - 1))] ?? 0;
        return [q(0), q(0.25), q(0.5), q(0.75), q(1)];
      });
      return { ...base, xAxis: catAxis(cats), yAxis: valAxis(), series: [{ type: "boxplot", data }] };
    }
    default:
      return specToOption({ ...s, type: "bar" }, dark);
  }
}

// Normalise graph/sankey data from either {nodes,links} or flat source/target rows.
function graphData(s, enc) {
  if (s.data && s.data.nodes && s.data.links) {
    return { nodes: s.data.nodes.map((n) => (typeof n === "string" ? { name: n } : n)), links: s.data.links };
  }
  const rows = Array.isArray(s.data) ? s.data : [];
  const source = enc.source || "source", target = enc.target || "target", value = enc.value || "value";
  const names = new Set();
  const links = rows.map((r) => { names.add(r[source]); names.add(r[target]); return { source: String(r[source]), target: String(r[target]), value: num(r[value]) || 1 }; });
  return { nodes: [...names].map((name) => ({ name: String(name) })), links };
}

// Is this a map spec? (Canvas renders these with Leaflet, not ECharts.)
export function isMapSpec(spec) {
  return spec?.type === "map";
}

// The JSON schema an LLM must emit — used to force structured output.
export const VIZ_SCHEMA = {
  type: "object",
  properties: {
    specs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: TYPES },
          title: { type: "string" },
          rationale: { type: "string" },
          data: {},
          encodings: { type: "object" },
          style: { type: "object" },
        },
        required: ["type", "title", "data"],
      },
    },
  },
  required: ["specs"],
};

// LLM layer: intent (+ optional data) → N different visualisation specs. The
// model chooses the chart type per view, so the dashboard morphs to the request.
export async function askForViz(prompt, data, n = 5) {
  const { activeProvider, callProvider } = await import("./providers.js");
  if (!activeProvider()) return { ok: false, reason: "Enable a provider to generate visualisations." };
  const dataHint = data ? `\n\nData (JSON — bind these fields via encodings, and copy the rows into each spec's "data"):\n${JSON.stringify(data).slice(0, 3500)}` : "";
  try {
    const raw = await callProvider(activeProvider().id, [
      { role: "system", content: `You are a data-visualisation designer. Given an intent and optional data, return ${n} DISTINCT visualisations — different chart types/styles that each reveal something different. Pick the best type per view from: ${TYPES.join(", ")}. Output STRICT JSON only: {"specs":[{"type","title","rationale","data","encodings","style"}]}. Put the actual data rows inside each spec's "data" (for graph/sankey use {nodes,links}). encodings maps field names (x,y,value,name,source,target,group).` },
      { role: "user", content: `Intent: ${prompt}${dataHint}` },
    ], { json: true });
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : {};
    const specs = (parsed.specs || []).filter((s) => s && s.type && s.data);
    return specs.length ? { ok: true, specs } : { ok: false, reason: "No specs returned." };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

// Parse pasted/loaded text into rows — JSON array/object, or CSV. Numeric cells
// are coerced to numbers so the renderer + auto-viz treat them as measures.
export function parseRows(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t[0] === "[" || t[0] === "{") {
    try {
      const d = JSON.parse(t);
      return Array.isArray(d) ? d : d.data || d.rows || d.results || d.items || [];
    } catch {
      /* fall through to CSV */
    }
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
  const split = (ln) => ln.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  const headers = split(lines[0]);
  return lines.slice(1).map((ln) => {
    const cells = split(ln), o = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      o[h] = v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
    });
    return o;
  });
}

// Auto-viz: infer sensible visualisation specs from a dataset's SHAPE (no AI).
// Categorical × numeric → bar + pie; two numerics → scatter; a lone measure →
// line. Lets the Canvas morph REAL data even without a provider.
export function autoSpecs(rows, max = 4) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const keys = Object.keys(rows[0] || {});
  const isNum = (k) =>
    rows.some((r) => r[k] !== "" && r[k] != null && !Number.isNaN(Number(r[k]))) &&
    rows.every((r) => r[k] === "" || r[k] == null || !Number.isNaN(Number(r[k])));
  const numeric = keys.filter(isNum);
  const categorical = keys.filter((k) => !numeric.includes(k));
  const cat = categorical[0], val = numeric[0];
  const specs = [];
  if (cat && val) {
    specs.push({ type: "bar", title: `${val} by ${cat}`, data: rows, encodings: { x: cat, y: val } });
    specs.push({ type: "pie", title: `${val} share by ${cat}`, data: rows, encodings: { name: cat, value: val } });
  }
  if (numeric.length >= 2) {
    specs.push({ type: "scatter", title: `${numeric[0]} vs ${numeric[1]}`, data: rows, encodings: { x: numeric[0], y: numeric[1], name: cat } });
  }
  if (val && !cat) {
    specs.push({ type: "line", title: val, data: rows.map((r, i) => ({ x: i, y: r[val] })), encodings: { x: "x", y: "y" } });
  }
  return specs.slice(0, max);
}

// Deterministic demo specs (no provider needed) — proves the morph across styles.
export function demoSpecs() {
  return [
    { type: "bar", title: "Records by stage", data: [{ x: "Identified", y: 3695 }, { x: "Title", y: 973 }, { x: "Abstract", y: 296 }, { x: "Included", y: 208 }], encodings: { x: "x", y: "y" } },
    { type: "sankey", title: "Screening funnel", data: { nodes: [{ name: "Identified" }, { name: "Title KEEP" }, { name: "Abstract KEEP" }, { name: "Included" }, { name: "Excluded" }], links: [{ source: "Identified", target: "Title KEEP", value: 973 }, { source: "Identified", target: "Excluded", value: 2722 }, { source: "Title KEEP", target: "Abstract KEEP", value: 296 }, { source: "Abstract KEEP", target: "Included", value: 208 }] } },
    { type: "graph", title: "Evidence network", data: [{ source: "SAM", target: "Mortality", value: 8 }, { source: "SAM", target: "Stunting", value: 5 }, { source: "RUTF", target: "SAM", value: 6 }, { source: "Diarrhoea", target: "SAM", value: 4 }], encodings: { source: "source", target: "target", value: "value" } },
    { type: "heatmap", title: "Risk-of-bias by domain", data: [{ x: "Selection", y: "S1", value: 2 }, { x: "Performance", y: "S1", value: 1 }, { x: "Selection", y: "S2", value: 3 }, { x: "Performance", y: "S2", value: 2 }], encodings: { x: "x", y: "y", value: "value" } },
    { type: "radar", title: "QWoE dimensions", data: [{ name: "Consistency", value: 4 }, { name: "Directness", value: 3 }, { name: "Precision", value: 5 }, { name: "Magnitude", value: 4 }, { name: "Coherence", value: 3 }], encodings: { name: "name", value: "value" } },
    { type: "map", title: "Study sites", data: [{ name: "Malawi", lat: -13.25, lng: 34.3, value: 12 }, { name: "Ethiopia", lat: 9.1, lng: 40.5, value: 20 }, { name: "Bangladesh", lat: 23.7, lng: 90.4, value: 8 }, { name: "Niger", lat: 17.6, lng: 8.1, value: 15 }], encodings: { lat: "lat", lng: "lng", value: "value", name: "name" } },
  ];
}
