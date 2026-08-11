import { scientificContentHash } from '../core/canonical-hash.js';
import {
  createSrQualificationCandidate,
  type SrQualificationCandidateInput,
  type SrQualificationComponent,
} from './sr-qualification-corpus.js';
import {
  createSrQualificationAssetReceipt,
  type SrQualificationAssetReceipt,
  type SrQualificationSourceIdentity,
} from './sr-qualification-receipt.js';

export const SR_QUALIFICATION_SOURCE_CAPTURE_SCHEMA_VERSION = 'medantir-sr-qualification-source-capture/1' as const;

export type SrQualificationSourceRole =
  | 'preregistration'
  | 'review-materials'
  | 'results-code'
  | 'published-table-data'
  | 'restricted-supporting-data'
  | 'other';

export type SrQualificationUse = 'benchmark-gold' | 'supporting-evidence-only';
export type SrQualificationCaptureMethod = 'git-revision-pin' | 'content-addressed-archive' | 'content-hash-verification';

const SOURCE_ROLES = new Set<SrQualificationSourceRole>([
  'preregistration',
  'review-materials',
  'results-code',
  'published-table-data',
  'restricted-supporting-data',
  'other',
]);
const QUALIFICATION_USES = new Set<SrQualificationUse>(['benchmark-gold', 'supporting-evidence-only']);
const CAPTURE_METHODS = new Set<SrQualificationCaptureMethod>([
  'git-revision-pin',
  'content-addressed-archive',
  'content-hash-verification',
]);

export interface SrQualificationSourceCapture {
  schemaVersion: typeof SR_QUALIFICATION_SOURCE_CAPTURE_SCHEMA_VERSION;
  candidateId: string;
  component: SrQualificationComponent;
  sourceIdentities: SrQualificationSourceIdentity[];
  selectedPaths?: string[];
  /** Scientific provenance role. This is hash-bound when supplied. */
  sourceRole?: SrQualificationSourceRole;
  /** Whether this immutable source may qualify benchmark gold or is supporting evidence only. */
  qualificationUse?: SrQualificationUse;
  capturedAt: string;
  captureMethod: SrQualificationCaptureMethod;
  captureHash: string;
}

export type SrQualificationAssetReceiptFromCaptureInput = Omit<
  SrQualificationAssetReceipt,
  'schemaVersion' | 'receiptHash' | 'candidateId' | 'component' | 'sourceIdentities' | 'sourceCaptureHashes'
> & {
  capture: SrQualificationSourceCapture;
};

export type SrQualificationAssetReceiptFromCapturesInput = Omit<
  SrQualificationAssetReceipt,
  'schemaVersion' | 'receiptHash' | 'candidateId' | 'component' | 'sourceIdentities' | 'sourceCaptureHashes'
> & {
  captures: SrQualificationSourceCapture[];
};

function normalizeIdentity(identity: SrQualificationSourceIdentity): SrQualificationSourceIdentity {
  if (identity.kind === 'git-commit') {
    const repository = identity.repository.trim();
    const commit = identity.commit.trim().toLowerCase();
    if (!repository || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Qualification source capture requires a full 40-character Git commit SHA.');
    if (identity.tree && !/^[a-f0-9]{40}$/i.test(identity.tree.trim())) throw new Error('Qualification source capture tree must be a full Git SHA.');
    return { kind: 'git-commit', repository, commit, ...(identity.tree ? { tree: identity.tree.trim().toLowerCase() } : {}) };
  }
  const sha256 = identity.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256) || identity.objectId !== `HOBJ-${sha256}`) {
    throw new Error('Qualification source capture HOBJ identity must exactly match its SHA-256.');
  }
  if (!Number.isInteger(identity.byteLength) || identity.byteLength < 0) throw new Error('Qualification source capture byteLength must be non-negative.');
  return { ...identity, sha256, ...(identity.mediaType?.trim() ? { mediaType: identity.mediaType.trim().toLowerCase() } : {}) };
}

