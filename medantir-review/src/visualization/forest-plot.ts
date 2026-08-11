import { createHash } from 'node:crypto';
import type { RiskOfBiasAssessment } from '../core/types.js';
import type { AnalysedEstimate, InverseVarianceSummary } from '../synthesis/inverse-variance.js';

export type ForestDisplayTransform = 'identity' | 'exp';

export interface ForestPlotOptions {
  id?: string;
  title: string;
  outcome?: string;
  measureLabel?: string;
  transform?: ForestDisplayTransform;
  analysisNull?: number;
  favorsLeft?: string;
  favorsRight?: string;
  width?: number;
  rowHeight?: number;
  axisMin?: number;
  axisMax?: number;
  maxTicks?: number;
  showRiskOfBias?: boolean;
}

export interface ForestPlotDataRow extends AnalysedEstimate {
  displayEffect: number;
  displayCiLow: number;
  displayCiHigh: number;
  riskOfBias: RiskOfBiasAssessment['overall'] | 'not-assessed';
}

export interface ForestPlotArtifact {
  id: string;
  kind: 'forest-plot';
  version: '1';
  title: string;
  subtitle: string;
  outcome: string;
  measureLabel: string;
  transform: ForestDisplayTransform;
  analysisNull: number;
  displayNull: number;
  analysisTable: ForestPlotDataRow[];
  summary: {
    effect: number;
    ciLow: number;
    ciHigh: number;
    displayEffect: number;
    displayCiLow: number;
    displayCiHigh: number;
    standardError: number;
    q: number;
    i2: number;
    k: number;
  };
  axis: {
    analysisMin: number;
    analysisMax: number;
    ticks: Array<{ analysisValue: number; displayValue: number; label: string }>;
  };
  qa: {
    clippedLow: number;
    clippedHigh: number;
    riskOfBiasMissing: number;
    exactSummaryMatch: true;
    warnings: string[];
  };
  provenance: {
    analysisMethod: InverseVarianceSummary['method'];
    confidenceLevel: number;
    rowStudyIds: string[];
    rowProvenanceIds: string[];
    contentSha256: string;
  };
  accessibilityText: string;
  svg: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function transformValue(value: number, transform: ForestDisplayTransform): number {
  return transform === 'exp' ? Math.exp(value) : value;
}

function formatNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 100) return value.toFixed(1);
  if (absolute >= 10) return value.toFixed(2);
  if (absolute >= 1) return value.toFixed(2);
  if (absolute >= 0.01) return value.toFixed(3);
  return value.toPrecision(3);
}

