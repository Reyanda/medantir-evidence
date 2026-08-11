import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoricalReplayCapsule } from '../src/historical/replay-capsule.js';
import { buildHistoricalReplayCertificate } from '../src/historical/replay-certificate.js';
import { createHistoricalStudySourceManifest } from '../src/historical/study-source-manifest.js';
import { createHistoricalSourceVersionVerification } from '../src/historical/source-version-attestation.js';
import { createHistoricalScreeningDecisionLedger } from '../src/historical/screening-decision-ledger.js';
import { reconcileHistoricalScreeningAggregates } from '../src/historical/screening-aggregate-reconciliation.js';
import { createHistoricalAppraisalLedger } from '../src/historical/appraisal-ledger.js';
import { createHistoricalOutcomeRowLedger, type HistoricalOutcomeRowInput } from '../src/historical/outcome-row-ledger.js';
import {
  buildStrictHistoricalAppraisalPlane,
  buildStrictHistoricalExtractionPlane,
  buildStrictHistoricalFullTextPlane,
  buildStrictHistoricalScreeningPlane,
  buildStrictHistoricalSearchPlane,
} from '../src/historical/strict-plane-builders.js';

const objectReceipt = (character: string, recordId = 'R1') => ({
  objectId: `HOBJ-${character.repeat(64)}`,
  sha256: character.repeat(64),
  byteLength: 100,
  role: 'fulltext-source' as const,
  mediaType: 'application/pdf',
  recordId,
  accessClass: 'restricted-source' as const,
});

test('search plane is mechanically exact only when capsule integrity and exact replay certificate agree', () => {
  const capsule = createHistoricalReplayCapsule({ benchmarkId: 'b', historicalCutoff: '2021-01-01', sources: [] });
  const certificate = buildHistoricalReplayCertificate({ capsule, actualSources: [], actualCheckpoints: [] });
  const plane = buildStrictHistoricalSearchPlane({ capsule, certificate });
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'source-reconstructed');

  assert.throws(
    () => buildStrictHistoricalSearchPlane({ capsule, certificate: { ...certificate, capsuleId: 'OTHER' } }),
    /same capsule/i,
  );
});

test('full-text replay exactness and historical-version exactness are separate claims', () => {
  const sourceManifest = createHistoricalStudySourceManifest({
    historicalCutoff: '2021-06-02',
    requiredLineageIds: ['L1'],
    reports: [{
      lineageId: 'L1', reportId: 'R1', role: 'primary-results', identifiers: { doi: '10.1/r1' },
      publicationDate: '2021-01-01', availableByHistoricalCutoff: true, requiredForReproduction: true,
      resultBearing: true, sourceStatus: 'archived-exact', sourceObject: objectReceipt('a'),
    }],
  });
  const currentOnly = createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{ reportId: 'R1', status: 'current-copy-unverified', evidenceReference: 'current copy' }],
  });
  const reconstructed = buildStrictHistoricalFullTextPlane({ sourceManifest, versionVerification: currentOnly });
  assert.equal(reconstructed.replayFidelity, 'exact');
  assert.equal(reconstructed.historicalProvenance, 'source-reconstructed');

  const historicallyVerified = createHistoricalSourceVersionVerification({
    sourceManifest,
    attestations: [{
      reportId: 'R1', status: 'verified-as-of-cutoff', basis: 'trusted-archive-timestamp',
      historicalVersionDate: '2021-01-02', evidenceReference: 'archive',
    }],
  });
  const original = buildStrictHistoricalFullTextPlane({ sourceManifest, versionVerification: historicallyVerified });
  assert.equal(original.replayFidelity, 'exact');
  assert.equal(original.historicalProvenance, 'original-exact');
});

