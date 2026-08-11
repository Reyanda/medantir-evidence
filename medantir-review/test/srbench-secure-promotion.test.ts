import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  createSrQualificationReceiptSignatureEnvelope,
  createSrQualificationTrustRegistry,
  type SrQualificationVerifierKey,
} from '../src/benchmark/sr-qualification-signatures.js';
import { createSrSecurePromotionSeal } from '../src/benchmark/sr-secure-promotion.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';
import type { SrTournamentPerformanceSummary } from '../src/benchmark/sr-performance-summary.js';

function qualifiedCandidate(): SrQualificationCandidateInput {
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
    publication: { doi: '10.1000/q1', year: 2022 },
    assets,
  };
  const unverified = createSrQualificationCandidate(base);
  const receipt = createSrQualificationCandidateVerificationReceipt({
    candidate: unverified,
    verificationBasis: 'dual-independent-audit',
    verifierId: 'verification-process',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
  return { ...base, independentVerification: receipt };
}

function verifier(keyId: string, organization: string) {
  const pair = generateKeyPairSync('ed25519');
  const descriptor: SrQualificationVerifierKey = {
    keyId,
    algorithm: 'ed25519',
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    status: 'active',
    scopes: ['qualification-candidate'],
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    organization,
  };
  return { pair, descriptor };
}

function signaturePayload(input: { receiptHash: string; candidateId: string; keyId: string; signedAt: string }): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'MEDANTIR-SR-QUALIFICATION-CANDIDATE',
    receiptHash: input.receiptHash,
    candidateId: input.candidateId,
    keyId: input.keyId,
    signedAt: input.signedAt,
  }), 'utf8');
}

function fixture(input: { contaminationConcern?: boolean; canaryRate?: number; driftValid?: boolean }) {
  const candidateInput = qualifiedCandidate();
  const candidate = createSrQualificationCandidate(candidateInput);
  const a = verifier('KEY-A', 'University-A');
  const b = verifier('KEY-B', 'University-B');
  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST',
    registryVersion: '1',
    minimumDistinctSigners: 2,
    keys: [a.descriptor, b.descriptor],
  });
  const signedAt = '2026-08-10T18:05:00Z';
  const signatures = [a, b].map(({ pair, descriptor }) => {
    const signatureBase64 = sign(null, signaturePayload({
      receiptHash: candidate.independentVerification!.receiptHash,
      candidateId: candidate.candidateId,
      keyId: descriptor.keyId,
      signedAt,
    }), pair.privateKey).toString('base64');
    return createSrQualificationReceiptSignatureEnvelope({
      receiptHash: candidate.independentVerification!.receiptHash,
      candidateId: candidate.candidateId,
      keyId: descriptor.keyId,
      algorithm: 'ed25519',
      signedAt,
      signatureBase64,
    });
  });
  const tournament = {
    schemaVersion: 'medantir-srbench-suite/1',
    suiteId: 'SUITE',
    suiteVersion: '1',
    suiteHash: '1'.repeat(64),
    qualificationCorpusHash: '2'.repeat(64),
    models: ['model-a'],
    repeats: 3,
    cases: [{
      caseId: 'CASE-Q1',
      benchmarkClass: 'published-review',
      role: 'validation',
      qualificationCandidateId: 'Q1',
      domain: 'nutrition',
      pipelineCoverage: 100,
      sourcePath: '/case',
    }],
    qualificationAdmissions: [{
      schemaVersion: 'medantir-sr-qualification-admission/1',
      caseId: 'CASE-Q1',
      caseHash: '3'.repeat(64),
      qualificationCandidateId: 'Q1',
      candidateHash: candidate.candidateHash,
      status: 'admitted',
      promotionAdmitted: true,
      reasons: [],
      admissionHash: '4'.repeat(64),
    }],
    counterfactualChallenges: [],
    runs: [],
    driftSentinels: [{
      requestedModel: 'model-a',
      supplied: true,
      valid: input.driftValid ?? true,
      sentinelId: 'S1',
      receiptHash: '5'.repeat(64),
      errors: [],
    }],
    promotion: [{
      requestedModel: 'model-a',
      tier: 'supervised-living-review-eligible',
    }],
    leaderboard: [],
    tournamentHash: '6'.repeat(64),
  } as unknown as SrBenchmarkTournamentResult;
  const canaryRate = input.canaryRate ?? 1;
  const performance = {
    schemaVersion: 'medantir-srbench-performance-summary/1',
    suiteHash: tournament.suiteHash,
    tournamentHash: tournament.tournamentHash,
    models: [{
      requestedModel: 'model-a',
      actualModels: ['model-a-pinned'],
      providers: ['provider-a'],
      validation: {
        runs: 9,
        meanReproductionScore: 100,
        meanPipelineCoverage: 100,
        meanEffectiveScore: 100,
        sr100Runs: 9,
        sr100Rate: 1,
        criticalFailures: 0,
      },
      counterfactualCanary: {
        runs: 3,
        challengedRuns: 3,
        sr100Runs: Math.round(3 * canaryRate),
        sr100Rate: canaryRate,
        criticalFailures: 0,
        uniqueChallengeReceipts: 3,
        uniqueChallengeCases: 3,
      },
      qualificationPromotionTier: 'supervised-living-review-eligible',
      contaminationConcern: input.contaminationConcern ?? false,
      summaryHash: '7'.repeat(64),
    }],
    summaryHash: '8'.repeat(64),
  } as SrTournamentPerformanceSummary;
  return { candidateInput, candidate, registry, signatures, tournament, performance };
}

