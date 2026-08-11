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
} from '../src/benchmark/sr-qualified-case-certification.js';
import { createSrCaseCertifiedPromotionGate } from '../src/benchmark/sr-case-certified-promotion.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';
import type { SrSecurePromotionSeal } from '../src/benchmark/sr-secure-promotion.js';
import type { SrBenchmarkCase } from '../src/benchmark/sr-reproduction-benchmark.js';

function candidate() {
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

function benchmark(): SrBenchmarkCase {
  const stages = ['question','protocol','search','deduplication','tiab-screening','fulltext-screening','extraction','appraisal','synthesis','report'] as const;
  return {
    schemaVersion: 'medantir-srbench/1', caseId: 'CASE-Q1', title: 'Case', domain: 'nutrition', reviewType: 'systematic', sourceReview: { doi: '10.1000/q1' },
    stageGold: Object.fromEntries(stages.map((stage, index) => [stage, { status: 'complete', receiptHash: (index + 20).toString(16).padStart(2, '0').repeat(32) }])) as SrBenchmarkCase['stageGold'],
    tasks: [],
  };
}

function signer(keyId: string, organization: string) {
  const pair = generateKeyPairSync('ed25519');
  return {
    pair,
    key: {
      keyId, algorithm: 'ed25519' as const, publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'active' as const, scopes: ['qualification-candidate' as const], validFrom: '2026-01-01T00:00:00Z', organization,
    },
  };
}

function payload(input: { receiptHash: string; caseId: string; candidateId: string; keyId: string; signedAt: string }) {
  return Buffer.from(JSON.stringify({ domain: 'MEDANTIR-SR-QUALIFIED-BENCHMARK-CASE', ...input }), 'utf8');
}

function fixture() {
  const c = candidate();
  const binding = createSrQualifiedCaseBinding({ caseDefinition: benchmark(), candidate: c });
  const receipt = createSrQualifiedCaseCertificationReceipt({ binding, verificationBasis: 'dual-independent-audit', verifierProcessId: 'case-audit', verifiedAt: '2026-08-10T18:10:00Z' });
  const a = signer('A', 'Org-A');
  const b = signer('B', 'Org-B');
  const registry = createSrQualificationTrustRegistry({ registryId: 'R', registryVersion: '1', minimumDistinctSigners: 2, keys: [a.key, b.key] });
  const signedAt = '2026-08-10T18:15:00Z';
  const signatures = [a, b].map(({ pair, key }) => createSrQualifiedCaseSignatureEnvelope({
    receiptHash: receipt.receiptHash, caseId: receipt.caseId, candidateId: receipt.candidateId, keyId: key.keyId, signedAt,
    signatureBase64: sign(null, payload({ receiptHash: receipt.receiptHash, caseId: receipt.caseId, candidateId: receipt.candidateId, keyId: key.keyId, signedAt }), pair.privateKey).toString('base64'),
  }));
  const tournament = {
    schemaVersion: 'medantir-srbench-suite/1', suiteId: 'S', suiteVersion: '1', suiteHash: '1'.repeat(64), models: ['m'], repeats: 3,
    cases: [],
    qualificationAdmissions: [{
      schemaVersion: 'medantir-sr-qualification-admission/1', caseId: binding.caseId, caseHash: binding.caseHash,
      qualificationCandidateId: binding.candidateId, candidateHash: binding.candidateHash, status: 'admitted', promotionAdmitted: true,
      reasons: [], admissionHash: '2'.repeat(64),
    }], counterfactualChallenges: [], runs: [], driftSentinels: [], promotion: [], leaderboard: [], tournamentHash: '3'.repeat(64),
  } as unknown as SrBenchmarkTournamentResult;
  const secure = {
    schemaVersion: 'medantir-sr-secure-promotion/1', suiteHash: tournament.suiteHash, tournamentHash: tournament.tournamentHash,
    performanceSummaryHash: '4'.repeat(64), trustRegistryHash: registry.registryHash, policyHash: '5'.repeat(64),
    authorizations: [{
      requestedModel: 'm', benchmarkPromotionTier: 'supervised-future-review-eligible', secureAuthorizationTier: 'supervised-future-review',
      checks: [], qualificationChecks: [], contaminationConcern: false, counterfactualCanarySr100Rate: 1, driftSentinelValid: false,
      autonomousAuthorityGranted: false, authorizationHash: '6'.repeat(64),
    }], sealHash: '7'.repeat(64),
  } as unknown as SrSecurePromotionSeal;
  return { binding, receipt, signatures, registry, tournament, secure };
}

test('valid signed case certification preserves secure future-review eligibility', () => {
  const f = fixture();
  const gate = createSrCaseCertifiedPromotionGate({
    tournament: f.tournament, baseSecurePromotionSeal: f.secure, trustRegistry: f.registry,
    certificationPackages: [{ binding: f.binding, receipt: f.receipt, signatures: f.signatures }],
  });
  assert.equal(gate.allRequiredCasesCertified, true);
  assert.equal(gate.certificationItems[0]!.valid, true);
  assert.equal(gate.effectiveSecurePromotionSeal.authorizations[0]!.secureAuthorizationTier, 'supervised-future-review');
  assert.match(gate.gateHash, /^[a-f0-9]{64}$/);
});

test('missing signed benchmark-case certification downgrades secure production eligibility to shadow', () => {
  const f = fixture();
  const gate = createSrCaseCertifiedPromotionGate({ tournament: f.tournament, baseSecurePromotionSeal: f.secure, trustRegistry: f.registry, certificationPackages: [] });
  assert.equal(gate.allRequiredCasesCertified, false);
  assert.equal(gate.effectiveSecurePromotionSeal.authorizations[0]!.secureAuthorizationTier, 'shadow-only');
  assert.ok(gate.certificationItems[0]!.reasons.some((reason) => /no signed benchmark-case certification/i.test(reason)));
});

test('certification for a different case cannot satisfy an admitted case', () => {
  const f = fixture();
  const alteredBinding = { ...f.binding, caseId: 'OTHER-CASE' };
  const gate = createSrCaseCertifiedPromotionGate({
    tournament: f.tournament, baseSecurePromotionSeal: f.secure, trustRegistry: f.registry,
    certificationPackages: [{ binding: alteredBinding, receipt: f.receipt, signatures: f.signatures }],
  });
  assert.equal(gate.allRequiredCasesCertified, false);
  assert.equal(gate.effectiveSecurePromotionSeal.authorizations[0]!.secureAuthorizationTier, 'shadow-only');
});