test('aggregate-matching screening replay is computationally exact but never original row-history exact', () => {
  const ledger = createHistoricalScreeningDecisionLedger({
    reviewId: 'r',
    aggregates: [{ stage: 'title-abstract', included: 1, excluded: 1, sourceReference: 'PRISMA' }],
  });
  const reconciliation = reconcileHistoricalScreeningAggregates(ledger, [
    { stage: 'title-abstract', recordId: 'a', decision: 'include' },
    { stage: 'title-abstract', recordId: 'b', decision: 'exclude' },
  ]);
  const plane = buildStrictHistoricalScreeningPlane({ ledger, aggregateReconciliation: reconciliation });
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'aggregate-only');

  const unmatched = buildStrictHistoricalScreeningPlane({ ledger });
  assert.equal(unmatched.replayFidelity, 'unverified');
  assert.equal(unmatched.historicalProvenance, 'aggregate-only');
});

test('exact publication-table appraisal remains source-reconstructed rather than original reviewer worksheet', () => {
  const sha = 'a'.repeat(64);
  const ledger = createHistoricalAppraisalLedger([{
    lineageId: 'L1', tool: 'modified-jadad-7', randomAllocation: 1, concealment: 1,
    blinding: 2, withdrawalsDropouts: 1, totalScore: 5, interpretation: 'high',
    source: {
      sourceType: 'published-table', sourceReference: 'publication', tableOrFigure: 'Table 3',
      rowLabel: 'Study 1', verbatimEvidence: '1 | 1 | 2 | 1 | 5 | high quality',
      objectId: `HOBJ-${sha}`, sha256: sha, bindingFidelity: 'structured-row', rowFragmentSha256: 'b'.repeat(64),
    },
  }], new Set(['L1']));
  const plane = buildStrictHistoricalAppraisalPlane(ledger);
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'source-reconstructed');
});

function outcomeRow(input: Partial<HistoricalOutcomeRowInput> = {}): HistoricalOutcomeRowInput {
  const sha = 'c'.repeat(64);
  return {
    lineageId: 'L1', outcome: 'mortality', contributionStatus: 'contributing',
    reconstructionStatus: 'primary-source-reconstructed', timeHorizon: '28-day', analysisPopulation: 'ITT',
    subgroupLabel: null,
    source: {
      sourceType: 'primary-report', objectId: `HOBJ-${sha}`, sha256: sha, page: 4,
      tableOrFigure: 'Results', rowLabel: 'Mortality', verbatimEvidence: '2/20 versus 4/20',
    },
    dataShape: 'binary-2x2', measure: 'RR', experimentalEvents: 2, experimentalTotal: 20,
    controlEvents: 4, controlTotal: 20,
    ...input,
  } as HistoricalOutcomeRowInput;
}

test('explicit non-contributing historical rows do not block an otherwise exact extraction plane', () => {
  const ledger = createHistoricalOutcomeRowLedger([
    outcomeRow(),
    outcomeRow({
      lineageId: 'L2', contributionStatus: 'non-contributing',
      notes: ['Source verified not to contribute to this published estimand.'],
    }),
  ], new Set(['L1', 'L2']));
  const plane = buildStrictHistoricalExtractionPlane(ledger);
  assert.equal(plane.replayFidelity, 'exact');
  assert.equal(plane.historicalProvenance, 'source-reconstructed');
});

test('unresolved rows or invalid contributing provenance block extraction exactness', () => {
  const unresolved = createHistoricalOutcomeRowLedger([
    outcomeRow({
      contributionStatus: 'unresolved', reconstructionStatus: 'unresolved', timeHorizon: null,
      experimentalEvents: null, experimentalTotal: null, controlEvents: null, controlTotal: null,
    }),
  ], new Set(['L1']));
  assert.equal(buildStrictHistoricalExtractionPlane(unresolved).replayFidelity, 'unverified');

  const badSource = outcomeRow();
  badSource.source = { ...badSource.source, objectId: `HOBJ-${'d'.repeat(64)}` };
  const invalid = createHistoricalOutcomeRowLedger([badSource], new Set(['L1']));
  assert.equal(buildStrictHistoricalExtractionPlane(invalid).replayFidelity, 'unverified');
});
