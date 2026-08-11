import React, { useMemo } from "react";

function extent(result) {
  const values = [result.nullLine, result.random.effect, ...result.random.ci];
  for (const study of result.random.studies || []) values.push(study.effect, ...(study.ci || []));
  const positive = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!positive.length) return [0.25, 4];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const pad = Math.max(0.18, (logMax - logMin) * 0.12);
  return [Math.exp(logMin - pad), Math.exp(logMax + pad)];
}

function niceRatioTicks(min, max) {
  const candidates = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10, 20];
  const ticks = candidates.filter((value) => value >= min && value <= max);
  if (!ticks.includes(1) && min < 1 && max > 1) ticks.push(1);
  return [...new Set(ticks)].sort((a, b) => a - b).slice(0, 7);
}

export function forestPlotSvg(result, { title = "Forest plot" } = {}) {
  if (!result?.ok || !result.random?.studies?.length) return "";
  const studies = result.random.studies;
  const rowH = 34;
  const top = 58;
  const bottom = 74;
  const width = 1040;
  const height = top + studies.length * rowH + bottom + 42;
  const labelX = 18;
  const plotLeft = 285;
  const plotRight = 725;
  const valueX = 755;
  const weightX = 965;
  const [min, max] = extent(result);
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  const x = (value) => plotLeft + ((Math.log(Math.max(value, 1e-12)) - logMin) / (logMax - logMin || 1)) * (plotRight - plotLeft);
  const ticks = niceRatioTicks(min, max);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
  const lineY = top + studies.length * rowH + 18;
  const pooledY = top + studies.length * rowH + 3;
  const diamondHalfH = 8;
  const pooledX = x(result.random.effect);
  const pooledLo = x(result.random.ci[0]);
  const pooledHi = x(result.random.ci[1]);

  const rows = studies.map((study, index) => {
    const y = top + index * rowH;
    const lo = x(study.ci[0]);
    const hi = x(study.ci[1]);
    const pt = x(study.effect);
    const side = Math.max(5, Math.min(17, Math.sqrt(Math.max(1, study.weight || 1) * 5.5)));
    return `
      <g data-study="${esc(study.name)}" data-weight="${study.weight}">
        <text x="${labelX}" y="${y + 4}" class="study">${esc(study.name)}</text>
        <line x1="${lo.toFixed(2)}" x2="${hi.toFixed(2)}" y1="${y}" y2="${y}" class="ci" />
        <line x1="${lo.toFixed(2)}" x2="${lo.toFixed(2)}" y1="${y - 4}" y2="${y + 4}" class="ci" />
        <line x1="${hi.toFixed(2)}" x2="${hi.toFixed(2)}" y1="${y - 4}" y2="${y + 4}" class="ci" />
        <rect x="${(pt - side / 2).toFixed(2)}" y="${(y - side / 2).toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" class="marker" />
        <text x="${valueX}" y="${y + 4}" class="value">${study.effect.toFixed(3)} [${study.ci[0].toFixed(3)}, ${study.ci[1].toFixed(3)}]</text>
        <text x="${weightX}" y="${y + 4}" class="weight">${Number(study.weight).toFixed(1)}%</text>
      </g>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="forest-title forest-desc" viewBox="0 0 ${width} ${height}" width="100%">
    <title id="forest-title">${esc(title)}</title>
    <desc id="forest-desc">Forest plot of ${studies.length} studies. Random-effects ${esc(result.measure)} ${result.random.effect.toFixed(3)}, 95% CI ${result.random.ci[0].toFixed(3)} to ${result.random.ci[1].toFixed(3)}. I squared ${result.heterogeneity.I2} percent.</desc>
    <style>
      text { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; fill: #5b6470; font-size: 11px; }
      .head { fill: #20252b; font-size: 11px; font-weight: 650; }
      .study { fill: #323840; font-size: 11px; }
      .value,.weight { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
      .ci { stroke: #69737e; stroke-width: 1.35; }
      .marker { fill: #3f6f94; stroke: #315f85; stroke-width: 1; }
      .null { stroke: #9aa3ad; stroke-width: 1; stroke-dasharray: 4 4; }
      .axis { stroke: #aeb5bd; stroke-width: 1; }
      .diamond { fill: #315f85; stroke: #274e6e; stroke-width: 1; }
      .rule { stroke: #dce1e7; stroke-width: 1; }
      @media (prefers-color-scheme: dark) {
        text { fill: #9aa3ad; } .head,.study { fill: #e5e8eb; } .ci { stroke: #aab3bc; }
        .null,.axis { stroke: #707985; } .rule { stroke: #343b43; }
        .marker,.diamond { fill: #6f9abc; stroke: #8aacc6; }
      }
    </style>
    <text x="${labelX}" y="26" class="head">Study</text>
    <text x="${(plotLeft + plotRight) / 2}" y="26" text-anchor="middle" class="head">${esc(result.measure)} (95% CI)</text>
    <text x="${valueX}" y="26" class="head">Estimate [95% CI]</text>
    <text x="${weightX}" y="26" class="head">Weight</text>
    <line x1="0" x2="${width}" y1="38" y2="38" class="rule" />
    <line x1="${x(result.nullLine).toFixed(2)}" x2="${x(result.nullLine).toFixed(2)}" y1="45" y2="${lineY}" class="null" />
    ${rows}
    <line x1="0" x2="${width}" y1="${pooledY - 17}" y2="${pooledY - 17}" class="rule" />
    <text x="${labelX}" y="${pooledY + 4}" class="head">Random effects</text>
    <polygon points="${pooledLo.toFixed(2)},${pooledY} ${pooledX.toFixed(2)},${pooledY - diamondHalfH} ${pooledHi.toFixed(2)},${pooledY} ${pooledX.toFixed(2)},${pooledY + diamondHalfH}" class="diamond" />
    <text x="${valueX}" y="${pooledY + 4}" class="value">${result.random.effect.toFixed(3)} [${result.random.ci[0].toFixed(3)}, ${result.random.ci[1].toFixed(3)}]</text>
    <line x1="${plotLeft}" x2="${plotRight}" y1="${lineY}" y2="${lineY}" class="axis" />
    ${ticks.map((tick) => `<g><line x1="${x(tick).toFixed(2)}" x2="${x(tick).toFixed(2)}" y1="${lineY}" y2="${lineY + 5}" class="axis"/><text x="${x(tick).toFixed(2)}" y="${lineY + 20}" text-anchor="middle">${tick}</text></g>`).join("")}
    <text x="${plotLeft}" y="${lineY + 42}" class="value">Favours treatment</text>
    <text x="${plotRight}" y="${lineY + 42}" text-anchor="end" class="value">Favours control</text>
    <text x="${labelX}" y="${lineY + 42}" class="value">I² ${result.heterogeneity.I2}% · τ² ${result.heterogeneity.tau2} · Q ${result.heterogeneity.Q}</text>
  </svg>`;
}

export default function ForestPlotView({ result, title = "Forest plot" }) {
  const svg = useMemo(() => forestPlotSvg(result, { title }), [result, title]);
  if (!svg) return null;
  return <div className="ui-panel overflow-x-auto"><div className="min-w-[760px]" dangerouslySetInnerHTML={{ __html: svg }} /></div>;
}