function identityKey(identity: SrQualificationSourceIdentity): string {
  return scientificContentHash(normalizeIdentity(identity));
}

export function createSrQualificationSourceCapture(input: Omit<SrQualificationSourceCapture, 'schemaVersion' | 'captureHash'>): SrQualificationSourceCapture {
  if (!input.candidateId.trim() || !input.component) throw new Error('Qualification source capture requires candidate/component identity.');
  if (input.sourceIdentities.length === 0) throw new Error('Qualification source capture requires immutable source identity.');
  if (Number.isNaN(Date.parse(input.capturedAt))) throw new Error('Qualification source capture capturedAt must be a valid date-time.');
  if (input.sourceRole !== undefined && !SOURCE_ROLES.has(input.sourceRole)) throw new Error(`Unsupported qualification source role '${String(input.sourceRole)}'.`);
  if (input.qualificationUse !== undefined && !QUALIFICATION_USES.has(input.qualificationUse)) throw new Error(`Unsupported qualification use '${String(input.qualificationUse)}'.`);
  if (!CAPTURE_METHODS.has(input.captureMethod)) throw new Error(`Unsupported qualification capture method '${String(input.captureMethod)}'.`);
  if (input.qualificationUse === 'benchmark-gold' && input.captureMethod === 'content-hash-verification') {
    throw new Error('Benchmark-gold byte sources must be durably content-addressed; hash-only verification is supporting evidence, not archived gold.');
  }
  const sourceIdentities = input.sourceIdentities.map(normalizeIdentity)
    .sort((a, b) => scientificContentHash(a).localeCompare(scientificContentHash(b)));
  const selectedPaths = input.selectedPaths
    ? [...new Set(input.selectedPaths.map((path) => path.trim()).filter(Boolean))].sort()
    : undefined;
  const base = {
    schemaVersion: SR_QUALIFICATION_SOURCE_CAPTURE_SCHEMA_VERSION,
    candidateId: input.candidateId.trim(),
    component: input.component,
    sourceIdentities,
    ...(selectedPaths && selectedPaths.length > 0 ? { selectedPaths } : {}),
    ...(input.sourceRole ? { sourceRole: input.sourceRole } : {}),
    ...(input.qualificationUse ? { qualificationUse: input.qualificationUse } : {}),
    capturedAt: input.capturedAt,
    captureMethod: input.captureMethod,
  };
  return { ...base, captureHash: scientificContentHash(base) };
}

