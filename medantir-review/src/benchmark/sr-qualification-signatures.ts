import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrQualificationCandidateVerificationReceipt } from './sr-qualification-corpus.js';

export const SR_QUALIFICATION_TRUST_REGISTRY_SCHEMA_VERSION = 'medantir-sr-qualification-trust-registry/1' as const;
export const SR_QUALIFICATION_SIGNATURE_SCHEMA_VERSION = 'medantir-sr-qualification-signature/1' as const;

export type SrQualificationVerifierScope = 'qualification-candidate';
export type SrQualificationVerifierKeyStatus = 'active' | 'revoked' | 'retired';

export interface SrQualificationVerifierKey {
  keyId: string;
  algorithm: 'ed25519';
  publicKeyPem: string;
  status: SrQualificationVerifierKeyStatus;
  scopes: SrQualificationVerifierScope[];
  validFrom: string;
  validUntil?: string;
  organization?: string;
}

export interface SrQualificationTrustRegistry {
  schemaVersion: typeof SR_QUALIFICATION_TRUST_REGISTRY_SCHEMA_VERSION;
  registryId: string;
  registryVersion: string;
  minimumDistinctSigners: number;
  keys: SrQualificationVerifierKey[];
  registryHash: string;
}

export interface SrQualificationReceiptSignature {
  schemaVersion: typeof SR_QUALIFICATION_SIGNATURE_SCHEMA_VERSION;
  receiptHash: string;
  candidateId: string;
  keyId: string;
  algorithm: 'ed25519';
  signedAt: string;
  signatureBase64: string;
  signatureEnvelopeHash: string;
}

export interface SrQualificationSignatureVerification {
  valid: boolean;
  trustedSigners: string[];
  invalidSignatures: Array<{ keyId: string; reason: string }>;
  requiredDistinctSigners: number;
  verificationHash: string;
}

function cleanArray(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function assertSha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function parseTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid date-time.`);
  return parsed;
}

function canonicalKey(key: SrQualificationVerifierKey): SrQualificationVerifierKey {
  if (!key.keyId.trim()) throw new Error('Qualification verifier key requires keyId.');
  if (key.algorithm !== 'ed25519') throw new Error(`Unsupported qualification verifier algorithm '${key.algorithm}'.`);
  if (!key.publicKeyPem.trim()) throw new Error(`Qualification verifier key '${key.keyId}' requires a public key.`);
  const scopes = cleanArray(key.scopes) as SrQualificationVerifierScope[];
  if (scopes.length === 0) throw new Error(`Qualification verifier key '${key.keyId}' requires at least one scope.`);
  const validFrom = parseTime(key.validFrom, `${key.keyId} validFrom`);
  if (key.validUntil) {
    const validUntil = parseTime(key.validUntil, `${key.keyId} validUntil`);
    if (validUntil <= validFrom) throw new Error(`Qualification verifier key '${key.keyId}' validUntil must be after validFrom.`);
  }
  try {
    const parsed = createPublicKey(key.publicKeyPem);
    if (parsed.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
  } catch (error) {
    throw new Error(`Qualification verifier key '${key.keyId}' has invalid Ed25519 public key: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    keyId: key.keyId.trim(),
    algorithm: 'ed25519',
    publicKeyPem: key.publicKeyPem.trim(),
    status: key.status,
    scopes,
    validFrom: key.validFrom,
    ...(key.validUntil ? { validUntil: key.validUntil } : {}),
    ...(key.organization?.trim() ? { organization: key.organization.trim() } : {}),
  };
}

export function createSrQualificationTrustRegistry(input: Omit<SrQualificationTrustRegistry, 'schemaVersion' | 'registryHash'>): SrQualificationTrustRegistry {
  if (!input.registryId.trim() || !input.registryVersion.trim()) throw new Error('Qualification trust registry requires ID/version.');
  if (!Number.isInteger(input.minimumDistinctSigners) || input.minimumDistinctSigners < 1) throw new Error('Qualification trust registry requires minimumDistinctSigners >= 1.');
  const keys = input.keys.map(canonicalKey).sort((a, b) => a.keyId.localeCompare(b.keyId));
  const duplicate = keys.find((key, index) => keys.findIndex((item) => item.keyId === key.keyId) !== index);
  if (duplicate) throw new Error(`Qualification trust registry duplicates keyId '${duplicate.keyId}'.`);
  if (keys.filter((key) => key.status === 'active' && key.scopes.includes('qualification-candidate')).length < input.minimumDistinctSigners) {
    throw new Error('Qualification trust registry has fewer active qualification-candidate keys than its quorum requirement.');
  }
  const base = {
    schemaVersion: SR_QUALIFICATION_TRUST_REGISTRY_SCHEMA_VERSION,
    registryId: input.registryId.trim(),
    registryVersion: input.registryVersion.trim(),
    minimumDistinctSigners: input.minimumDistinctSigners,
    keys,
  };
  return { ...base, registryHash: scientificContentHash(base) };
}

function signaturePayload(input: {
  receiptHash: string;
  candidateId: string;
  keyId: string;
  signedAt: string;
}): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'MEDANTIR-SR-QUALIFICATION-CANDIDATE',
    receiptHash: assertSha(input.receiptHash, 'Qualification signature receiptHash'),
    candidateId: input.candidateId.trim(),
    keyId: input.keyId.trim(),
    signedAt: input.signedAt,
  }), 'utf8');
}

function signatureEnvelopeIdentity(signature: Omit<SrQualificationReceiptSignature, 'signatureEnvelopeHash'>): unknown {
  return signature;
}

