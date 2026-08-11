import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalForestCandidateLedger, reconcileHistoricalForestCandidate } from '../src/historical/forest-row-candidate.js';
import { createHistoricalOutcomeRowLedger } from '../src/historical/outcome-row-ledger.js';
import { createHistoricalOutcomeReconciliationQueue } from '../src/historical/outcome-reconciliation-queue.js';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';

const lineage = 'JAKCOVID-001';
const allowed = new Set([lineage]);
const figureSha = 'a'.repeat(64);
const primarySha = 'b'.repeat(64);

function candidateLedger() {
  return createHistoricalForestCandidateLedger({
    allowedLineageIds: allowed,
    candidates: [{
      lineageId: lineage,
      outcome: 'mortality',
      measure: 'RR',
      estimate: 2,
      ciLower: 1,
      ciUpper: 3,
      timeHorizon: '28 days',
      source: {
        objectId: `HOBJ-${figureSha}`,
        sha256: figureSha,
        publicationId: 'PMC8500309',
        figure: 'Figure 2',
        panel: 'mortality',
        rowLabel: 'Bronte 2020',
        verbatimEvidence: 'Bronte 2020 RR 2.00 [1.00, 3.00]',
        extractionMethod: 'manual-transcription',
      },
    }],
  });
}

function primaryLedger() {
  return createHistoricalOutcomeRowLedger([{
    lineageId: lineage,
    outcome: 'mortality',
    contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed',
    timeHorizon: '28 days',
    analysisPopulation: 'ITT',
    subgroupLabel: null,
    dataShape: 'binary-2x2',
    measure: 'RR',
    experimentalEvents: 4,
    experimentalTotal: 10,
    controlEvents: 2,
    controlTotal: 10,
    source: {
      sourceType: 'primary-report',
      objectId: `HOBJ-${primarySha}`,
      sha256: primarySha,
      page: 5,
      tableOrFigure: 'Table 2',
      rowLabel: '28-day mortality',
      verbatimEvidence: 'Mortality at day 28: 4/10 versus 2/10.',
    },
  }], allowed);
}

function sourceManifest(status: 'archived-exact' | 'identified-unarchived') {
  return createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: allowed,
    reports: [{
      lineageId: lineage,
      reportId: `${lineage}:primary-results`,
      role: 'primary-results',
      title: 'Primary report',
      identifiers: { doi: '10.1000/example' },
      publicationDate: '2020-06-01',
      availableByHistoricalCutoff: true,
      requiredForReproduction: true,
      resultBearing: true,
      sourceStatus: status,
      ...(status === 'archived-exact' ? {
        sourceObject: {
          objectId: `HOBJ-${primarySha}`,
          sha256: primarySha,
          byteLength: 100,
          role: 'fulltext-source',
          mediaType: 'application/pdf',
          accessClass: 'restricted-source',
        },
      } : {}),
    }],
  });
}

test('candidate coverage mismatch blocks extraction and synthesis even before source reconciliation', () => {
  const queue = createHistoricalOutcomeReconciliationQueue({
    candidateLedger: candidateLedger(),
    primaryLedger: createHistoricalOutcomeRowLedger([], allowed),
    sourceManifest: sourceManifest('identified-unarchived'),
    expectedStudyRowsByOutcome: { mortality: 2 },
  });
  assert.equal(queue.expectedCandidateRows, 2);
  assert.equal(queue.observedCandidateRows, 1);
  assert.equal(queue.missingCandidateRows, 1);
  assert.equal(queue.excessCandidateRows, 0);
  assert.equal(queue.candidateCoverageComplete, false);
  assert.equal(queue.extractionBlocked, true);
  assert.equal(queue.synthesisBlocked, true);
  assert.equal(queue.workItems[0]!.status, 'blocked-source-unarchived');
});

test('an exact source plus poolable primary row becomes ready, but not reconciled automatically', () => {
  const queue = createHistoricalOutcomeReconciliationQueue({
    candidateLedger: candidateLedger(),
    primaryLedger: primaryLedger(),
    sourceManifest: sourceManifest('archived-exact'),
    expectedStudyRowsByOutcome: { mortality: 1 },
  });
  assert.equal(queue.expectedCandidateRows, 1);
  assert.equal(queue.observedCandidateRows, 1);
  assert.equal(queue.missingCandidateRows, 0);
  assert.equal(queue.candidateCoverageComplete, true);
  assert.equal(queue.workItems[0]!.status, 'ready-for-reconciliation');
  assert.equal(queue.readyWorkItems, 1);
  assert.equal(queue.extractionBlocked, true);
  assert.equal(queue.synthesisBlocked, true);
});

test('only an authoritative primary-row reconciliation clears the queue', () => {
  const candidates = candidateLedger();
  const primary = primaryLedger();
  const receipt = reconcileHistoricalForestCandidate({
    candidate: candidates.candidates[0]!,
    primaryRow: primary.rows[0]!,
    absoluteTolerance: 0,
  });
  assert.equal(receipt.reconciled, true);

  const queue = createHistoricalOutcomeReconciliationQueue({
    candidateLedger: candidates,
    primaryLedger: primary,
    sourceManifest: sourceManifest('archived-exact'),
    reconciliations: [receipt],
    expectedStudyRowsByOutcome: { mortality: 1 },
  });
  assert.equal(queue.workItems[0]!.status, 'reconciled');
  assert.equal(queue.reconciledWorkItems, 1);
  assert.equal(queue.extractionBlocked, false);
  assert.equal(queue.synthesisBlocked, false);
});
