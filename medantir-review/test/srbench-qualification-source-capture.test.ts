import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  applySrQualificationSourceCapture,
  createSrQualificationAssetReceiptFromCapture,
  createSrQualificationAssetReceiptFromCaptures,
  createSrQualificationSourceCapture,
  verifySrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from '../src/benchmark/sr-qualification-source-capture.js';

interface CorpusFile {
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}
interface CaptureSetFile {
  captures: Array<Omit<SrQualificationSourceCapture, 'schemaVersion' | 'captureHash'>>;
}

test('immutable source capture upgrades only to frozen-unverified, never verified', async () => {
  const corpusRaw = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/qualification-candidates.json'), 'utf8')) as CorpusFile;
  const captureRaw = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/qualification-source-captures.json'), 'utf8')) as CaptureSetFile;
  const rat = structuredClone(corpusRaw.candidates.find((candidate) => candidate.candidateId === 'SRQ-COVID-RAT-2024')!);
  const captures = captureRaw.captures.map(createSrQualificationSourceCapture);
  for (const capture of captures) {
    assert.deepEqual(verifySrQualificationSourceCapture(capture), []);
    Object.assign(rat, applySrQualificationSourceCapture({ candidate: rat, capture }));
  }
  assert.equal(rat.assets['extraction-truth'].status, 'frozen-unverified');
  assert.equal(rat.assets['analysis-runtime'].status, 'frozen-unverified');
  assert.equal(rat.assets['extraction-truth'].receiptHash, undefined);
  assert.equal(rat.assets['analysis-runtime'].receiptHash, undefined);
  const corpus = createSrQualificationCorpus({ corpusId: corpusRaw.corpusId, corpusVersion: corpusRaw.corpusVersion, candidates: [rat] });
  assert.equal(corpus.candidates[0]!.promotionEligible, false);
  assert.notEqual(corpus.candidates[0]!.readiness, 'validation-ready');
});

test('capture tampering and moving/truncated revision identities fail closed', () => {
  const capture = createSrQualificationSourceCapture({
    candidateId: 'C1',
    component: 'analysis-runtime',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'a'.repeat(40) }],
    selectedPaths: ['analysis.R'],
    capturedAt: '2026-08-10T18:30:00Z',
    captureMethod: 'git-revision-pin',
  });
  assert.ok(verifySrQualificationSourceCapture({ ...capture, selectedPaths: ['different.R'] }).some((message) => /hash mismatch/i.test(message)));
  assert.throws(() => createSrQualificationSourceCapture({
    candidateId: 'C1',
    component: 'analysis-runtime',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'main' }],
    capturedAt: '2026-08-10T18:30:00Z',
    captureMethod: 'git-revision-pin',
  }), /40-character Git commit SHA/i);
});

test('receipt minting requires an explicit benchmark-gold declaration', () => {
  const capture = createSrQualificationSourceCapture({
    candidateId: 'C1',
    component: 'protocol',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'a'.repeat(40) }],
    capturedAt: '2026-08-10T18:30:00Z',
    captureMethod: 'git-revision-pin',
  });
  assert.throws(() => createSrQualificationAssetReceiptFromCapture({
    capture,
    basis: 'source-reconstructed',
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'verifier-a',
    verifiedAt: '2026-08-10T18:40:00Z',
  }), /explicitly benchmark-gold/i);
  assert.throws(() => applySrQualificationSourceCapture({
    candidate: {
      candidateId: 'C1',
      title: 'Candidate',
      domain: 'test',
      methodologicalClass: 'test',
      publication: { year: 2024 },
      assets: Object.fromEntries([
        'protocol', 'search-strategy', 'search-corpus', 'dedup-truth', 'tiab-truth', 'fulltext-truth',
        'included-report-corpus', 'extraction-truth', 'appraisal-truth', 'analysis-runtime', 'synthesis-targets', 'report-source',
      ].map((component) => [component, { status: 'available-unfrozen', basis: 'source-reconstructed' }])) as SrQualificationCandidateInput['assets'],
    },
    capture,
  }), /explicitly benchmark-gold/i);
});