export function createSrQualificationReceiptSignatureEnvelope(input: Omit<SrQualificationReceiptSignature, 'schemaVersion' | 'signatureEnvelopeHash'>): SrQualificationReceiptSignature {
  if (!input.candidateId.trim() || !input.keyId.trim()) throw new Error('Qualification signature requires candidateId and keyId.');
  if (input.algorithm !== 'ed25519') throw new Error(`Unsupported qualification signature algorithm '${input.algorithm}'.`);
  parseTime(input.signedAt, 'Qualification signature signedAt');
  assertSha(input.receiptHash, 'Qualification signature receiptHash');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.signatureBase64.trim())) throw new Error('Qualification signature must be base64 encoded.');
  const base = {
    schemaVersion: SR_QUALIFICATION_SIGNATURE_SCHEMA_VERSION,
    receiptHash: input.receiptHash.toLowerCase(),
    candidateId: input.candidateId.trim(),
    keyId: input.keyId.trim(),
    algorithm: 'ed25519' as const,
    signedAt: input.signedAt,
    signatureBase64: input.signatureBase64.trim(),
  };
  return { ...base, signatureEnvelopeHash: scientificContentHash(signatureEnvelopeIdentity(base)) };
}

function keyUsableAt(key: SrQualificationVerifierKey, signedAt: string): string | null {
  if (key.status !== 'active') return `Verifier key status is '${key.status}', not active.`;
  if (!key.scopes.includes('qualification-candidate')) return 'Verifier key lacks qualification-candidate scope.';
  const signed = parseTime(signedAt, 'signature signedAt');
  const from = parseTime(key.validFrom, `${key.keyId} validFrom`);
  if (signed < from) return 'Signature predates verifier key validity.';
  if (key.validUntil && signed >= parseTime(key.validUntil, `${key.keyId} validUntil`)) return 'Signature is outside verifier key validity window.';
  return null;
}

export function verifySrQualificationReceiptSignatures(input: {
  receipt: SrQualificationCandidateVerificationReceipt;
  signatures: SrQualificationReceiptSignature[];
  registry: SrQualificationTrustRegistry;
}): SrQualificationSignatureVerification {
  const registry = createSrQualificationTrustRegistry({
    registryId: input.registry.registryId,
    registryVersion: input.registry.registryVersion,
    minimumDistinctSigners: input.registry.minimumDistinctSigners,
    keys: input.registry.keys,
  });
  if (registry.registryHash !== input.registry.registryHash) throw new Error('Qualification trust registry hash mismatch.');
  const invalidSignatures: Array<{ keyId: string; reason: string }> = [];
  const trusted = new Set<string>();
  const seenEnvelopeHashes = new Set<string>();
  for (const raw of input.signatures) {
    let signature: SrQualificationReceiptSignature;
    try {
      const { schemaVersion: _schema, signatureEnvelopeHash: _hash, ...unsigned } = raw;
      if (raw.schemaVersion !== SR_QUALIFICATION_SIGNATURE_SCHEMA_VERSION) throw new Error('Unsupported signature schema.');
      signature = createSrQualificationReceiptSignatureEnvelope(unsigned);
      if (signature.signatureEnvelopeHash !== raw.signatureEnvelopeHash) throw new Error('Signature envelope hash mismatch.');
    } catch (error) {
      invalidSignatures.push({ keyId: raw.keyId ?? 'unknown', reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (seenEnvelopeHashes.has(signature.signatureEnvelopeHash)) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Duplicate signature envelope.' });
      continue;
    }
    seenEnvelopeHashes.add(signature.signatureEnvelopeHash);
    if (signature.receiptHash !== input.receipt.receiptHash || signature.candidateId !== input.receipt.candidateId) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Signature is bound to a different qualification receipt/candidate.' });
      continue;
    }
    const key = registry.keys.find((item) => item.keyId === signature.keyId);
    if (!key) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Signer key is absent from the trusted registry.' });
      continue;
    }
    const unusable = keyUsableAt(key, signature.signedAt);
    if (unusable) {
      invalidSignatures.push({ keyId: signature.keyId, reason: unusable });
      continue;
    }
    let valid = false;
    try {
      valid = verifySignature(
        null,
        signaturePayload({ receiptHash: signature.receiptHash, candidateId: signature.candidateId, keyId: signature.keyId, signedAt: signature.signedAt }),
        createPublicKey(key.publicKeyPem),
        Buffer.from(signature.signatureBase64, 'base64'),
      );
    } catch (error) {
      invalidSignatures.push({ keyId: signature.keyId, reason: `Signature verification error: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!valid) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Ed25519 signature is invalid.' });
      continue;
    }
    if (trusted.has(signature.keyId)) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Duplicate signer does not increase quorum.' });
      continue;
    }
    trusted.add(signature.keyId);
  }
  const trustedSigners = [...trusted].sort();
  const base = {
    valid: trustedSigners.length >= registry.minimumDistinctSigners,
    trustedSigners,
    invalidSignatures: invalidSignatures.sort((a, b) => `${a.keyId}:${a.reason}`.localeCompare(`${b.keyId}:${b.reason}`)),
    requiredDistinctSigners: registry.minimumDistinctSigners,
    receiptHash: input.receipt.receiptHash,
    registryHash: registry.registryHash,
  };
  return {
    valid: base.valid,
    trustedSigners: base.trustedSigners,
    invalidSignatures: base.invalidSignatures,
    requiredDistinctSigners: base.requiredDistinctSigners,
    verificationHash: scientificContentHash(base),
  };
}
