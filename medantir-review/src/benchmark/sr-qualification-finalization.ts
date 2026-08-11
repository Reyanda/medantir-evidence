import { scientificContentHash } from '../core/canonical-hash.js';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
  type SrQualificationCandidateVerificationReceipt,
  type SrQualificationComponent,
  type SrQualificationCorpus,
} from './sr-qualification-corpus.js';
import {
  applySrQualificationAssetReceipt,
  verifySrQualificationAssetReceipt,
  type SrQualificationAssetReceipt,
  type SrQualificationSourceIdentity,
} from './sr-qualification-receipt.js';
import {
  applySrQualificationSourceCapture,
  verifySrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from './sr-qualification-source-capture.js';

export const SR_QUALIFICATION_FINALIZATION_SCHEMA_VERSION = 'medantir-sr-qualification-finalization/1' as const;

export interface SrQualificationPromotionPolicy {
  policyId: string;
  policyVersion: string;
  minimumValidationReadyCandidates: number;
  minimumDistinctDomains: number;
  /** Optional breadth constraint. The established SR100 default is three reviews across three domains; method-class breadth is reported but not raised above one unless policy is deliberately tightened. */
  minimumDistinctMethodologicalClasses: number;
  requireEveryAssetReceiptSourceCaptured: boolean;
}

export interface SrQualificationPromotionGate {
  passed: boolean;
  validationReadyCandidates: string[];
  distinctDomains: string[];
  distinctMethodologicalClasses: string[];
  checks: Array<{
    code: string;
    passed: boolean;
    observed: number;
    required: number;
    rationale: string;
  }>;
  gateHash: string;
}

export interface SrQualificationFinalization {
  schemaVersion: typeof SR_QUALIFICATION_FINALIZATION_SCHEMA_VERSION;
  corpus: SrQualificationCorpus;
  sourceCaptureHashes: string[];
  assetReceiptHashes: string[];
  candidateVerificationReceiptHashes: string[];
  promotionPolicy: SrQualificationPromotionPolicy;
  promotionGate: SrQualificationPromotionGate;
  finalizationHash: string;
}

export interface SrQualificationFinalizationInput {
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
  sourceCaptures: SrQualificationSourceCapture[];
  assetReceipts: SrQualificationAssetReceipt[];
  candidateVerifications: SrQualificationCandidateVerificationReceipt[];
  promotionPolicy?: SrQualificationPromotionPolicy;
}

export function defaultSrQualificationPromotionPolicy(): SrQualificationPromotionPolicy {
  return {
    policyId: 'MEDANTIR-SRBENCH-QUALIFICATION',
    policyVersion: '1.0.0',
    minimumValidationReadyCandidates: 3,
    minimumDistinctDomains: 3,
    minimumDistinctMethodologicalClasses: 1,
    requireEveryAssetReceiptSourceCaptured: true,
  };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be an integer >= 1.`);
  return value;
}

function normalizePolicy(policy: SrQualificationPromotionPolicy): SrQualificationPromotionPolicy {
  if (!policy.policyId.trim() || !policy.policyVersion.trim()) throw new Error('Qualification promotion policy requires stable ID/version.');
  return {
    policyId: policy.policyId.trim(),
    policyVersion: policy.policyVersion.trim(),
    minimumValidationReadyCandidates: positiveInteger(policy.minimumValidationReadyCandidates, 'minimumValidationReadyCandidates'),
    minimumDistinctDomains: positiveInteger(policy.minimumDistinctDomains, 'minimumDistinctDomains'),
    minimumDistinctMethodologicalClasses: positiveInteger(policy.minimumDistinctMethodologicalClasses, 'minimumDistinctMethodologicalClasses'),
    requireEveryAssetReceiptSourceCaptured: policy.requireEveryAssetReceiptSourceCaptured,
  };
}

function identityKey(identity: SrQualificationSourceIdentity): string {
  if (identity.kind === 'git-commit') {
    return `git:${identity.repository.trim()}@${identity.commit.trim().toLowerCase()}${identity.tree ? `#${identity.tree.trim().toLowerCase()}` : ''}`;
  }
  return `hobj:${identity.objectId}:${identity.sha256.trim().toLowerCase()}:${identity.byteLength}:${identity.mediaType?.trim().toLowerCase() ?? ''}`;
}

function identitySet(identities: SrQualificationSourceIdentity[]): string[] {
  return [...new Set(identities.map(identityKey))].sort();
}

function sameIdentitySet(left: SrQualificationSourceIdentity[], right: SrQualificationSourceIdentity[]): boolean {
  const a = identitySet(left);
  const b = identitySet(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function componentKey(candidateId: string, component: SrQualificationComponent): string {
  return `${candidateId.trim()}\u0000${component}`;
}

export function evaluateSrQualificationPromotionGate(
  corpus: SrQualificationCorpus,
  policyInput: SrQualificationPromotionPolicy = defaultSrQualificationPromotionPolicy(),
): SrQualificationPromotionGate {
  const policy = normalizePolicy(policyInput);
  const ready = corpus.candidates.filter((candidate) => candidate.promotionEligible && candidate.readiness === 'validation-ready');
  const validationReadyCandidates = ready.map((candidate) => candidate.candidateId).sort();
  const distinctDomains = [...new Set(ready.map((candidate) => candidate.domain))].sort();
  const distinctMethodologicalClasses = [...new Set(ready.map((candidate) => candidate.methodologicalClass))].sort();
  const checks = [
    {
      code: 'validation-ready-candidates',
      passed: validationReadyCandidates.length >= policy.minimumValidationReadyCandidates,
      observed: validationReadyCandidates.length,
      required: policy.minimumValidationReadyCandidates,
      rationale: 'Promotion requires multiple independently verified published-review gold packages, not one successful review.',
    },
    {
      code: 'distinct-scientific-domains',
      passed: distinctDomains.length >= policy.minimumDistinctDomains,
      observed: distinctDomains.length,
      required: policy.minimumDistinctDomains,
      rationale: 'Qualification evidence must span independent scientific domains so domain-specific success cannot masquerade as general systematic-review competence.',
    },
    {
      code: 'distinct-methodological-classes',
      passed: distinctMethodologicalClasses.length >= policy.minimumDistinctMethodologicalClasses,
      observed: distinctMethodologicalClasses.length,
      required: policy.minimumDistinctMethodologicalClasses,
      rationale: 'The gate records methodological breadth and can be tightened prospectively without silently changing the established three-review/three-domain default.',
    },
  ];
  const base = {
    passed: checks.every((check) => check.passed),
    validationReadyCandidates,
    distinctDomains,
    distinctMethodologicalClasses,
    checks,
  };
  return { ...base, gateHash: scientificContentHash({ ...base, policy }) };
}

function candidateMap(candidates: SrQualificationCandidateInput[]): Map<string, SrQualificationCandidateInput> {
  const map = new Map<string, SrQualificationCandidateInput>();
  for (const candidate of candidates) {
    const normalized = createSrQualificationCandidate(candidate);
    if (map.has(normalized.candidateId)) throw new Error(`Qualification finalization received duplicate candidate '${normalized.candidateId}'.`);
    map.set(normalized.candidateId, structuredClone(candidate));
  }
  return map;
}

function captureIndex(captures: SrQualificationSourceCapture[]): Map<string, SrQualificationSourceCapture> {
  const byHash = new Map<string, SrQualificationSourceCapture>();
  for (const capture of captures) {
    const errors = verifySrQualificationSourceCapture(capture);
    if (errors.length > 0) throw new Error(`Invalid qualification source capture '${capture.captureHash}': ${errors.join(' ')}`);
    if (byHash.has(capture.captureHash)) throw new Error(`Qualification finalization received duplicate source capture '${capture.captureHash}'.`);
    byHash.set(capture.captureHash, capture);
  }
  return byHash;
}

function applyBenchmarkGoldCaptures(input: {
  candidates: Map<string, SrQualificationCandidateInput>;
  captures: SrQualificationSourceCapture[];
}): void {
  const ordered = [...input.captures].sort((a, b) =>
    a.candidateId.localeCompare(b.candidateId)
      || a.component.localeCompare(b.component)
      || a.captureHash.localeCompare(b.captureHash));
  for (const capture of ordered) {
    const candidate = input.candidates.get(capture.candidateId);
    if (!candidate) throw new Error(`Qualification source capture references unknown candidate '${capture.candidateId}'.`);
    if (capture.qualificationUse !== 'benchmark-gold') continue;
    input.candidates.set(capture.candidateId, applySrQualificationSourceCapture({ candidate, capture }));
  }
}

function verifyReceiptCaptureBinding(input: {
  receipt: SrQualificationAssetReceipt;
  capturesByHash: Map<string, SrQualificationSourceCapture>;
  policy: SrQualificationPromotionPolicy;
}): void {
  const hashes = input.receipt.sourceCaptureHashes ?? [];
  if (input.policy.requireEveryAssetReceiptSourceCaptured && hashes.length === 0) {
    throw new Error(`Qualification asset receipt '${input.receipt.receiptHash}' is not bound to an immutable qualification source capture.`);
  }
  if (hashes.length === 0) return;

  const bound: SrQualificationSourceCapture[] = [];
  for (const hash of hashes) {
    const capture = input.capturesByHash.get(hash);
    if (!capture) throw new Error(`Qualification asset receipt '${input.receipt.receiptHash}' references unknown source capture '${hash}'.`);
    if (capture.candidateId !== input.receipt.candidateId || capture.component !== input.receipt.component) {
      throw new Error(`Qualification asset receipt '${input.receipt.receiptHash}' is cross-bound to source capture '${hash}' from another candidate/component.`);
    }
    if (capture.qualificationUse !== 'benchmark-gold') {
      throw new Error(`Qualification asset receipt '${input.receipt.receiptHash}' references source capture '${hash}' that is not benchmark-gold.`);
    }
    bound.push(capture);
  }
  const capturedIdentities = bound.flatMap((capture) => capture.sourceIdentities);
  if (!sameIdentitySet(input.receipt.sourceIdentities, capturedIdentities)) {
    throw new Error(`Qualification asset receipt '${input.receipt.receiptHash}' source identities do not exactly match its bound source captures.`);
  }
}

function applyAssetReceipts(input: {
  candidates: Map<string, SrQualificationCandidateInput>;
  receipts: SrQualificationAssetReceipt[];
  capturesByHash: Map<string, SrQualificationSourceCapture>;
  policy: SrQualificationPromotionPolicy;
}): void {
  const seen = new Set<string>();
  for (const receipt of input.receipts) {
    const errors = verifySrQualificationAssetReceipt(receipt);
    if (errors.length > 0) throw new Error(`Invalid qualification asset receipt '${receipt.receiptHash}': ${errors.join(' ')}`);
    const key = componentKey(receipt.candidateId, receipt.component);
    if (seen.has(key)) throw new Error(`Qualification finalization received more than one asset receipt for '${receipt.candidateId}/${receipt.component}'.`);
    seen.add(key);
    const candidate = input.candidates.get(receipt.candidateId);
    if (!candidate) throw new Error(`Qualification asset receipt references unknown candidate '${receipt.candidateId}'.`);
    verifyReceiptCaptureBinding({ receipt, capturesByHash: input.capturesByHash, policy: input.policy });
    input.candidates.set(receipt.candidateId, applySrQualificationAssetReceipt({ candidate, receipt }));
  }
}

function applyCandidateVerifications(input: {
  candidates: Map<string, SrQualificationCandidateInput>;
  receipts: SrQualificationCandidateVerificationReceipt[];
}): void {
  const seen = new Set<string>();
  for (const receipt of input.receipts) {
    const candidateId = receipt.candidateId.trim();
    if (seen.has(candidateId)) throw new Error(`Qualification finalization received duplicate candidate verification for '${candidateId}'.`);
    seen.add(candidateId);
    const candidate = input.candidates.get(candidateId);
    if (!candidate) throw new Error(`Qualification candidate verification references unknown candidate '${candidateId}'.`);
    const verified = createSrQualificationCandidate({ ...candidate, independentVerification: receipt });
    if (!verified.independentVerification) throw new Error(`Qualification candidate verification for '${candidateId}' was not retained after validation.`);
    input.candidates.set(candidateId, {
      ...candidate,
      independentVerification: verified.independentVerification,
    });
  }
}

export function createSrQualificationFinalization(input: SrQualificationFinalizationInput): SrQualificationFinalization {
  const policy = normalizePolicy(input.promotionPolicy ?? defaultSrQualificationPromotionPolicy());
  const candidates = candidateMap(input.candidates);
  const capturesByHash = captureIndex(input.sourceCaptures);

  for (const capture of input.sourceCaptures) {
    if (!candidates.has(capture.candidateId)) throw new Error(`Qualification source capture references unknown candidate '${capture.candidateId}'.`);
    if (!SR_QUALIFICATION_COMPONENTS.includes(capture.component)) throw new Error(`Qualification source capture references unsupported component '${capture.component}'.`);
  }

  applyBenchmarkGoldCaptures({ candidates, captures: input.sourceCaptures });
  applyAssetReceipts({ candidates, receipts: input.assetReceipts, capturesByHash, policy });
  applyCandidateVerifications({ candidates, receipts: input.candidateVerifications });

  const corpus = createSrQualificationCorpus({
    corpusId: input.corpusId,
    corpusVersion: input.corpusVersion,
    candidates: [...candidates.values()],
  });
  const promotionGate = evaluateSrQualificationPromotionGate(corpus, policy);
  const sourceCaptureHashes = [...capturesByHash.keys()].sort();
  const assetReceiptHashes = [...input.assetReceipts.map((receipt) => receipt.receiptHash)].sort();
  const candidateVerificationReceiptHashes = [...input.candidateVerifications.map((receipt) => receipt.receiptHash)].sort();
  const base = {
    schemaVersion: SR_QUALIFICATION_FINALIZATION_SCHEMA_VERSION,
    corpus,
    sourceCaptureHashes,
    assetReceiptHashes,
    candidateVerificationReceiptHashes,
    promotionPolicy: policy,
    promotionGate,
  };
  return { ...base, finalizationHash: scientificContentHash(base) };
}
