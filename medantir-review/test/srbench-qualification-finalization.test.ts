import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
  type SrQualificationCandidateVerificationReceipt,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  applySrQualificationAssetReceipt,
  createSrQualificationAssetReceipt,
  type SrQualificationAssetReceipt,
} from '../src/benchmark/sr-qualification-receipt.js';
import {
  applySrQualificationSourceCapture,
  createSrQualificationAssetReceiptFromCapture,
  createSrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from '../src/benchmark/sr-qualification-source-capture.js';
import {
  createSrQualificationFinalization,
  defaultSrQualificationPromotionPolicy,
  evaluateSrQualificationPromotionGate,
} from '../src/benchmark/sr-qualification-finalization.js';

interface BuiltPackage {
  candidate: SrQualificationCandidateInput;
  captures: SrQualificationSourceCapture[];
  receipts: SrQualificationAssetReceipt[];
  verification: SrQualificationCandidateVerificationReceipt;
}

function digest(seed: number): string {
  return seed.toString(16).padStart(64, '0').slice(-64);
}

function sourceCommit(seed: number): string {
  return seed.toString(16).padStart(40, '0').slice(-40);
}

function baseCandidate(candidateId: string, domain: string, methodologicalClass: string, seed: number): SrQualificationCandidateInput {
  const assets = {} as SrQualificationCandidateInput['assets'];
  for (const component of SR_QUALIFICATION_COMPONENTS) {
    assets[component] = { status: 'available-unfrozen', basis: 'source-reconstructed' };
  }
  return {
    candidateId,
    title: `Qualification package ${candidateId}`,
    domain,
    methodologicalClass,
    publication: { doi: `10.1000/${candidateId.toLowerCase()}`, pmid: String(100000 + seed), year: 2024 },
    assets,
  };
}

function completePackage(candidateId: string, domain: string, methodologicalClass: string, seed: number): BuiltPackage {
  const candidate = baseCandidate(candidateId, domain, methodologicalClass, seed);
  const captures: SrQualificationSourceCapture[] = [];
  const receipts: SrQualificationAssetReceipt[] = [];
  let current = structuredClone(candidate);

  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    const capture = createSrQualificationSourceCapture({
      candidateId,
      component,
      sourceIdentities: [{
        kind: 'git-commit',
        repository: `fixture/${candidateId.toLowerCase()}`,
        commit: sourceCommit(seed * 100 + index + 1),
      }],
      selectedPaths: [`${component}.json`],
      sourceRole: component === 'analysis-runtime' ? 'results-code' : 'review-materials',
      qualificationUse: 'benchmark-gold',
      capturedAt: '2026-08-11T12:00:00Z',
      captureMethod: 'git-revision-pin',
    });
    const receipt = createSrQualificationAssetReceiptFromCapture({
      capture,
      basis: 'source-reconstructed',
      componentArtifactHash: digest(seed * 1000 + index + 1),
      verificationMethod: 'deterministic-contract-validation',
      verificationReceiptHash: digest(seed * 1000 + index + 101),
      verifierId: `component-verifier-${seed}`,
      verifiedAt: '2026-08-11T12:30:00Z',
      ...(component === 'analysis-runtime'
        ? { analysisPreflight: { reportHash: digest(seed * 1000 + 999), exactReproductionReady: true } }
        : {}),
    });
    captures.push(capture);
    receipts.push(receipt);
    current = applySrQualificationSourceCapture({ candidate: current, capture });
    current = applySrQualificationAssetReceipt({ candidate: current, receipt });
  });

  const complete = createSrQualificationCandidate(current);
  assert.equal(complete.completeComponents, SR_QUALIFICATION_COMPONENTS.length);
  assert.equal(complete.readiness, 'gold-buildable');
  const verification = createSrQualificationCandidateVerificationReceipt({
    candidate: complete,
    verificationBasis: 'independent-reproduction',
    verifierId: `candidate-verifier-${seed}`,
    verifiedAt: '2026-08-11T13:00:00Z',
  });
  return { candidate, captures, receipts, verification };
}

