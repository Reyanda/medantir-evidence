import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrQualificationTrustRegistry } from './sr-qualification-signatures.js';
import type { SrQualifiedCaseBinding } from './sr-qualified-case-binding.js';

export const SR_QUALIFIED_CASE_CERTIFICATION_SCHEMA_VERSION = 'medantir-sr-qualified-case-certification/1' as const;
export const SR_QUALIFIED_CASE_SIGNATURE_SCHEMA_VERSION = 'medantir-sr-qualified-case-signature/1' as const;

export type SrQualifiedCaseVerificationBasis = 'independent-stage-reconciliation' | 'dual-independent-audit';

export interface SrQualifiedCaseCertificationReceipt {
  schemaVersion: typeof SR_QUALIFIED_CASE_CERTIFICATION_SCHEMA_VERSION;
  caseId: string;
  caseHash: string;
  candidateId: string;
  candidateHash: string;
  bindingHash: string;
  stageBindingHashes: string[];
  verificationBasis: SrQualifiedCaseVerificationBasis;
  verifierProcessId: string;
  verifiedAt: string;
  receiptHash: string;
}

export interface SrQualifiedCaseSignature {
  schemaVersion: typeof SR_QUALIFIED_CASE_SIGNATURE_SCHEMA_VERSION;
  receiptHash: string;
  caseId: string;
  candidateId: string;
  keyId: string;
  signedAt: string;
  signatureBase64: string;
  envelopeHash: string;
}