test('benchmark-level living eligibility becomes secure living authorization only with trusted multi-organization qualification quorum', () => {
  const f = fixture({});
  const seal = createSrSecurePromotionSeal({
    tournament: f.tournament,
    performanceSummary: f.performance,
    trustRegistry: f.registry,
    qualificationProofs: [{ candidate: f.candidateInput, signatures: f.signatures }],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.secureAuthorizationTier, 'supervised-living-review');
  assert.equal(auth.qualificationChecks.every((check) => check.qualified), true);
  assert.deepEqual(auth.qualificationChecks[0]!.trustedOrganizations, ['University-A', 'University-B']);
  assert.equal(auth.autonomousAuthorityGranted, false);
  assert.match(seal.sealHash, /^[a-f0-9]{64}$/);
});

test('perfect benchmark tier without signed qualification proof receives no secure production authorization', () => {
  const f = fixture({});
  const seal = createSrSecurePromotionSeal({
    tournament: f.tournament,
    performanceSummary: f.performance,
    trustRegistry: f.registry,
    qualificationProofs: [],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.benchmarkPromotionTier, 'supervised-living-review-eligible');
  assert.equal(auth.secureAuthorizationTier, 'none');
  assert.equal(auth.checks.find((check) => check.code === 'cryptographic-qualification-quorum')!.passed, false);
});

test('same-organization keys fail independent-organization policy even when signature quorum is met', () => {
  const f = fixture({});
  const sameOrgRegistry = createSrQualificationTrustRegistry({
    registryId: 'SAME-ORG',
    registryVersion: '1',
    minimumDistinctSigners: 2,
    keys: f.registry.keys.map((key) => ({ ...key, organization: 'One-Organization' })),
  });
  const seal = createSrSecurePromotionSeal({
    tournament: f.tournament,
    performanceSummary: f.performance,
    trustRegistry: sameOrgRegistry,
    qualificationProofs: [{ candidate: f.candidateInput, signatures: f.signatures }],
  });
  assert.equal(seal.authorizations[0]!.secureAuthorizationTier, 'none');
  assert.ok(seal.authorizations[0]!.qualificationChecks[0]!.reasons.some((reason) => /distinct verifier organization/i.test(reason)));
});

test('hidden counterfactual failure blocks secure authorization even with perfectly signed qualification evidence', () => {
  const f = fixture({ contaminationConcern: true, canaryRate: 0 });
  const seal = createSrSecurePromotionSeal({
    tournament: f.tournament,
    performanceSummary: f.performance,
    trustRegistry: f.registry,
    qualificationProofs: [{ candidate: f.candidateInput, signatures: f.signatures }],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.secureAuthorizationTier, 'none');
  assert.equal(auth.checks.find((check) => check.code === 'counterfactual-contamination')!.passed, false);
  assert.equal(auth.checks.find((check) => check.code === 'counterfactual-canary-sr100')!.passed, false);
});

test('expired or invalid drift sentinel allows secure future review but blocks secure living review', () => {
  const f = fixture({ driftValid: false });
  const seal = createSrSecurePromotionSeal({
    tournament: f.tournament,
    performanceSummary: f.performance,
    trustRegistry: f.registry,
    qualificationProofs: [{ candidate: f.candidateInput, signatures: f.signatures }],
  });
  const auth = seal.authorizations[0]!;
  assert.equal(auth.secureAuthorizationTier, 'supervised-future-review');
  assert.equal(auth.checks.find((check) => check.code === 'drift-sentinel')!.passed, false);
});
