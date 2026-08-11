import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistoricalOutcomeRow,
  isHistoricalOutcomeRowPoolable,
} from '../src/historical/outcome-row-ledger.js';
import {
  createHistoricalForestCandidateLedger,
  reconcileHistoricalForestCandidate,
} from '../src/historical/forest-row-candidate.js';

const lineageIds = new Set(['JAKCOVID-007']);
const sha = 'a'.repeat(64);
const objectId = `HOBJ-${sha}`;

test('published forest rows are permanently non-authoritative and cannot directly create a contributing outcome row', () => {
  const ledger = createHistoricalForestCandidateLedger({
    allowedLineageIds: lineageIds,
    candidates: [{
      lineageId: 'JAKCOVID-007',
      outcome: 'mortality',
      measure: 'RR',
      estimate: 0.75,
      ciLower: 0.55,
      ciUpper: 0.99,
      timeHorizon: '28-day',
      source: {
        objectId,
        sha256: sha,
        publicationId: 'PMC8500309',
        figure: 'Figure 2',
        panel: 'd',
        rowLabel: 'Kalil AC 2021',
        verbatimEvidence: 'Kalil AC 2021 | RR 0.75 [0.55, 0.99]',
        extractionMethod: 'manual-transcription',
      },
    }],
  });
  assert.equal(ledger.authoritativeRows, 0);
  assert.equal(ledger.candidates[0]!.authoritativeForSynthesis, false);

  assert.throws(() => createHistoricalOutcomeRow({
    lineageId: 'JAKCOVID-007',
    outcome: 'mortality',
    contributionStatus: 'contributing',
    reconstructionStatus: 'published-forest-row',
    timeHorizon: '28-day',
    analysisPopulation: 'ITT',
    subgroupLabel: null,
    dataShape: 'binary-2x2',
    measure: 'RR',
    experimentalEvents: 30,
    experimentalTotal: 100,
    controlEvents: 40,
    controlTotal: 100,
    source: {
      sourceType: 'published-forest-plot',
      objectId,
      sha256: sha,
      tableOrFigure: 'Figure 2(d)',
      rowLabel: 'Kalil AC 2021',
      verbatimEvidence: '30/100 versus 40/100',
    },
  }, lineageIds), /cannot be authorized by the published meta-analysis forest plot/i);
});

test('forest candidate reconciles only after an independently poolable primary-source row matches its effect estimate', () => {
  const candidate = createHistoricalForestCandidateLedger({
    allowedLineageIds: lineageIds,
    candidates: [{
      lineageId: 'JAKCOVID-007', outcome: 'mortality', measure: 'RR', estimate: 0.75,
      ciLower: 0.55, ciUpper: 0.99, timeHorizon: '28-day',
      source: {
        objectId, sha256: sha, publicationId: 'PMC8500309', figure: 'Figure 2', panel: 'd',
        rowLabel: 'Kalil AC 2021', verbatimEvidence: 'Kalil AC 2021 | RR 0.75 [0.55, 0.99]',
        extractionMethod: 'manual-transcription',
      },
    }],
  }).candidates[0]!;

  const primarySha = 'b'.repeat(64);
  const primary = createHistoricalOutcomeRow({
    lineageId: 'JAKCOVID-007',
    outcome: 'mortality',
    contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28-day',
    analysisPopulation: 'ITT',
    subgroupLabel: null,
    dataShape: 'binary-2x2',
    measure: 'RR',
    experimentalEvents: 30,
    experimentalTotal: 100,
    controlEvents: 40,
    controlTotal: 100,
    source: {
      sourceType: 'primary-report',
      objectId: `HOBJ-${primarySha}`,
      sha256: primarySha,
      tableOrFigure: 'Table 2',
      rowLabel: '28-day mortality',
      verbatimEvidence: 'Treatment: 30/100; control: 40/100 at day 28.',
    },
  }, lineageIds);
  assert.equal(isHistoricalOutcomeRowPoolable(primary), true);
  const reconciliation = reconcileHistoricalForestCandidate({ candidate, primaryRow: primary, absoluteTolerance: 0.001 });
  assert.equal(reconciliation.primaryEstimate, 0.75);
  assert.equal(reconciliation.estimateMatches, true);
  assert.equal(reconciliation.primarySourceAuthoritative, true);
  assert.equal(reconciliation.reconciled, true);
});

test('matching forest estimate does not authorize an otherwise non-poolable primary row', () => {
  const candidate = createHistoricalForestCandidateLedger({
    allowedLineageIds: lineageIds,
    candidates: [{
      lineageId: 'JAKCOVID-007', outcome: 'mortality', measure: 'RR', estimate: 0.75,
      ciLower: 0.55, ciUpper: 0.99, timeHorizon: '28-day',
      source: {
        objectId, sha256: sha, publicationId: 'PMC8500309', figure: 'Figure 2', panel: 'd',
        rowLabel: 'Kalil AC 2021', verbatimEvidence: 'Kalil AC 2021 | RR 0.75 [0.55, 0.99]',
        extractionMethod: 'manual-transcription',
      },
    }],
  }).candidates[0]!;
  const primarySha = 'c'.repeat(64);
  const nonContributing = createHistoricalOutcomeRow({
    lineageId: 'JAKCOVID-007', outcome: 'mortality', contributionStatus: 'non-contributing',
    reconstructionStatus: 'primary-source-reconstructed', timeHorizon: '28-day', analysisPopulation: 'ITT', subgroupLabel: null,
    dataShape: 'binary-2x2', measure: 'RR', experimentalEvents: 30, experimentalTotal: 100, controlEvents: 40, controlTotal: 100,
    source: { sourceType: 'primary-report', objectId: `HOBJ-${primarySha}`, sha256: primarySha, tableOrFigure: 'Table 2', rowLabel: 'mortality', verbatimEvidence: '30/100 versus 40/100' },
  }, lineageIds);
  const reconciliation = reconcileHistoricalForestCandidate({ candidate, primaryRow: nonContributing, absoluteTolerance: 0.001 });
  assert.equal(reconciliation.estimateMatches, true);
  assert.equal(reconciliation.primarySourceAuthoritative, false);
  assert.equal(reconciliation.reconciled, false);
});