test('provenance role and qualification use are hash-bound and supporting-only evidence cannot promote gold', async () => {
  const corpusRaw = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/qualification-candidates.json'), 'utf8')) as CorpusFile;
  const hamilton = structuredClone(corpusRaw.candidates.find((candidate) => candidate.candidateId === 'SRQ-HAMILTON-SHARING-2023')!);
  const sha256 = 'b'.repeat(64);
  const sourceIdentities = [{
    kind: 'sha256-object' as const,
    objectId: `HOBJ-${sha256}`,
    sha256,
    byteLength: 1234,
    mediaType: 'application/zip',
  }];
  const common = {
    candidateId: hamilton.candidateId,
    component: 'extraction-truth' as const,
    sourceIdentities,
    capturedAt: '2026-08-10T21:15:00Z',
    captureMethod: 'content-addressed-archive' as const,
  };
  const restricted = createSrQualificationSourceCapture({
    ...common,
    sourceRole: 'restricted-supporting-data',
    qualificationUse: 'supporting-evidence-only',
  });
  const reproducibilityDeposit = createSrQualificationSourceCapture({
    ...common,
    sourceRole: 'results-code',
    qualificationUse: 'benchmark-gold',
  });

  assert.deepEqual(verifySrQualificationSourceCapture(restricted), []);
  assert.deepEqual(verifySrQualificationSourceCapture(reproducibilityDeposit), []);
  assert.notEqual(restricted.captureHash, reproducibilityDeposit.captureHash);
  assert.throws(
    () => applySrQualificationSourceCapture({ candidate: hamilton, capture: restricted }),
    /explicitly benchmark-gold/i,
  );
  assert.throws(() => createSrQualificationAssetReceiptFromCapture({
    capture: restricted,
    basis: 'original-artifact',
    componentArtifactHash: 'c'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'd'.repeat(64),
    verifierId: 'verifier-a',
    verifiedAt: '2026-08-10T21:20:00Z',
  }), /explicitly benchmark-gold/i);
  assert.equal(hamilton.assets['extraction-truth'].status, 'available-unfrozen');

  const upgraded = applySrQualificationSourceCapture({ candidate: hamilton, capture: reproducibilityDeposit });
  assert.equal(upgraded.assets['extraction-truth'].status, 'frozen-unverified');
  assert.ok(upgraded.assets['extraction-truth'].notes?.includes('Captured source role: results-code.'));

  const receipt = createSrQualificationAssetReceiptFromCapture({
    capture: reproducibilityDeposit,
    basis: 'original-artifact',
    componentArtifactHash: 'c'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'd'.repeat(64),
    verifierId: 'verifier-a',
    verifiedAt: '2026-08-10T21:20:00Z',
  });
  assert.deepEqual(receipt.sourceCaptureHashes, [reproducibilityDeposit.captureHash]);
  assert.deepEqual(receipt.sourceIdentities, reproducibilityDeposit.sourceIdentities);
});

test('multi-capture receipt canonically binds every immutable source for one candidate/component', () => {
  const captureA = createSrQualificationSourceCapture({
    candidateId: 'C-MULTI',
    component: 'extraction-truth',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo-a', commit: 'a'.repeat(40) }],
    selectedPaths: ['data.csv'],
    sourceRole: 'review-materials',
    qualificationUse: 'benchmark-gold',
    capturedAt: '2026-08-10T19:00:00Z',
    captureMethod: 'git-revision-pin',
  });
  const sha256 = 'b'.repeat(64);
  const captureB = createSrQualificationSourceCapture({
    candidateId: 'C-MULTI',
    component: 'extraction-truth',
    sourceIdentities: [{ kind: 'sha256-object', objectId: `HOBJ-${sha256}`, sha256, byteLength: 42, mediaType: 'text/csv' }],
    selectedPaths: ['supplement.csv?revision=3'],
    sourceRole: 'review-materials',
    qualificationUse: 'benchmark-gold',
    capturedAt: '2026-08-10T19:01:00Z',
    captureMethod: 'content-addressed-archive',
  });
  const receipt = createSrQualificationAssetReceiptFromCaptures({
    captures: [captureB, captureA, captureA],
    basis: 'source-reconstructed',
    componentArtifactHash: 'c'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'd'.repeat(64),
    verifierId: 'verifier-multi',
    verifiedAt: '2026-08-10T19:15:00Z',
  });
  assert.deepEqual(receipt.sourceCaptureHashes, [captureA.captureHash, captureB.captureHash].sort());
  assert.equal(receipt.sourceIdentities.length, 2);
  assert.ok(receipt.sourceIdentities.some((identity) => identity.kind === 'git-commit'));
  assert.ok(receipt.sourceIdentities.some((identity) => identity.kind === 'sha256-object'));

  const otherComponent = createSrQualificationSourceCapture({
    ...captureA,
    component: 'appraisal-truth',
    capturedAt: '2026-08-10T19:02:00Z',
  });
  assert.throws(() => createSrQualificationAssetReceiptFromCaptures({
    captures: [captureA, otherComponent],
    basis: 'source-reconstructed',
    componentArtifactHash: 'c'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'd'.repeat(64),
    verifierId: 'verifier-multi',
    verifiedAt: '2026-08-10T19:15:00Z',
  }), /same candidate and component/i);
});
