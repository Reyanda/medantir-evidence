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
} from '../src/benchmark/sr-qualification-corpus.js';

function completeAssets(): SrQualificationCandidateInput['assets'] {
  const assets = {} as SrQualificationCandidateInput['assets'];
  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    assets[component] = {
      status: 'frozen-verified',
      basis: 'source-reconstructed',
      receiptHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
    };
  });
  return assets;
}

function baseCandidate(id = 'C1'): SrQualificationCandidateInput {
  return {
    candidateId: id,
    title: `Review ${id}`,
    domain: 'nutrition',
    methodologicalClass: 'intervention-meta-analysis',
    publication: { doi: `10.1000/${id.toLowerCase()}`, year: 2020 },
    assets: completeAssets(),
  };
}

function verifiedCandidateInput(id = 'C1'): SrQualificationCandidateInput {
  const input = baseCandidate(id);
  const goldBuildable = createSrQualificationCandidate(input);
  const receipt = createSrQualificationCandidateVerificationReceipt({
    candidate: goldBuildable,
    verificationBasis: 'independent-reproduction',
    verifierId: 'independent-verifier-1',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  return { ...input, independentVerification: receipt };
}

test('validation-ready requires every component frozen-verified plus candidate-wide independent verification', () => {
  const unverified = createSrQualificationCandidate(baseCandidate());
  assert.equal(unverified.readiness, 'gold-buildable');
  assert.equal(unverified.promotionEligible, false);
  assert.match(unverified.preVerificationCandidateHash, /^[a-f0-9]{64}$/);

  const ready = createSrQualificationCandidate(verifiedCandidateInput());
  assert.equal(ready.readiness, 'validation-ready');
  assert.equal(ready.completeComponents, SR_QUALIFICATION_COMPONENTS.length);
  assert.equal(ready.missingOrWeakComponents.length, 0);
  assert.equal(ready.promotionEligible, true);
  assert.equal(ready.independentVerification!.targetCandidateHash, ready.preVerificationCandidateHash);
});

test('candidate-wide verification is invalidated when any component receipt changes', () => {
  const verified = verifiedCandidateInput();
  const tampered = structuredClone(verified);
  tampered.assets['extraction-truth'] = {
    ...tampered.assets['extraction-truth'],
    receiptHash: 'f'.repeat(64),
  };
  assert.throws(
    () => createSrQualificationCandidate(tampered),
    /target hash does not match|component receipt set does not match/i,
  );
});

test('candidate verification receipt itself is tamper-evident', () => {
  const verified = verifiedCandidateInput();
  verified.independentVerification = {
    ...verified.independentVerification!,
    verifierId: 'forged-verifier',
  };
  assert.throws(() => createSrQualificationCandidate(verified), /receipt hash mismatch/i);
});

test('published aggregate evidence cannot be promoted directly to frozen-verified gold', () => {
  const candidate = baseCandidate();
  candidate.assets['tiab-truth'] = {
    status: 'frozen-verified',
    basis: 'published-aggregate',
    receiptHash: 'a'.repeat(64),
  };
  assert.throws(() => createSrQualificationCandidate(candidate), /published aggregate evidence alone/i);
});

test('a single missing scientific component prevents gold-buildable and validation-ready status', () => {
  const candidate = baseCandidate();
  candidate.assets['search-corpus'] = { status: 'missing', basis: 'not-available' };
  const result = createSrQualificationCandidate(candidate);
  assert.equal(result.readiness, 'assets-partial');
  assert.equal(result.promotionEligible, false);
  assert.ok(result.missingOrWeakComponents.includes('search-corpus'));
});

test('qualification corpus rejects duplicate publication identities even under different labels', () => {
  const a = baseCandidate('A');
  const b = baseCandidate('B');
  b.publication.doi = a.publication.doi;
  assert.throws(() => createSrQualificationCorpus({ corpusId: 'X', corpusVersion: '1', candidates: [a, b] }), /duplicates publication identity/i);
});

test('checked-in real qualification candidates remain non-ready until their assets are actually frozen and independently verified', async () => {
  const path = resolve('benchmarks/srbench-v1/qualification-candidates.json');
  const raw = JSON.parse(await readFile(path, 'utf8')) as {
    schemaVersion: string;
    corpusId: string;
    corpusVersion: string;
    candidates: SrQualificationCandidateInput[];
  };
  const corpus = createSrQualificationCorpus({
    corpusId: raw.corpusId,
    corpusVersion: raw.corpusVersion,
    candidates: raw.candidates,
  });
  assert.deepEqual(corpus.validationReadyCandidates, []);
  assert.equal(corpus.candidates.length, 4);
  const byId = new Map(corpus.candidates.map((candidate) => [candidate.candidateId, candidate]));
  assert.equal(byId.get('SRQ-JAK-COVID-2021')!.promotionEligible, false);
  assert.equal(byId.get('SRQ-HAMILTON-SHARING-2023')!.promotionEligible, false);
  assert.equal(byId.get('SRQ-CALORIE-REFORMULATION-2022')!.promotionEligible, false);
  assert.equal(byId.get('SRQ-COVID-RAT-2024')!.promotionEligible, false);
  assert.ok(byId.get('SRQ-HAMILTON-SHARING-2023')!.buildableComponents > byId.get('SRQ-JAK-COVID-2021')!.buildableComponents);
});
