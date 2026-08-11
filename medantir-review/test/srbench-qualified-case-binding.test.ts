import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import { createSrQualifiedCaseBinding } from '../src/benchmark/sr-qualified-case-binding.js';
import type { SrBenchmarkCase } from '../src/benchmark/sr-reproduction-benchmark.js';

function candidate(): ReturnType<typeof createSrQualificationCandidate> {
  const assets = {} as SrQualificationCandidateInput['assets'];
  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    assets[component] = {
      status: 'frozen-verified',
      basis: 'source-reconstructed',
      receiptHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
    };
  });
  const base: SrQualificationCandidateInput = {
    candidateId: 'Q1',
    title: 'Qualified review',
    domain: 'nutrition',
    methodologicalClass: 'intervention-meta-analysis',
    publication: { doi: '10.1000/q1', pmid: '12345', year: 2022 },
    assets,
  };
  const unverified = createSrQualificationCandidate(base);
  const independentVerification = createSrQualificationCandidateVerificationReceipt({
    candidate: unverified,
    verificationBasis: 'dual-independent-audit',
    verifierId: 'verification-process',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  return createSrQualificationCandidate({ ...base, independentVerification });
}

function benchmark(): SrBenchmarkCase {
  const stages = ['question','protocol','search','deduplication','tiab-screening','fulltext-screening','extraction','appraisal','synthesis','report'] as const;
  const stageGold = Object.fromEntries(stages.map((stage, index) => [
    stage,
    { status: 'complete', receiptHash: (index + 20).toString(16).padStart(2, '0').repeat(32) },
  ])) as SrBenchmarkCase['stageGold'];
  return {
    schemaVersion: 'medantir-srbench/1',
    caseId: 'CASE-Q1',
    title: 'Qualified case',
    domain: 'nutrition',
    reviewType: 'systematic',
    sourceReview: { doi: '10.1000/q1', pmid: '12345' },
    stageGold,
    tasks: [],
  };
}

test('100%-coverage benchmark can be cross-bound stage-by-stage to one validation-ready review', () => {
  const binding = createSrQualifiedCaseBinding({ caseDefinition: benchmark(), candidate: candidate() });
  assert.equal(binding.stageBindings.length, 10);
  assert.equal(binding.candidateId, 'Q1');
  assert.equal(binding.caseId, 'CASE-Q1');
  const search = binding.stageBindings.find((stage) => stage.stage === 'search')!;
  assert.deepEqual(search.qualificationComponents.map((item) => item.component), ['search-corpus', 'search-strategy']);
  const synthesis = binding.stageBindings.find((stage) => stage.stage === 'synthesis')!;
  assert.deepEqual(synthesis.qualificationComponents.map((item) => item.component), ['analysis-runtime', 'synthesis-targets']);
  assert.match(binding.bindingHash, /^[a-f0-9]{64}$/);
});

test('changing one benchmark stage receipt changes the qualified-case binding', () => {
  const c = candidate();
  const first = benchmark();
  const firstBinding = createSrQualifiedCaseBinding({ caseDefinition: first, candidate: c });
  const second = benchmark();
  second.stageGold.extraction = { status: 'complete', receiptHash: 'f'.repeat(64) };
  const secondBinding = createSrQualifiedCaseBinding({ caseDefinition: second, candidate: c });
  assert.notEqual(firstBinding.caseHash, secondBinding.caseHash);
  assert.notEqual(firstBinding.bindingHash, secondBinding.bindingHash);
  assert.notEqual(
    firstBinding.stageBindings.find((stage) => stage.stage === 'extraction')!.stageBindingHash,
    secondBinding.stageBindings.find((stage) => stage.stage === 'extraction')!.stageBindingHash,
  );
});

test('publication or domain substitution fails instead of borrowing a qualified review identity', () => {
  const c = candidate();
  const wrongDoi = benchmark();
  wrongDoi.sourceReview = { doi: '10.1000/different', pmid: '12345' };
  assert.throws(() => createSrQualifiedCaseBinding({ caseDefinition: wrongDoi, candidate: c }), /publication identity/i);
  const wrongDomain = benchmark();
  wrongDomain.domain = 'cardiology';
  assert.throws(() => createSrQualifiedCaseBinding({ caseDefinition: wrongDomain, candidate: c }), /domain mismatch/i);
});

test('partial benchmark coverage cannot be certified as a qualified promotion case', () => {
  const partial = benchmark();
  partial.stageGold.extraction = { status: 'partial', reason: 'still reconstructing' };
  assert.throws(() => createSrQualifiedCaseBinding({ caseDefinition: partial, candidate: candidate() }), /100% benchmark pipeline coverage/i);
});
