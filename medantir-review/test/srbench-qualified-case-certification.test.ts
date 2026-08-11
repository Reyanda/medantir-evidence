import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import { createSrQualificationTrustRegistry } from '../src/benchmark/sr-qualification-signatures.js';
import { createSrQualifiedCaseBinding } from '../src/benchmark/sr-qualified-case-binding.js';
import {
  createSrQualifiedCaseCertificationReceipt,
  createSrQualifiedCaseSignatureEnvelope,
  verifySrQualifiedCaseCertification,
} from '../src/benchmark/sr-qualified-case-certification.js';
import type { SrBenchmarkCase } from '../src/benchmark/sr-reproduction-benchmark.js';

function qualifiedCandidate() {
  const assets = {} as SrQualificationCandidateInput['assets'];
  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    assets[component] = { status: 'frozen-verified', basis: 'source-reconstructed', receiptHash: (index + 1).toString(16).padStart(2, '0').repeat(32) };
  });
  const base: SrQualificationCandidateInput = {
    candidateId: 'Q1', title: 'Q1', domain: 'nutrition', methodologicalClass: 'meta-analysis',
    publication: { doi: '10.1000/q1', year: 2022 }, assets,
  };
  const unverified = createSrQualificationCandidate(base);
  const independentVerification = createSrQualificationCandidateVerificationReceipt({
    candidate: unverified, verificationBasis: 'dual-independent-audit', verifierId: 'process', verifiedAt: '2026-08-10T18:00:00Z',
  });
  return createSrQualificationCandidate({ ...base, independentVerification });
}

function caseDefinition(): SrBenchmarkCase {
  const stages = ['question','protocol','search','deduplication','tiab-screening','fulltext-screening','extraction','appraisal','synthesis','report'] as const;
  return {
    schemaVersion: 'medantir-srbench/1', caseId: 'CASE-Q1', title: 'Case', domain: 'nutrition', reviewType: 'systematic',
    sourceReview: { doi: '10.1000/q1' },
    stageGold: Object.fromEntries(stages.map((stage, index) => [stage, { status: 'complete', receiptHash: (index + 20).toString(16).padStart(2, '0').repeat(32) }])) as SrBenchmarkCase['stageGold'],
    tasks: [],
  };
}

function signer(keyId: string, organization: string) {
  const pair = generateKeyPairSync('ed25519');
  return {
    pair,
    key: {
      keyId,
      algorithm: 'ed25519' as const,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'active' as const,
      scopes: ['qualification-candidate' as const],
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2027-01-01T00:00:00Z',
      organization,
    },
  };
}

function payload(input: { receiptHash: string; caseId: string; candidateId: string; keyId: string; signedAt: string }): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'MEDANTIR-SR-QUALIFIED-BENCHMARK-CASE',
    receiptHash: input.receiptHash,
    caseId: input.caseId,
    candidateId: input.candidateId,
    keyId: input.keyId,
    signedAt: input.signedAt,
  }), 'utf8');
}

test('two trusted independent organizations can certify the exact benchmark-stage binding', () => {
  const binding = createSrQualifiedCaseBinding({ caseDefinition: caseDefinition(), candidate: qualifiedCandidate() });
  const receipt = createSrQualifiedCaseCertificationReceipt({
    binding, verificationBasis: 'dual-independent-audit', verifierProcessId: 'case-audit', verifiedAt: '2026-08-10T18:10:00Z',
  });
  const a = signer('A', 'Org-A');
  const b = signer('B', 'Org-B');
  const registry = createSrQualificationTrustRegistry({ registryId: 'R', registryVersion: '1', minimumDistinctSigners: 2, keys: [a.key, b.key] });
  const signedAt = '2026-08-10T18:15:00Z';
  const signatures = [a, b].map(({ pair, key }) => createSrQualifiedCaseSignatureEnvelope({
    receiptHash: receipt.receiptHash,
    caseId: receipt.caseId,
    candidateId: receipt.candidateId,
    keyId: key.keyId,
    signedAt,
    signatureBase64: sign(null, payload({ receiptHash: receipt.receiptHash, caseId: receipt.caseId, candidateId: receipt.candidateId, keyId: key.keyId, signedAt }), pair.privateKey).toString('base64'),
  }));
  const verification = verifySrQualifiedCaseCertification({ binding, receipt, signatures, registry });
  assert.equal(verification.valid, true);
  assert.equal(verification.receiptValid, true);
  assert.deepEqual(verification.trustedOrganizations, ['Org-A', 'Org-B']);
});

test('case certification cannot be replayed after one benchmark stage receipt changes', () => {
  const candidate = qualifiedCandidate();
  const firstBinding = createSrQualifiedCaseBinding({ caseDefinition: caseDefinition(), candidate });
  const receipt = createSrQualifiedCaseCertificationReceipt({
    binding: firstBinding, verificationBasis: 'independent-stage-reconciliation', verifierProcessId: 'case-audit', verifiedAt: '2026-08-10T18:10:00Z',
  });
  const changed = caseDefinition();
  changed.stageGold.synthesis = { status: 'complete', receiptHash: 'f'.repeat(64) };
  const secondBinding = createSrQualifiedCaseBinding({ caseDefinition: changed, candidate });
  const signerA = signer('A', 'Org-A');
  const signerB = signer('B', 'Org-B');
  const registry = createSrQualificationTrustRegistry({ registryId: 'R', registryVersion: '1', minimumDistinctSigners: 2, keys: [signerA.key, signerB.key] });
  const verification = verifySrQualifiedCaseCertification({ binding: secondBinding, receipt, signatures: [], registry });
  assert.equal(verification.valid, false);
  assert.equal(verification.receiptValid, false);
});

test('signatures that predate the case certification cannot authorize it', () => {
  const binding = createSrQualifiedCaseBinding({ caseDefinition: caseDefinition(), candidate: qualifiedCandidate() });
  const receipt = createSrQualifiedCaseCertificationReceipt({
    binding, verificationBasis: 'dual-independent-audit', verifierProcessId: 'case-audit', verifiedAt: '2026-08-10T18:10:00Z',
  });
  const a = signer('A', 'Org-A');
  const b = signer('B', 'Org-B');
  const registry = createSrQualificationTrustRegistry({ registryId: 'R', registryVersion: '1', minimumDistinctSigners: 2, keys: [a.key, b.key] });
  const signedAt = '2026-08-10T18:00:00Z';
  const signatures = [a, b].map(({ pair, key }) => createSrQualifiedCaseSignatureEnvelope({
    receiptHash: receipt.receiptHash, caseId: receipt.caseId, candidateId: receipt.candidateId, keyId: key.keyId, signedAt,
    signatureBase64: sign(null, payload({ receiptHash: receipt.receiptHash, caseId: receipt.caseId, candidateId: receipt.candidateId, keyId: key.keyId, signedAt }), pair.privateKey).toString('base64'),
  }));
  const verification = verifySrQualifiedCaseCertification({ binding, receipt, signatures, registry });
  assert.equal(verification.valid, false);
  assert.ok(verification.invalidSignatures.some((item) => /predates the certification/i.test(item.reason)));
});