function finalize(packages: BuiltPackage[]) {
  return createSrQualificationFinalization({
    corpusId: 'TEST-QUALIFICATION',
    corpusVersion: '1',
    candidates: packages.map((item) => item.candidate),
    sourceCaptures: packages.flatMap((item) => item.captures),
    assetReceipts: packages.flatMap((item) => item.receipts),
    candidateVerifications: packages.map((item) => item.verification),
  });
}

test('three independently verified review packages across three domains pass the qualification promotion gate', () => {
  const result = finalize([
    completePackage('QUAL-A', 'nutrition', 'intervention-meta-analysis', 1),
    completePackage('QUAL-B', 'meta-research', 'systematic-review-ipd-meta-analysis', 2),
    completePackage('QUAL-C', 'diagnostics', 'diagnostic-accuracy-meta-analysis', 3),
  ]);
  assert.equal(result.corpus.validationReadyCandidates.length, 3);
  assert.deepEqual(result.corpus.validationReadyDomains, ['diagnostics', 'meta-research', 'nutrition']);
  assert.equal(result.promotionGate.passed, true);
  assert.ok(result.promotionGate.checks.every((check) => check.passed));
  assert.match(result.finalizationHash, /^[a-f0-9]{64}$/);
});

test('three complete reviews from only two scientific domains remain blocked', () => {
  const result = finalize([
    completePackage('QUAL-A', 'nutrition', 'intervention-meta-analysis', 11),
    completePackage('QUAL-B', 'meta-research', 'systematic-review-ipd-meta-analysis', 12),
    completePackage('QUAL-C', 'nutrition', 'diagnostic-accuracy-meta-analysis', 13),
  ]);
  assert.equal(result.corpus.validationReadyCandidates.length, 3);
  assert.equal(result.promotionGate.passed, false);
  const domainCheck = result.promotionGate.checks.find((check) => check.code === 'distinct-scientific-domains');
  assert.equal(domainCheck?.observed, 2);
  assert.equal(domainCheck?.required, 3);
  assert.equal(domainCheck?.passed, false);
});

test('receipt cannot borrow a capture from another candidate or component', () => {
  const a = baseCandidate('QUAL-A', 'nutrition', 'intervention-meta-analysis', 21);
  const b = baseCandidate('QUAL-B', 'meta-research', 'systematic-review-ipd-meta-analysis', 22);
  const capture = createSrQualificationSourceCapture({
    candidateId: 'QUAL-A',
    component: 'protocol',
    sourceIdentities: [{ kind: 'git-commit', repository: 'fixture/a', commit: sourceCommit(21) }],
    qualificationUse: 'benchmark-gold',
    sourceRole: 'preregistration',
    capturedAt: '2026-08-11T12:00:00Z',
    captureMethod: 'git-revision-pin',
  });
  const receipt = createSrQualificationAssetReceipt({
    candidateId: 'QUAL-B',
    component: 'protocol',
    basis: 'source-reconstructed',
    sourceIdentities: capture.sourceIdentities,
    sourceCaptureHashes: [capture.captureHash],
    componentArtifactHash: digest(211),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: digest(212),
    verifierId: 'v',
    verifiedAt: '2026-08-11T12:30:00Z',
  });
  assert.throws(() => createSrQualificationFinalization({
    corpusId: 'TEST', corpusVersion: '1', candidates: [a, b], sourceCaptures: [capture], assetReceipts: [receipt], candidateVerifications: [],
    promotionPolicy: { ...defaultSrQualificationPromotionPolicy(), minimumValidationReadyCandidates: 1, minimumDistinctDomains: 1 },
  }), /cross-bound.*another candidate\/component/i);
});

