import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseInverseVariance } from '../src/synthesis/inverse-variance.js';
import { renderForestPlot } from '../src/visualization/forest-plot.js';
import type { RiskOfBiasAssessment } from '../src/core/types.js';

const estimates = [
  { studyId: 'study-a', label: 'Alpha 2024', outcome: 'Mortality', effect: -0.20, standardError: 0.10, provenanceIds: ['extract:a'] },
  { studyId: 'study-b', label: 'Beta 2025', outcome: 'Mortality', effect: -0.05, standardError: 0.20, provenanceIds: ['extract:b'] },
  { studyId: 'study-c', label: 'Gamma 2026', outcome: 'Mortality', effect: 0.15, standardError: 0.30, provenanceIds: ['extract:c'] },
];

const rob: RiskOfBiasAssessment[] = [
  { studyId: 'study-a', tool: 'RoB 2', overall: 'low', domains: [] },
  { studyId: 'study-b', tool: 'RoB 2', overall: 'some-concerns', domains: [] },
  { studyId: 'study-c', tool: 'RoB 2', overall: 'high', domains: [] },
];

test('inverse-variance table and pooled summary are internally coherent', () => {
  const summary = analyseInverseVariance(estimates, 'Mortality');
  assert.equal(summary.k, 3);
  assert.ok(Math.abs(summary.rows.reduce((sum, row) => sum + row.weightPercent, 0) - 100) < 1e-10);
  assert.ok(summary.rows[0]!.weightPercent > summary.rows[1]!.weightPercent);
  assert.ok(summary.rows[1]!.weightPercent > summary.rows[2]!.weightPercent);
  assert.ok(summary.ciLow < summary.pooledEffect);
  assert.ok(summary.ciHigh > summary.pooledEffect);
  assert.ok(summary.i2 >= 0 && summary.i2 <= 100);
});

test('forest plot is deterministic vector output with exact analysis/provenance coupling', () => {
  const summary = analyseInverseVariance(estimates, 'Mortality');
  const first = renderForestPlot(summary, rob, {
    title: 'Mortality forest plot',
    outcome: 'Mortality',
    measureLabel: 'Risk difference',
    favorsLeft: 'Favours intervention',
    favorsRight: 'Favours comparator',
  });
  const second = renderForestPlot(summary, rob, {
    title: 'Mortality forest plot',
    outcome: 'Mortality',
    measureLabel: 'Risk difference',
    favorsLeft: 'Favours intervention',
    favorsRight: 'Favours comparator',
  });

  assert.equal(first.provenance.contentSha256, second.provenance.contentSha256);
  assert.equal(first.id, second.id);
  assert.equal(first.svg, second.svg);
  assert.equal(first.analysisTable.length, 3);
  assert.equal(first.summary.effect, summary.pooledEffect);
  assert.equal(first.summary.ciLow, summary.ciLow);
  assert.equal(first.summary.ciHigh, summary.ciHigh);
  assert.deepEqual(first.provenance.rowStudyIds, ['study-a', 'study-b', 'study-c']);
  assert.deepEqual(first.provenance.rowProvenanceIds.sort(), ['extract:a', 'extract:b', 'extract:c']);
  assert.match(first.svg, /<svg/);
  assert.match(first.svg, /Forest plot|Mortality forest plot/);
  assert.match(first.svg, /data-study-id="study-a"/);
  assert.match(first.svg, /Diamond = pooled 95% CI/);
  assert.match(first.svg, /aria-label="Risk of bias low"/);
  assert.match(first.svg, /aria-label="Risk of bias some concerns"/);
  assert.match(first.svg, /aria-label="Risk of bias high"/);
  assert.match(first.accessibilityText, /Pooled Risk difference/);
});

test('confidence intervals clipped by a focused axis keep explicit truncation arrows and QA warnings', () => {
  const summary = analyseInverseVariance(estimates, 'Mortality');
  const plot = renderForestPlot(summary, rob, {
    title: 'Focused forest plot',
    measureLabel: 'Risk difference',
    axisMin: -0.25,
    axisMax: 0.25,
  });
  assert.ok(plot.qa.clippedLow + plot.qa.clippedHigh > 0);
  assert.ok(plot.qa.warnings.some((warning) => /clipped/i.test(warning)));
  assert.match(plot.svg, /arrow|M /);
});

test('exp display transform supports ratio-style forest labels without changing analysis-space math', () => {
  const logEstimates = [
    { studyId: 'a', label: 'A', outcome: 'Mortality', effect: Math.log(0.8), standardError: 0.10 },
    { studyId: 'b', label: 'B', outcome: 'Mortality', effect: Math.log(0.9), standardError: 0.12 },
  ];
  const summary = analyseInverseVariance(logEstimates, 'Mortality');
  const plot = renderForestPlot(summary, [], {
    title: 'Ratio forest plot',
    measureLabel: 'Risk ratio',
    transform: 'exp',
    analysisNull: 0,
  });
  assert.equal(plot.displayNull, 1);
  assert.ok(plot.summary.displayEffect > 0);
  assert.equal(plot.summary.effect, summary.pooledEffect);
  assert.equal(plot.axis.ticks.find((tick) => tick.analysisValue === 0)?.displayValue, 1);
});