export function verifySrQualificationSourceCapture(capture: SrQualificationSourceCapture): string[] {
  const errors: string[] = [];
  try {
    const { schemaVersion: _schemaVersion, captureHash: _captureHash, ...input } = capture;
    if (capture.schemaVersion !== SR_QUALIFICATION_SOURCE_CAPTURE_SCHEMA_VERSION) errors.push('Unsupported qualification source-capture schema.');
    if (createSrQualificationSourceCapture(input).captureHash !== capture.captureHash) errors.push('Qualification source-capture hash mismatch.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

function verifiedGoldCapture(capture: SrQualificationSourceCapture): SrQualificationSourceCapture {
  const errors = verifySrQualificationSourceCapture(capture);
  if (errors.length > 0) throw new Error(`Invalid qualification source capture: ${errors.join(' ')}`);
  if (capture.qualificationUse !== 'benchmark-gold') {
    throw new Error('Qualification source capture must be explicitly benchmark-gold before it can mint a benchmark qualification asset receipt.');
  }
  return capture;
}

/**
 * Canonical receipt-minting path for a component whose scientific gold spans one or more
 * immutable sources. All captures must independently validate, be explicitly benchmark-gold,
 * and belong to exactly the same candidate/component. Source identities and capture hashes
 * are inherited from those captures rather than supplied by the caller.
 */
export function createSrQualificationAssetReceiptFromCaptures(
  input: SrQualificationAssetReceiptFromCapturesInput,
): SrQualificationAssetReceipt {
  const { captures: rawCaptures, ...receiptInput } = input;
  if (rawCaptures.length === 0) throw new Error('Qualification asset receipt requires at least one benchmark-gold source capture.');
  const byHash = new Map<string, SrQualificationSourceCapture>();
  for (const raw of rawCaptures) {
    const capture = verifiedGoldCapture(raw);
    const existing = byHash.get(capture.captureHash);
    if (existing && scientificContentHash(existing) !== scientificContentHash(capture)) {
      throw new Error(`Qualification source capture hash collision detected for '${capture.captureHash}'.`);
    }
    byHash.set(capture.captureHash, capture);
  }
  const captures = [...byHash.values()].sort((a, b) => a.captureHash.localeCompare(b.captureHash));
  const candidateId = captures[0]!.candidateId;
  const component = captures[0]!.component;
  if (captures.some((capture) => capture.candidateId !== candidateId || capture.component !== component)) {
    throw new Error('Qualification asset receipt source captures must all belong to the same candidate and component.');
  }
  const identityMap = new Map<string, SrQualificationSourceIdentity>();
  for (const capture of captures) {
    for (const identity of capture.sourceIdentities) identityMap.set(identityKey(identity), normalizeIdentity(identity));
  }
  const sourceIdentities = [...identityMap.values()]
    .sort((a, b) => scientificContentHash(a).localeCompare(scientificContentHash(b)));
  return createSrQualificationAssetReceipt({
    ...receiptInput,
    candidateId,
    component,
    sourceIdentities,
    sourceCaptureHashes: captures.map((capture) => capture.captureHash),
  });
}

/** Convenience wrapper for the common one-capture case. */
export function createSrQualificationAssetReceiptFromCapture(
  input: SrQualificationAssetReceiptFromCaptureInput,
): SrQualificationAssetReceipt {
  const { capture, ...receiptInput } = input;
  return createSrQualificationAssetReceiptFromCaptures({ ...receiptInput, captures: [capture] });
}

export function applySrQualificationSourceCapture(input: {
  candidate: SrQualificationCandidateInput;
  capture: SrQualificationSourceCapture;
}): SrQualificationCandidateInput {
  const errors = verifySrQualificationSourceCapture(input.capture);
  if (errors.length > 0) throw new Error(`Invalid qualification source capture: ${errors.join(' ')}`);
  if (input.capture.candidateId !== input.candidate.candidateId) throw new Error('Qualification source capture belongs to another candidate.');
  if (input.capture.qualificationUse !== 'benchmark-gold') {
    throw new Error('Only an explicitly benchmark-gold source capture can upgrade a benchmark qualification component.');
  }
  const current = input.candidate.assets[input.capture.component];
  if (!current) throw new Error(`Qualification candidate has no component '${input.capture.component}'.`);
  if (current.status === 'frozen-verified') throw new Error('Qualification source capture cannot downgrade an already verified component.');
  if (current.basis === 'published-aggregate' || current.basis === 'not-available') {
    throw new Error('Immutable source capture cannot upgrade aggregate-only/unavailable evidence without first establishing original-artifact or source-reconstructed basis.');
  }
  const references = [...new Set([
    ...(current.references ?? []),
    ...input.capture.sourceIdentities.map((identity) => identity.kind === 'git-commit'
      ? `${identity.repository}@${identity.commit}`
      : identity.objectId),
    `capture:${input.capture.captureHash}`,
  ])].sort();
  const provenanceNote = input.capture.sourceRole ? `Captured source role: ${input.capture.sourceRole}.` : undefined;
  const updated = structuredClone(input.candidate);
  updated.assets[input.capture.component] = {
    ...current,
    status: 'frozen-unverified',
    references,
    notes: [...new Set([
      ...(current.notes ?? []),
      'Immutable source captured; independent scientific verification remains required.',
      ...(provenanceNote ? [provenanceNote] : []),
    ])].sort(),
  };
  createSrQualificationCandidate(updated);
  return updated;
}