test('receipt source identity set must exactly equal its bound capture identity set', () => {
  const candidate = baseCandidate('QUAL-A', 'nutrition', 'intervention-meta-analysis', 31);
  const capture = createSrQualificationSourceCapture({
    candidateId: 'QUAL-A',
    component: 'protocol',
    sourceIdentities: [{ kind: 'git-commit', repository: 'fixture/a', commit: sourceCommit(31) }],
    qualificationUse: 'benchmark-gold',
    sourceRole: 'preregistration',
    capturedAt: '2026-08-11T12:00:00Z',
    captureMethod: 'git-revision-pin',
  });
  const receipt = createSrQualificationAssetReceipt({
    candidateId: 'QUAL-A',
    component: 'protocol',
    basis: 'source-reconstructed',
    sourceIdentities: [{ kind: 'git-commit', repository: 'fixture/other', commit: sourceCommit(32) }],
    sourceCaptureHashes: [capture.captureHash],
    componentArtifactHash: digest(311),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: digest(312),
    verifierId: 'v',
    verifiedAt: '2026-08-11T12:30:00Z',
  });
  assert.throws(() => createSrQualificationFinalization({
    corpusId: 'TEST', corpusVersion: '1', candidates: [candidate], sourceCaptures: [capture], assetReceipts: [receipt], candidateVerifications: [],
    promotionPolicy: { ...defaultSrQualificationPromotionPolicy(), minimumValidationReadyCandidates: 1, minimumDistinctDomains: 1 },
  }), /source identities do not exactly match/i);
});

test('duplicate component receipts are rejected rather than silently choosing one', () => {
  const packageA = completePackage('QUAL-A', 'nutrition', 'intervention-meta-analysis', 41);
  const protocol = packageA.receipts.find((receipt) => receipt.component === 'protocol');
  assert.ok(protocol);
  assert.throws(() => createSrQualificationFinalization({
    corpusId: 'TEST',
    corpusVersion: '1',
    candidates: [packageA.candidate],
    sourceCaptures: packageA.captures,
    assetReceipts: [...packageA.receipts, protocol!],
    candidateVerifications: [packageA.verification],
    promotionPolicy: { ...defaultSrQualificationPromotionPolicy(), minimumValidationReadyCandidates: 1, minimumDistinctDomains: 1 },
  }), /more than one asset receipt/i);
});

test('candidate-wide verification becomes stale if any component receipt is replaced', () => {
  const packageA = completePackage('QUAL-A', 'nutrition', 'intervention-meta-analysis', 51);
  const protocolCapture = packageA.captures.find((capture) => capture.component === 'protocol');
  assert.ok(protocolCapture);
  const replacement = createSrQualificationAssetReceiptFromCapture({
    capture: protocolCapture!,
    basis: 'source-reconstructed',
    componentArtifactHash: digest(51001),
    verificationMethod: 'deterministic-contract-validation',
    verificationReceiptHash: digest(51999),
    verifierId: 'replacement-component-verifier',
    verifiedAt: '2026-08-11T13:05:00Z',
  });
  const receipts = packageA.receipts.map((receipt) => receipt.component === 'protocol' ? replacement : receipt);
  assert.throws(() => createSrQualificationFinalization({
    corpusId: 'TEST',
    corpusVersion: '1',
    candidates: [packageA.candidate],
    sourceCaptures: packageA.captures,
    assetReceipts: receipts,
    candidateVerifications: [packageA.verification],
    promotionPolicy: { ...defaultSrQualificationPromotionPolicy(), minimumValidationReadyCandidates: 1, minimumDistinctDomains: 1 },
  }), /target hash does not match.*pre-verification candidate state|component receipt set does not match/i);
});

test('checked-in qualification corpus remains explicitly blocked until genuine gold packages are independently verified', async () => {
  const raw = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/qualification-candidates.json'), 'utf8')) as {
    corpusId: string;
    corpusVersion: string;
    candidates: SrQualificationCandidateInput[];
  };
  const corpus = createSrQualificationCorpus(raw);
  const gate = evaluateSrQualificationPromotionGate(corpus);
  assert.equal(corpus.validationReadyCandidates.length, 0);
  assert.equal(gate.passed, false);
  assert.equal(gate.checks.find((check) => check.code === 'validation-ready-candidates')?.observed, 0);
});
