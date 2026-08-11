import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalOutcomeRowLedger } from '../src/historical/outcome-row-ledger.js';
import { replayHistoricalSynthesis } from '../src/historical/synthesis-replay.js';
import {
  buildHistoricalReportPlane,
  createHistoricalPublishedReportCore,
  reconcileHistoricalReportCore,
} from '../src/historical/report-core-reconciliation.js';

const sha = 'a'.repeat(64);
const ledger = createHistoricalOutcomeRowLedger([
  {
    lineageId: 'L1', outcome: 'mortality', contributionStatus: 'contributing', reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28-day', analysisPopulation: 'ITT', subgroupLabel: null,
    source: { sourceType: 'primary-report', objectId: `HOBJ-${sha}`, sha256: sha, page: 1, rowLabel: 'Mortality', verbatimEvidence: '2/20 vs 4/20' },
    dataShape: 'binary-2x2', measure: 'RR', experimentalEvents: 2, experimentalTotal: 20, controlEvents: 4, controlTotal: 20,
  },
], new Set(['L1']));
const synthesis = replayHistoricalSynthesis(ledger, {
  selector: { outcome: 'mortality', measure: 'RR', timeHorizon: '28-day', analysisPopulation: 'ITT', subgroupLabel: null },
  publishedTarget: {
    outcome: 'mortality', studies: 1, participants: 40, measure: 'RR', estimate: 0.5,
    ciLower: 0.101108, ciUpper: 2.472606, i2: 0, model: 'random effects',
  },
});

const target = createHistoricalPublishedReportCore({
  reviewId: 'PMC1',
  includedLineageIds: ['L1'],
  flow: { identified: 10, included: 1 },
  resultTargets: [{
    outcome: 'mortality', studies: 1, participants: 40, measure: 'RR', estimate: 0.5,
    ciLower: 0.101108, ciUpper: 2.472606, i2: 0, model: 'random effects',
  }],
  appraisalLedgerHash: 'b'.repeat(64),
  publicationObjectSha256: 'c'.repeat(64),
});

test('historical report core reconciles included lineages, flow, pooled results and appraisal identity', () => {
  const reconciliation = reconcileHistoricalReportCore({
    target,
    reproduced: {
      reviewId: 'PMC1', includedLineageIds: ['L1'], flow: { identified: 10, included: 1 },
      synthesisReceipts: [synthesis], appraisalLedgerHash: 'b'.repeat(64),
    },
  });
  assert.equal(reconciliation.coreExact, true);
  assert.deepEqual(reconciliation.differences, []);
  assert.match(reconciliation.reconciliationHash, /^[a-f0-9]{64}$/);
  const plane = buildHistoricalReportPlane({ reconciliation });
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'source-reconstructed');
});

test('report-core reconciliation localizes lineage, flow, result and appraisal drift', () => {
  const reconciliation = reconcileHistoricalReportCore({
    target,
    reproduced: {
      reviewId: 'OTHER',
      includedLineageIds: ['L2'],
      flow: { identified: 11 },
      synthesisReceipts: [],
      appraisalLedgerHash: 'd'.repeat(64),
    },
  });
  assert.equal(reconciliation.coreExact, false);
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'review-id'));
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'missing-lineage'));
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'unexpected-lineage'));
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'flow'));
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'missing-result'));
  assert.ok(reconciliation.differences.some((difference) => difference.kind === 'appraisal-ledger'));
  assert.equal(buildHistoricalReportPlane({ reconciliation }).replayFidelity, 'unverified');
});

test('scientifically exact report structure is not called original-exact unless publication-version identity is separately verified', () => {
  const reconciliation = reconcileHistoricalReportCore({
    target,
    reproduced: {
      reviewId: 'PMC1', includedLineageIds: ['L1'], flow: { identified: 10, included: 1 },
      synthesisReceipts: [synthesis], appraisalLedgerHash: 'b'.repeat(64),
    },
  });
  assert.equal(buildHistoricalReportPlane({ reconciliation, originalPublicationVersionVerified: false }).historicalProvenance, 'source-reconstructed');
  assert.equal(buildHistoricalReportPlane({ reconciliation, originalPublicationVersionVerified: true }).historicalProvenance, 'original-exact');
});

test('published report contract rejects duplicate outcomes and invalid flow counts', () => {
  assert.throws(() => createHistoricalPublishedReportCore({
    reviewId: 'r', includedLineageIds: [], flow: { included: -1 }, resultTargets: [],
  }), /flow.*non-negative integer/i);
  assert.throws(() => createHistoricalPublishedReportCore({
    reviewId: 'r', includedLineageIds: [], flow: {},
    resultTargets: [
      { outcome: 'mortality', measure: 'RR', estimate: 1, ciLower: 0.5, ciUpper: 2 },
      { outcome: 'Mortality', measure: 'RR', estimate: 1, ciLower: 0.5, ciUpper: 2 },
    ],
  }), /duplicates published result outcome/i);
});