export interface SrQualifiedCaseCertificationVerification {
  valid: boolean;
  receiptValid: boolean;
  trustedSigners: string[];
  trustedOrganizations: string[];
  invalidSignatures: Array<{ keyId: string; reason: string }>;
  verificationHash: string;
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function time(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid date-time.`);
  return parsed;
}

function clean(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function validBasis(value: string): value is SrQualifiedCaseVerificationBasis {
  return value === 'independent-stage-reconciliation' || value === 'dual-independent-audit';
}

export function createSrQualifiedCaseCertificationReceipt(input: {
  binding: SrQualifiedCaseBinding;
  verificationBasis: SrQualifiedCaseVerificationBasis;
  verifierProcessId: string;
  verifiedAt: string;
}): SrQualifiedCaseCertificationReceipt {
  if (!validBasis(input.verificationBasis)) throw new Error(`Unsupported qualified-case verification basis '${input.verificationBasis}'.`);
  time(input.verifiedAt, 'Qualified-case certification verifiedAt');
  if (input.binding.stageBindings.length !== 10) throw new Error('Qualified-case certification requires all ten systematic-review stage bindings.');
  const stageBindingHashes = input.binding.stageBindings.map((stage) => sha(stage.stageBindingHash, `Qualified-case ${stage.stage} binding hash`)).sort();
  if (new Set(stageBindingHashes).size !== 10) throw new Error('Qualified-case certification contains duplicate stage binding hashes.');
  const base = {
    schemaVersion: SR_QUALIFIED_CASE_CERTIFICATION_SCHEMA_VERSION,
    caseId: clean(input.binding.caseId, 'Qualified-case caseId'),
    caseHash: sha(input.binding.caseHash, 'Qualified-case caseHash'),
    candidateId: clean(input.binding.candidateId, 'Qualified-case candidateId'),
    candidateHash: sha(input.binding.candidateHash, 'Qualified-case candidateHash'),
    bindingHash: sha(input.binding.bindingHash, 'Qualified-case bindingHash'),
    stageBindingHashes,
    verificationBasis: input.verificationBasis,
    verifierProcessId: clean(input.verifierProcessId, 'Qualified-case verifierProcessId'),
    verifiedAt: input.verifiedAt,
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}

function signaturePayload(input: {
  receiptHash: string;
  caseId: string;
  candidateId: string;
  keyId: string;
  signedAt: string;
}): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'MEDANTIR-SR-QUALIFIED-BENCHMARK-CASE',
    receiptHash: sha(input.receiptHash, 'Qualified-case signature receiptHash'),
    caseId: clean(input.caseId, 'Qualified-case signature caseId'),
    candidateId: clean(input.candidateId, 'Qualified-case signature candidateId'),
    keyId: clean(input.keyId, 'Qualified-case signature keyId'),
    signedAt: input.signedAt,
  }), 'utf8');
}

export function createSrQualifiedCaseSignatureEnvelope(input: Omit<SrQualifiedCaseSignature, 'schemaVersion' | 'envelopeHash'>): SrQualifiedCaseSignature {
  time(input.signedAt, 'Qualified-case signature signedAt');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.signatureBase64.trim())) throw new Error('Qualified-case signature must be base64 encoded.');
  const base = {
    schemaVersion: SR_QUALIFIED_CASE_SIGNATURE_SCHEMA_VERSION,
    receiptHash: sha(input.receiptHash, 'Qualified-case signature receiptHash'),
    caseId: clean(input.caseId, 'Qualified-case signature caseId'),
    candidateId: clean(input.candidateId, 'Qualified-case signature candidateId'),
    keyId: clean(input.keyId, 'Qualified-case signature keyId'),
    signedAt: input.signedAt,
    signatureBase64: input.signatureBase64.trim(),
  };
  return { ...base, envelopeHash: scientificContentHash(base) };
}

function rebuildCertification(receipt: SrQualifiedCaseCertificationReceipt): SrQualifiedCaseCertificationReceipt {
  if (receipt.schemaVersion !== SR_QUALIFIED_CASE_CERTIFICATION_SCHEMA_VERSION) throw new Error('Unsupported qualified-case certification schema.');
  if (!validBasis(receipt.verificationBasis)) throw new Error('Unsupported qualified-case verification basis.');
  time(receipt.verifiedAt, 'Qualified-case certification verifiedAt');
  const base = {
    schemaVersion: SR_QUALIFIED_CASE_CERTIFICATION_SCHEMA_VERSION,
    caseId: clean(receipt.caseId, 'Qualified-case caseId'),
    caseHash: sha(receipt.caseHash, 'Qualified-case caseHash'),
    candidateId: clean(receipt.candidateId, 'Qualified-case candidateId'),
    candidateHash: sha(receipt.candidateHash, 'Qualified-case candidateHash'),
    bindingHash: sha(receipt.bindingHash, 'Qualified-case bindingHash'),
    stageBindingHashes: [...receipt.stageBindingHashes].map((hash) => sha(hash, 'Qualified-case stage binding hash')).sort(),
    verificationBasis: receipt.verificationBasis,
    verifierProcessId: clean(receipt.verifierProcessId, 'Qualified-case verifierProcessId'),
    verifiedAt: receipt.verifiedAt,
  };
  const expected = scientificContentHash(base);
  if (expected !== receipt.receiptHash) throw new Error('Qualified-case certification receipt hash mismatch.');
  return { ...base, receiptHash: expected };
}

export function verifySrQualifiedCaseCertification(input: {
  binding: SrQualifiedCaseBinding;
  receipt: SrQualifiedCaseCertificationReceipt;
  signatures: SrQualifiedCaseSignature[];
  registry: SrQualificationTrustRegistry;
  minimumDistinctOrganizations?: number;
}): SrQualifiedCaseCertificationVerification {
  const invalidSignatures: Array<{ keyId: string; reason: string }> = [];
  let receipt: SrQualifiedCaseCertificationReceipt;
  try {
    receipt = rebuildCertification(input.receipt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const base = { valid: false, receiptValid: false, trustedSigners: [], trustedOrganizations: [], invalidSignatures: [{ keyId: 'receipt', reason }] };
    return { ...base, verificationHash: scientificContentHash(base) };
  }
  const receiptValid = receipt.bindingHash === input.binding.bindingHash
    && receipt.caseHash === input.binding.caseHash
    && receipt.candidateHash === input.binding.candidateHash
    && receipt.caseId === input.binding.caseId
    && receipt.candidateId === input.binding.candidateId
    && scientificContentHash(receipt.stageBindingHashes) === scientificContentHash(input.binding.stageBindings.map((stage) => stage.stageBindingHash).sort());
  if (!receiptValid) invalidSignatures.push({ keyId: 'receipt', reason: 'Qualified-case certification does not reconcile to the supplied stage binding.' });

  const trusted = new Set<string>();
  const organizations = new Set<string>();
  const seen = new Set<string>();
  for (const raw of input.signatures) {
    let signature: SrQualifiedCaseSignature;
    try {
      const { schemaVersion: _schema, envelopeHash: _hash, ...body } = raw;
      if (raw.schemaVersion !== SR_QUALIFIED_CASE_SIGNATURE_SCHEMA_VERSION) throw new Error('Unsupported qualified-case signature schema.');
      signature = createSrQualifiedCaseSignatureEnvelope(body);
      if (signature.envelopeHash !== raw.envelopeHash) throw new Error('Qualified-case signature envelope hash mismatch.');
    } catch (error) {
      invalidSignatures.push({ keyId: raw.keyId ?? 'unknown', reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (seen.has(signature.envelopeHash)) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Duplicate qualified-case signature envelope.' });
      continue;
    }
    seen.add(signature.envelopeHash);
    if (signature.receiptHash !== receipt.receiptHash || signature.caseId !== receipt.caseId || signature.candidateId !== receipt.candidateId) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Qualified-case signature is bound to a different certification receipt.' });
      continue;
    }
    if (time(signature.signedAt, 'Qualified-case signature signedAt') < time(receipt.verifiedAt, 'Qualified-case certification verifiedAt')) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Qualified-case signature predates the certification receipt.' });
      continue;
    }
    const key = input.registry.keys.find((candidate) => candidate.keyId === signature.keyId);
    if (!key) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Signer key is absent from the qualification trust registry.' });
      continue;
    }
    if (key.status !== 'active' || !key.scopes.includes('qualification-candidate')) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Signer key is not active for qualification-candidate scope.' });
      continue;
    }
    const signed = time(signature.signedAt, 'Qualified-case signature signedAt');
    if (signed < time(key.validFrom, `${key.keyId} validFrom`) || (key.validUntil && signed >= time(key.validUntil, `${key.keyId} validUntil`))) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Qualified-case signature is outside signer key validity.' });
      continue;
    }
    let valid = false;
    try {
      valid = verifySignature(
        null,
        signaturePayload({
          receiptHash: signature.receiptHash,
          caseId: signature.caseId,
          candidateId: signature.candidateId,
          keyId: signature.keyId,
          signedAt: signature.signedAt,
        }),
        createPublicKey(key.publicKeyPem),
        Buffer.from(signature.signatureBase64, 'base64'),
      );
    } catch (error) {
      invalidSignatures.push({ keyId: signature.keyId, reason: `Qualified-case signature verification error: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!valid) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Qualified-case Ed25519 signature is invalid.' });
      continue;
    }
    if (trusted.has(signature.keyId)) {
      invalidSignatures.push({ keyId: signature.keyId, reason: 'Duplicate qualified-case signer does not increase quorum.' });
      continue;
    }
    trusted.add(signature.keyId);
    organizations.add(key.organization?.trim() || `key:${key.keyId}`);
  }
  const minimumDistinctOrganizations = input.minimumDistinctOrganizations ?? 2;
  if (!Number.isInteger(minimumDistinctOrganizations) || minimumDistinctOrganizations < 1) throw new Error('Qualified-case certification minimumDistinctOrganizations must be >=1.');
  const trustedSigners = [...trusted].sort();
  const trustedOrganizations = [...organizations].sort();
  const valid = receiptValid
    && trustedSigners.length >= input.registry.minimumDistinctSigners
    && trustedOrganizations.length >= minimumDistinctOrganizations;
  const base = {
    valid,
    receiptValid,
    trustedSigners,
    trustedOrganizations,
    invalidSignatures: invalidSignatures.sort((a, b) => `${a.keyId}:${a.reason}`.localeCompare(`${b.keyId}:${b.reason}`)),
    receiptHash: receipt.receiptHash,
    bindingHash: input.binding.bindingHash,
    registryHash: input.registry.registryHash,
    minimumDistinctOrganizations,
  };
  return { ...base, verificationHash: scientificContentHash(base) };
}
