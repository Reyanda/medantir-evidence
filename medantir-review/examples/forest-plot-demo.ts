import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyseInverseVariance } from '../src/synthesis/inverse-variance.js';
import { renderForestPlot } from '../src/visualization/forest-plot.js';
import type { RiskOfBiasAssessment } from '../src/core/types.js';

const estimates = [
  { studyId: 'ACTT2', label: 'Kalil 2021 (ACTT-2)', outcome: 'Time to recovery', effect: -0.23, standardError: 0.075, provenanceIds: ['NCT04401579', 'PMID:33306283'] },
  { studyId: 'TRIAL-B', label: 'Adams 2021', outcome: 'Time to recovery', effect: -0.16, standardError: 0.105, provenanceIds: ['trial-b'] },
  { studyId: 'TRIAL-C', label: 'Bello 2022', outcome: 'Time to recovery', effect: -0.31, standardError: 0.135, provenanceIds: ['trial-c'] },
  { studyId: 'TRIAL-D', label: 'Chen 2022', outcome: 'Time to recovery', effect: -0.04, standardError: 0.160, provenanceIds: ['trial-d'] },
  { studyId: 'TRIAL-E', label: 'Dlamini 2023', outcome: 'Time to recovery', effect: -0.20, standardError: 0.090, provenanceIds: ['trial-e'] },
  { studyId: 'TRIAL-F', label: 'Evans 2024', outcome: 'Time to recovery', effect: -0.10, standardError: 0.190, provenanceIds: ['trial-f'] },
  { studyId: 'TRIAL-G', label: 'Fernandez 2024', outcome: 'Time to recovery', effect: -0.28, standardError: 0.115, provenanceIds: ['trial-g'] },
  { studyId: 'TRIAL-H', label: 'Gupta 2025', outcome: 'Time to recovery', effect: 0.03, standardError: 0.240, provenanceIds: ['trial-h'] },
];

const riskOfBias: RiskOfBiasAssessment[] = estimates.map((estimate, index) => ({
  studyId: estimate.studyId,
  tool: 'RoB 2',
  overall: index === 3 ? 'high' : index === 5 || index === 7 ? 'some-concerns' : 'low',
  domains: [
    {
      domain: 'Randomization process',
      judgement: index === 3 ? 'some-concerns' : 'low',
      rationale: 'Golden fixture judgement',
    },
    {
      domain: 'Missing outcome data',
      judgement: index === 5 ? 'some-concerns' : 'low',
      rationale: 'Golden fixture judgement',
    },
    {
      domain: 'Selection of reported result',
      judgement: index === 3 ? 'high' : index === 7 ? 'some-concerns' : 'low',
      rationale: 'Golden fixture judgement',
    },
  ],
}));

const analysis = analyseInverseVariance(estimates, 'Time to recovery');
const plot = renderForestPlot(analysis, riskOfBias, {
  title: 'Baricitinib + remdesivir — time to recovery',
  outcome: 'Time to recovery',
  measureLabel: 'Standardized effect',
  favorsLeft: 'Faster recovery',
  favorsRight: 'Slower recovery',
  showRiskOfBias: true,
});

const artifactDir = resolve(process.env.FOREST_PLOT_ARTIFACT_DIR ?? 'artifacts/forest-plot');
await mkdir(artifactDir, { recursive: true });
await Promise.all([
  writeFile(resolve(artifactDir, 'forest-plot.svg'), `${plot.svg}\n`, 'utf8'),
  writeFile(resolve(artifactDir, 'forest-plot.analysis.json'), `${JSON.stringify({ rows: plot.analysisTable, summary: plot.summary, axis: plot.axis }, null, 2)}\n`, 'utf8'),
  writeFile(resolve(artifactDir, 'forest-plot.manifest.json'), `${JSON.stringify({
    id: plot.id,
    kind: plot.kind,
    version: plot.version,
    title: plot.title,
    subtitle: plot.subtitle,
    outcome: plot.outcome,
    measureLabel: plot.measureLabel,
    qa: plot.qa,
    provenance: plot.provenance,
  }, null, 2)}\n`, 'utf8'),
  writeFile(resolve(artifactDir, 'forest-plot.accessibility.txt'), `${plot.accessibilityText}\n`, 'utf8'),
]);

console.log(JSON.stringify({
  artifactDir,
  figureId: plot.id,
  contentSha256: plot.provenance.contentSha256,
  studies: plot.summary.k,
  pooledEffect: plot.summary.effect,
  confidenceInterval: [plot.summary.ciLow, plot.summary.ciHigh],
  heterogeneityI2: plot.summary.i2,
  qa: plot.qa,
}, null, 2));
