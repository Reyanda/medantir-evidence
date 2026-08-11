import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  loadSrBenchmarkSuite,
  qualificationPromotionAdmittedCaseIds,
} from '../src/benchmark/sr-benchmark-suite.js';
import { createSrQualificationAdmissions } from '../src/benchmark/sr-qualification-admission.js';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import type { SrBenchmarkCase } from '../src/benchmark/sr-reproduction-benchmark.js';

function verifiedCandidate(doi = '10.1000/qualified'): SrQualificationCandidateInput {
  const assets = {} as SrQualificationCandidateInput['assets'];
  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    assets[component] = {
      status: 'frozen-verified',
      basis: 'source-reconstructed',
      receiptHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
    };
  });
  const base: SrQualificationCandidateInput = {
    candidateId: 'QUALIFIED-1',
    title: 'Qualified published review',
    domain: 'nutrition',
    methodologicalClass: 'intervention-meta-analysis',
    publication: { doi, pmid: '12345', year: 2022 },
    assets,
  };
  const goldBuildable = createSrQualificationCandidate(base);
  const independentVerification = createSrQualificationCandidateVerificationReceipt({
    candidate: goldBuildable,
    verificationBasis: 'independent-reproduction',
    verifierId: 'independent-verifier',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  return { ...base, independentVerification };
}

function publishedCase(doi = '10.1000/qualified'): SrBenchmarkCase {
  const stageGold = {
    question: { status: 'complete', receiptHash: '1'.repeat(64) },
    protocol: { status: 'complete', receiptHash: '2'.repeat(64) },
    search: { status: 'complete', receiptHash: '3'.repeat(64) },
    deduplication: { status: 'complete', receiptHash: '4'.repeat(64) },
    'tiab-screening': { status: 'complete', receiptHash: '5'.repeat(64) },
    'fulltext-screening': { status: 'complete', receiptHash: '6'.repeat(64) },
    extraction: { status: 'complete', receiptHash: '7'.repeat(64) },
    appraisal: { status: 'complete', receiptHash: '8'.repeat(64) },
    synthesis: { status: 'complete', receiptHash: '9'.repeat(64) },
    report: { status: 'complete', receiptHash: 'a'.repeat(64) },
  } as SrBenchmarkCase['stageGold'];
  return {
    schemaVersion: 'medantir-srbench/1',
    caseId: 'CASE-QUALIFIED-1',
    title: 'Qualified review case',
    domain: 'nutrition',
    reviewType: 'systematic',
    sourceReview: { doi, pmid: '12345' },
    stageGold,
    tasks: [],
    caseHash: 'c'.repeat(64),
  };
}

test('checked-in SRBench suite replays qualification ledgers but remains blocked while independent gold is incomplete', async () => {
  const loaded = await loadSrBenchmarkSuite(resolve('benchmarks/srbench-v1/suite.json'));
  const jak = loaded.qualificationAdmissions.find((item) => item.caseId === 'SRBENCH-JAK-COVID-2021');
  const canary = loaded.qualificationAdmissions.find((item) => item.caseId === 'SRBENCH-FIXTURE-001');
  assert.ok(jak && canary);
  assert.equal(jak!.status, 'blocked');
  assert.equal(jak!.promotionAdmitted, false);
  assert.ok(jak!.reasons.some((reason) => /not validation-ready/i.test(reason)));
  assert.equal(canary!.status, 'not-required');
  assert.equal(canary!.promotionAdmitted, false);
  assert.ok(loaded.qualificationCorpus);
  assert.ok(loaded.qualificationFinalization);
  assert.equal(loaded.qualificationCorpus!.validationReadyCandidates.length, 0);
  assert.equal(loaded.qualificationFinalization!.sourceCaptureHashes.length, 2);
  assert.equal(loaded.qualificationFinalization!.assetReceiptHashes.length, 0);
  assert.equal(loaded.qualificationFinalization!.candidateVerificationReceiptHashes.length, 0);
  assert.equal(loaded.qualificationFinalization!.promotionGate.passed, false);
  assert.deepEqual(qualificationPromotionAdmittedCaseIds({
    admissions: loaded.qualificationAdmissions,
    finalization: loaded.qualificationFinalization!,
  }), []);
  const covid = loaded.qualificationCorpus!.candidates.find((candidate) => candidate.candidateId === 'SRQ-COVID-RAT-2024');
  assert.ok(covid);
  assert.equal(covid!.assets['extraction-truth'].status, 'frozen-unverified');
  assert.equal(covid!.assets['analysis-runtime'].status, 'frozen-unverified');
});

test('only a validation-ready candidate with cross-bound publication identity is admitted', () => {
  const corpus = createSrQualificationCorpus({
    corpusId: 'CORPUS',
    corpusVersion: '1',
    candidates: [verifiedCandidate()],
  });
  const [admission] = createSrQualificationAdmissions({
    cases: [{
      definition: publishedCase(),
      benchmarkClass: 'published-review',
      role: 'validation',
      qualificationCandidateId: 'QUALIFIED-1',
    }],
    corpus,
  });
  assert.ok(admission);
  assert.equal(admission!.status, 'admitted');
  assert.equal(admission!.promotionAdmitted, true);
  assert.equal(admission!.candidateHash, corpus.candidates[0]!.candidateHash);
  assert.deepEqual(admission!.reasons, []);
  assert.deepEqual(qualificationPromotionAdmittedCaseIds({ admissions: [admission!] }), ['CASE-QUALIFIED-1']);
});

test('identifier mismatch blocks a fully verified qualification candidate', () => {
  const corpus = createSrQualificationCorpus({
    corpusId: 'CORPUS',
    corpusVersion: '1',
    candidates: [verifiedCandidate('10.1000/different')],
  });
  const [admission] = createSrQualificationAdmissions({
    cases: [{
      definition: publishedCase('10.1000/case'),
      benchmarkClass: 'published-review',
      role: 'validation',
      qualificationCandidateId: 'QUALIFIED-1',
    }],
    corpus,
  });
  assert.equal(admission!.promotionAdmitted, false);
  assert.ok(admission!.reasons.some((reason) => /DOI mismatch/i.test(reason)));
});

test('missing qualification corpus fails closed for published validation cases', () => {
  const [admission] = createSrQualificationAdmissions({
    cases: [{
      definition: publishedCase(),
      benchmarkClass: 'published-review',
      role: 'validation',
      qualificationCandidateId: 'QUALIFIED-1',
    }],
    corpus: undefined,
  });
  assert.equal(admission!.status, 'blocked');
  assert.ok(admission!.reasons.some((reason) => /no qualification corpus/i.test(reason)));
});