function niceStep(span: number, maxTicks: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(2, maxTicks - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return nice * power;
}

function ticks(min: number, max: number, maxTicks: number): number[] {
  const step = niceStep(max - min, maxTicks);
  const start = Math.ceil(min / step) * step;
  const values: number[] = [];
  for (let value = start; value <= max + step * 1e-8; value += step) {
    values.push(Number(value.toPrecision(12)));
    if (values.length > maxTicks + 3) break;
  }
  return values;
}

function autoRange(summary: InverseVarianceSummary, analysisNull: number): { min: number; max: number } {
  const values = [
    analysisNull,
    summary.ciLow,
    summary.ciHigh,
    ...summary.rows.flatMap((row) => [row.ciLow, row.ciHigh, row.effect]),
  ].filter(Number.isFinite);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const pad = Math.max(span * 0.08, Math.abs(max || min || 1) * 0.02, 0.05);
  return { min: min - pad, max: max + pad };
}

function robGlyph(
  risk: ForestPlotDataRow['riskOfBias'],
  x: number,
  y: number,
): string {
  const size = 15;
  if (risk === 'low') {
    return `<g aria-label="Risk of bias low"><circle cx="${x}" cy="${y}" r="${size / 2}" fill="white" stroke="#222" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" font-weight="700">L</text></g>`;
  }
  if (risk === 'some-concerns') {
    return `<g aria-label="Risk of bias some concerns"><rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="2" fill="url(#robHatch)" stroke="#222" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" font-weight="700">?</text></g>`;
  }
  if (risk === 'high') {
    return `<g aria-label="Risk of bias high"><rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" rx="2" fill="#222" stroke="#222" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" font-weight="700" fill="white">H</text></g>`;
  }
  return `<g aria-label="Risk of bias not assessed"><circle cx="${x}" cy="${y}" r="${size / 2}" fill="white" stroke="#777" stroke-width="1" stroke-dasharray="2 2"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9">–</text></g>`;
}

function arrowLeft(x: number, y: number): string {
  return `<path d="M ${x + 8} ${y - 5} L ${x} ${y} L ${x + 8} ${y + 5}" fill="none" stroke="#222" stroke-width="1.5"/>`;
}

function arrowRight(x: number, y: number): string {
  return `<path d="M ${x - 8} ${y - 5} L ${x} ${y} L ${x - 8} ${y + 5}" fill="none" stroke="#222" stroke-width="1.5"/>`;
}

function hashArtifact(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

/**
 * Deterministic scientific forest-plot renderer.
 *
 * The analysis table is authoritative; SVG coordinates are a pure projection.
 * No model fitting, pooling, CI calculation or risk-of-bias inference occurs in
 * the renderer. That separation is deliberate so the figure cannot silently
 * disagree with the statistical artifact it visualizes.
 */
export function renderForestPlot(
  summary: InverseVarianceSummary,
  riskOfBias: RiskOfBiasAssessment[] = [],
  options: ForestPlotOptions,
): ForestPlotArtifact {
  const transform = options.transform ?? 'identity';
  const analysisNull = options.analysisNull ?? 0;
  const measureLabel = options.measureLabel ?? 'Effect estimate';
  const width = Math.max(1040, options.width ?? 1360);
  const rowHeight = Math.max(28, options.rowHeight ?? 36);
  const maxTicks = Math.max(4, Math.min(9, options.maxTicks ?? 7));
  const showRiskOfBias = options.showRiskOfBias ?? true;

  const byStudy = new Map(riskOfBias.map((assessment) => [assessment.studyId, assessment.overall]));
  const rows: ForestPlotDataRow[] = summary.rows.map((row) => ({
    ...row,
    displayEffect: transformValue(row.effect, transform),
    displayCiLow: transformValue(row.ciLow, transform),
    displayCiHigh: transformValue(row.ciHigh, transform),
    riskOfBias: byStudy.get(row.studyId) ?? 'not-assessed',
  }));

  const inferred = autoRange(summary, analysisNull);
  const axisMin = options.axisMin ?? inferred.min;
  const axisMax = options.axisMax ?? inferred.max;
  if (!(axisMax > axisMin)) throw new Error('Forest plot axisMax must be greater than axisMin');
  if (analysisNull < axisMin || analysisNull > axisMax) throw new Error('Forest plot null value must lie inside the plotted axis');

  const tickValues = ticks(axisMin, axisMax, maxTicks);
  if (!tickValues.some((value) => Math.abs(value - analysisNull) < 1e-12)) tickValues.push(analysisNull);
  tickValues.sort((a, b) => a - b);

  const left = 28;
  const studyColumnWidth = Math.min(355, Math.max(285, width * 0.26));
  const plotLeft = left + studyColumnWidth;
  const rightColumnsWidth = showRiskOfBias ? 420 : 340;
  const plotRight = width - rightColumnsWidth;
  const plotWidth = plotRight - plotLeft;
  if (plotWidth < 360) throw new Error('Forest plot width is too narrow for the requested table + plot layout');

  // Numeric columns are right-anchored so exact CI strings cannot drift into
  // the weight column. This geometry was established from rendered SVG QA,
  // not estimated from unit-test strings alone.
  const robX = width - 36;
  const weightTextX = showRiskOfBias ? width - 105 : width - 30;
  const effectTextRight = weightTextX - 82;
  const effectHeaderX = effectTextRight;
  const headerY = 78;
  const firstRowY = 128;
  const pooledY = firstRowY + rows.length * rowHeight + 14;
  const axisY = pooledY + 42;
  const footerY = axisY + 64;
  const height = footerY + 44;
  const x = (value: number) => plotLeft + ((value - axisMin) / (axisMax - axisMin)) * plotWidth;
  const clipX = (value: number) => Math.max(plotLeft, Math.min(plotRight, x(value)));

  let clippedLow = 0;
  let clippedHigh = 0;
  const maxWeight = Math.max(...rows.map((row) => row.weightPercent), 1);
  const studyRowsSvg = rows.map((row, index) => {
    const y = firstRowY + index * rowHeight;
    const ciLowX = clipX(row.ciLow);
    const ciHighX = clipX(row.ciHigh);
    const effectX = clipX(row.effect);
    const lowClipped = row.ciLow < axisMin;
    const highClipped = row.ciHigh > axisMax;
    if (lowClipped) clippedLow += 1;
    if (highClipped) clippedHigh += 1;
    const markerSide = 7 + Math.sqrt(row.weightPercent / maxWeight) * 13;
    const ciLabel = `${formatNumber(row.displayEffect)} [${formatNumber(row.displayCiLow)}, ${formatNumber(row.displayCiHigh)}]`;
    const stripe = index % 2 === 1
      ? `<rect x="${left}" y="${y - rowHeight / 2}" width="${width - left * 2}" height="${rowHeight}" fill="#fafafa"/>`
      : '';
    return [
      `<g id="forest-row-${escapeXml(row.studyId)}" data-study-id="${escapeXml(row.studyId)}">`,
      stripe,
      `<text x="${left}" y="${y + 5}" font-size="13" fill="#161616">${escapeXml(row.label)}</text>`,
      `<line x1="${ciLowX}" y1="${y}" x2="${ciHighX}" y2="${y}" stroke="#222" stroke-width="1.5"/>`,
      lowClipped ? arrowLeft(plotLeft, y) : `<line x1="${ciLowX}" y1="${y - 4}" x2="${ciLowX}" y2="${y + 4}" stroke="#222" stroke-width="1.2"/>`,
      highClipped ? arrowRight(plotRight, y) : `<line x1="${ciHighX}" y1="${y - 4}" x2="${ciHighX}" y2="${y + 4}" stroke="#222" stroke-width="1.2"/>`,
      `<rect x="${effectX - markerSide / 2}" y="${y - markerSide / 2}" width="${markerSide}" height="${markerSide}" fill="#315d80" stroke="#17344d" stroke-width="1"/>`,
      `<text x="${effectTextRight}" y="${y + 5}" text-anchor="end" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#222">${escapeXml(ciLabel)}</text>`,
      `<text x="${weightTextX}" y="${y + 5}" font-size="12" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="end" fill="#444">${row.weightPercent.toFixed(1)}%</text>`,
      showRiskOfBias ? robGlyph(row.riskOfBias, robX, y) : '',
      '</g>',
    ].join('');
  }).join('');

  const pooledLowX = clipX(summary.ciLow);
  const pooledEffectX = clipX(summary.pooledEffect);
  const pooledHighX = clipX(summary.ciHigh);
  const pooledDisplay = transformValue(summary.pooledEffect, transform);
  const pooledDisplayLow = transformValue(summary.ciLow, transform);
  const pooledDisplayHigh = transformValue(summary.ciHigh, transform);
  const pooledLabel = `${formatNumber(pooledDisplay)} [${formatNumber(pooledDisplayLow)}, ${formatNumber(pooledDisplayHigh)}]`;
  const diamond = `<path d="M ${pooledLowX} ${pooledY} L ${pooledEffectX} ${pooledY - 9} L ${pooledHighX} ${pooledY} L ${pooledEffectX} ${pooledY + 9} Z" fill="#17344d" stroke="#17344d" stroke-width="1.2"/>`;
  const nullX = x(analysisNull);

  const tickSvg = tickValues.map((value) => {
    const tx = x(value);
    const display = transformValue(value, transform);
    return `<g><line x1="${tx}" y1="${axisY - 5}" x2="${tx}" y2="${axisY + 5}" stroke="#555"/><text x="${tx}" y="${axisY + 22}" text-anchor="middle" font-size="11" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#444">${escapeXml(formatNumber(display))}</text></g>`;
  }).join('');

  const title = options.title;
  const outcome = options.outcome ?? summary.outcome;
  const subtitle = `${measureLabel} • common-effect inverse-variance • 95% CI • k=${summary.k} • I²=${summary.i2.toFixed(1)}%`;
  const favorsLeft = options.favorsLeft ?? 'Favours left';
  const favorsRight = options.favorsRight ?? 'Favours right';
  const displayNull = transformValue(analysisNull, transform);
  const riskMissing = rows.filter((row) => row.riskOfBias === 'not-assessed').length;
  const warnings = [
    ...(clippedLow + clippedHigh > 0 ? [`${clippedLow + clippedHigh} confidence interval(s) clipped by the displayed axis; arrowheads preserve truncation visibility.`] : []),
    ...(riskMissing > 0 && showRiskOfBias ? [`Risk-of-bias assessment missing for ${riskMissing} plotted study/studies.`] : []),
  ];

  const provenanceInput = {
    summary,
    rows: rows.map((row) => ({
      studyId: row.studyId,
      outcome: row.outcome,
      effect: row.effect,
      standardError: row.standardError,
      ciLow: row.ciLow,
      ciHigh: row.ciHigh,
      weightPercent: row.weightPercent,
      provenanceIds: row.provenanceIds ?? [],
    })),
    render: { title, outcome, measureLabel, transform, analysisNull, axisMin, axisMax, width },
  };
  const contentSha256 = hashArtifact(provenanceInput);
  const id = options.id ?? `forest-${contentSha256.slice(0, 16)}`;
  const accessibilityText = `${title}. ${outcome}. ${summary.k} studies. Pooled ${measureLabel} ${pooledLabel}. Heterogeneity I squared ${summary.i2.toFixed(1)} percent. `
    + rows.map((row) => `${row.label}: ${formatNumber(row.displayEffect)}, 95 percent confidence interval ${formatNumber(row.displayCiLow)} to ${formatNumber(row.displayCiHigh)}, weight ${row.weightPercent.toFixed(1)} percent, risk of bias ${row.riskOfBias}.`).join(' ');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${id}-title ${id}-desc" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `<title id="${id}-title">${escapeXml(title)}</title>`,
    `<desc id="${id}-desc">${escapeXml(accessibilityText)}</desc>`,
    `<metadata>${escapeXml(JSON.stringify({ id, contentSha256, outcome, method: summary.method }))}</metadata>`,
    '<defs><pattern id="robHatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#777" stroke-width="1"/></pattern></defs>',
    `<rect width="100%" height="100%" fill="white"/>`,
    `<text x="${left}" y="34" font-size="21" font-weight="700" fill="#111">${escapeXml(title)}</text>`,
    `<text x="${left}" y="57" font-size="12" fill="#555">${escapeXml(subtitle)}</text>`,
    `<line x1="${left}" y1="${headerY + 12}" x2="${width - left}" y2="${headerY + 12}" stroke="#c9c9c9"/>`,
    `<text x="${left}" y="${headerY}" font-size="11" font-weight="700" fill="#444">STUDY</text>`,
    `<text x="${(plotLeft + plotRight) / 2}" y="${headerY}" text-anchor="middle" font-size="11" font-weight="700" fill="#444">${escapeXml(measureLabel.toUpperCase())} (95% CI)</text>`,
    `<text x="${effectHeaderX}" y="${headerY}" text-anchor="end" font-size="11" font-weight="700" fill="#444">ESTIMATE [95% CI]</text>`,
    `<text x="${weightTextX}" y="${headerY}" text-anchor="end" font-size="11" font-weight="700" fill="#444">WEIGHT</text>`,
    showRiskOfBias ? `<text x="${robX}" y="${headerY}" text-anchor="middle" font-size="11" font-weight="700" fill="#444">ROB</text>` : '',
    `<line x1="${plotRight + 12}" y1="${headerY + 18}" x2="${plotRight + 12}" y2="${pooledY + 14}" stroke="#e1e1e1" stroke-width="1"/>`,
    `<line x1="${nullX}" y1="${headerY + 17}" x2="${nullX}" y2="${pooledY + 14}" stroke="#888" stroke-width="1.2" stroke-dasharray="4 4"/>`,
    studyRowsSvg,
    `<line x1="${left}" y1="${pooledY - 20}" x2="${width - left}" y2="${pooledY - 20}" stroke="#c9c9c9"/>`,
    `<text x="${left}" y="${pooledY + 5}" font-size="13" font-weight="700" fill="#111">Overall</text>`,
    diamond,
    `<text x="${effectTextRight}" y="${pooledY + 5}" text-anchor="end" font-size="12" font-weight="700" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#111">${escapeXml(pooledLabel)}</text>`,
    `<text x="${weightTextX}" y="${pooledY + 5}" font-size="12" font-weight="700" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" text-anchor="end" fill="#111">100.0%</text>`,
    `<line x1="${plotLeft}" y1="${axisY}" x2="${plotRight}" y2="${axisY}" stroke="#333" stroke-width="1.2"/>`,
    tickSvg,
    `<text x="${plotLeft}" y="${axisY + 47}" text-anchor="start" font-size="11" fill="#555">${escapeXml(favorsLeft)}</text>`,
    `<text x="${plotRight}" y="${axisY + 47}" text-anchor="end" font-size="11" fill="#555">${escapeXml(favorsRight)}</text>`,
    `<text x="${left}" y="${footerY}" font-size="11" fill="#555">Heterogeneity: Q=${summary.q.toFixed(2)}, I²=${summary.i2.toFixed(1)}%. Null=${formatNumber(displayNull)}. Diamond = pooled 95% CI.</text>`,
    `<text x="${width - left}" y="${footerY}" text-anchor="end" font-size="9" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" fill="#777">sha256:${contentSha256.slice(0, 16)}…</text>`,
    '</svg>',
  ].join('');

  return {
    id,
    kind: 'forest-plot',
    version: '1',
    title,
    subtitle,
    outcome,
    measureLabel,
    transform,
    analysisNull,
    displayNull,
    analysisTable: rows,
    summary: {
      effect: summary.pooledEffect,
      ciLow: summary.ciLow,
      ciHigh: summary.ciHigh,
      displayEffect: pooledDisplay,
      displayCiLow: pooledDisplayLow,
      displayCiHigh: pooledDisplayHigh,
      standardError: summary.pooledStandardError,
      q: summary.q,
      i2: summary.i2,
      k: summary.k,
    },
    axis: {
      analysisMin: axisMin,
      analysisMax: axisMax,
      ticks: tickValues.map((analysisValue) => ({
        analysisValue,
        displayValue: transformValue(analysisValue, transform),
        label: formatNumber(transformValue(analysisValue, transform)),
      })),
    },
    qa: {
      clippedLow,
      clippedHigh,
      riskOfBiasMissing: riskMissing,
      exactSummaryMatch: true,
      warnings,
    },
    provenance: {
      analysisMethod: summary.method,
      confidenceLevel: summary.confidenceLevel,
      rowStudyIds: rows.map((row) => row.studyId),
      rowProvenanceIds: [...new Set(rows.flatMap((row) => row.provenanceIds ?? []))],
      contentSha256,
    },
    accessibilityText,
    svg,
  };
}
