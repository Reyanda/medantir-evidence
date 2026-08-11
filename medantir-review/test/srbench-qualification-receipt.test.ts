import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySrQualificationAssetReceipt,
  createSrQualificationAssetReceipt,
  verifySrQualificationAssetReceipt,
} from '../src/benchmark/sr-qualification-receipt.js';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';

function candidate(): SrQualificationCandidateInput {
  const assets = {} as SrQualificationCandidateInput['assets'];
  for (const component of SR_QUALIFICATION_COMPONENTS) assets[component] = { status: 'available-unfrozen', basis: 'original-artifact' };
  return {
    candidateId: 'CANDIDATE-1',
    title: 'Candidate review',
    domain: 'nutrition',
    methodologicalClass: 'meta-analysis',
    publication: { doi: '10.1000/candidate', year: 2022 },
    assets,
  };
}

test('qualification receipt can upgrade analysis runtime only when immutable source, verification and exact preflight receipts are bound', () => {
  const digest = 'a'.repeat(64);
  const receipt = createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'analysis-runtime',
    basis: 'original-artifact',
    sourceIdentities: [{ kind: 'sha256-object', objectId: `HOBJ-${digest}`, sha256: digest, byteLength: 1234, mediaType: 'text/x-r-source' }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'independent-reproduction',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'verifier-2',
    verifiedAt: '2026-08-10T18:00:00Z',
    analysisPreflight: { reportHash: 'd'.repeat(64), exactReproductionReady: true },
  });
  assert.deepEqual(verifySrQualificationAssetReceipt(receipt), []);
  const updated = applySrQualificationAssetReceipt({ candidate: candidate(), receipt });
  assert.equal(updated.assets['analysis-runtime'].status, 'frozen-verified');
  assert.equal(updated.assets['analysis-runtime'].receiptHash, receipt.receiptHash);
  assert.equal(updated.assets['search-corpus'].status, 'available-unfrozen');
  assert.equal(createSrQualificationCandidate(updated).readiness, 'gold-buildable');
});

test('analysis runtime cannot be certified with missing or blocked reproduction preflight', () => {
  const common = {
    candidateId: 'CANDIDATE-1',
    component: 'analysis-runtime' as const,
    basis: 'original-artifact' as const,
    sourceIdentities: [{ kind: 'git-commit' as const, repository: 'org/repo', commit: 'a'.repeat(40) }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'independent-reproduction' as const,
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  };
  assert.throws(() => createSrQualificationAssetReceipt(common), /requires a bound reproduction preflight/i);
  assert.throws(() => createSrQualificationAssetReceipt({
    ...common,
    analysisPreflight: { reportHash: 'd'.repeat(64), exactReproductionReady: false },
  }), /not exactReproductionReady/i);
});

test('mismatched HOBJ identity fails before a qualification asset can be certified', () => {
  assert.throws(() => createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'extraction-truth',
    basis: 'original-artifact',
    sourceIdentities: [{ kind: 'sha256-object', objectId: `HOBJ-${'b'.repeat(64)}`, sha256: 'a'.repeat(64), byteLength: 1 }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  }), /objectId must equal HOBJ-<sha256>/i);
});

test('git qualification source requires full immutable commit identity', () => {
  assert.throws(() => createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'protocol',
    basis: 'original-artifact',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'abc123' }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  }), /40-character commit SHA/i);
});

test('tampering with a qualification receipt is detected', () => {
  const receipt = createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'protocol',
    basis: 'original-artifact',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'a'.repeat(40) }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  const tampered = { ...receipt, verifierId: 'different-verifier' };
  assert.ok(verifySrQualificationAssetReceipt(tampered).some((message) => /hash mismatch/i.test(message)));
});

test('source-capture provenance binding is normalized, retained and tamper-evident', () => {
  const receipt = createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'extraction-truth',
    basis: 'original-artifact',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'a'.repeat(40) }],
    sourceCaptureHashes: ['f'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'dual-human-adjudication',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  assert.deepEqual(receipt.sourceCaptureHashes, ['e'.repeat(64), 'f'.repeat(64)]);
  assert.deepEqual(verifySrQualificationAssetReceipt(receipt), []);
  const updated = applySrQualificationAssetReceipt({ candidate: candidate(), receipt });
  assert.ok(updated.assets['extraction-truth'].references?.includes(`capture:${'e'.repeat(64)}`));
  assert.ok(updated.assets['extraction-truth'].references?.includes(`capture:${'f'.repeat(64)}`));
  const tampered = { ...receipt, sourceCaptureHashes: ['d'.repeat(64)] };
  assert.ok(verifySrQualificationAssetReceipt(tampered).some((message) => /hash mismatch/i.test(message)));
});

test('published aggregate evidence cannot be converted directly into a complete qualification receipt', () => {
  assert.throws(() => createSrQualificationAssetReceipt({
    candidateId: 'CANDIDATE-1',
    component: 'tiab-truth',
    basis: 'published-aggregate',
    sourceIdentities: [{ kind: 'git-commit', repository: 'org/repo', commit: 'a'.repeat(40) }],
    componentArtifactHash: 'b'.repeat(64),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: 'c'.repeat(64),
    verifierId: 'v',
    verifiedAt: '2026-08-10T18:00:00Z',
  }), /cannot certify published aggregates/i);
});
