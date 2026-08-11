import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrQualificationTrustRegistry } from './sr-qualification-signatures.js';

export const SR_QUALIFICATION_TRUST_ROOT_SCHEMA_VERSION = 'medantir-sr-qualification-trust-root/1' as const;

export type SrTrustRootAnchorKind = 'release-tag' | 'transparency-log' | 'institutional-policy' | 'offline-config';

export interface SrQualificationTrustRootAnchor {
  kind: SrTrustRootAnchorKind;
  anchorId: string;
  committedPayloadHash: string;
  anchorReceiptHash: string;
  anchoredAt: string;
}

export interface SrQualificationTrustRoot {
  schemaVersion: typeof SR_QUALIFICATION_TRUST_ROOT_SCHEMA_VERSION;
  rootId: string;
  rootVersion: string;
  trustedRegistryHash: string;
  effectiveFrom: string;
  previousRootHash?: string;
  rootPayloadHash: string;
  anchor: SrQualificationTrustRootAnchor;
  rootHash: string;
}

export interface SrQualificationTrustRootVerification {
  valid: boolean;
  registryTrusted: boolean;
  errors: string[];
  verificationHash: string;
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid date-time.`);
  return parsed;
}

function clean(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function rootPayload(input: {
  rootId: string;
  rootVersion: string;
  trustedRegistryHash: string;
  effectiveFrom: string;
  previousRootHash?: string;
}) {
  return {
    rootId: clean(input.rootId, 'Trust rootId'),
    rootVersion: clean(input.rootVersion, 'Trust rootVersion'),
    trustedRegistryHash: sha(input.trustedRegistryHash, 'Trust root trustedRegistryHash'),
    effectiveFrom: input.effectiveFrom,
    ...(input.previousRootHash ? { previousRootHash: sha(input.previousRootHash, 'Trust root previousRootHash') } : {}),
  };
}

export function createSrQualificationTrustRoot(input: Omit<SrQualificationTrustRoot, 'schemaVersion' | 'rootPayloadHash' | 'rootHash'>): SrQualificationTrustRoot {
  const effective = instant(input.effectiveFrom, 'Trust root effectiveFrom');
  const payload = rootPayload(input);
  const rootPayloadHash = scientificContentHash(payload);
  const anchor = {
    kind: input.anchor.kind,
    anchorId: clean(input.anchor.anchorId, 'Trust root anchorId'),
    committedPayloadHash: sha(input.anchor.committedPayloadHash, 'Trust root committedPayloadHash'),
    anchorReceiptHash: sha(input.anchor.anchorReceiptHash, 'Trust root anchorReceiptHash'),
    anchoredAt: input.anchor.anchoredAt,
  };
  const anchored = instant(anchor.anchoredAt, 'Trust root anchoredAt');
  if (anchor.committedPayloadHash !== rootPayloadHash) throw new Error('Trust root anchor does not commit to the current root payload hash.');
  if (anchored > effective) throw new Error('Trust root cannot become effective before its external anchor exists.');
  const base = {
    schemaVersion: SR_QUALIFICATION_TRUST_ROOT_SCHEMA_VERSION,
    ...payload,
    rootPayloadHash,
    anchor,
  };
  return { ...base, rootHash: scientificContentHash(base) };
}

export function verifySrQualificationTrustRoot(input: {
  root: SrQualificationTrustRoot;
  registry: SrQualificationTrustRegistry;
  expectedRootHash?: string;
  now?: string;
}): SrQualificationTrustRootVerification {
  const errors: string[] = [];
  let rebuilt: SrQualificationTrustRoot | undefined;
  try {
    const { schemaVersion: _schema, rootPayloadHash: _payloadHash, rootHash: _rootHash, ...rootInput } = input.root;
    if (input.root.schemaVersion !== SR_QUALIFICATION_TRUST_ROOT_SCHEMA_VERSION) errors.push('Unsupported trust-root schema.');
    rebuilt = createSrQualificationTrustRoot(rootInput);
    if (rebuilt.rootPayloadHash !== input.root.rootPayloadHash) errors.push('Trust-root payload hash mismatch.');
    if (rebuilt.rootHash !== input.root.rootHash) errors.push('Trust-root hash mismatch.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (input.expectedRootHash) {
    try {
      if (sha(input.expectedRootHash, 'Expected trust-root hash') !== input.root.rootHash) errors.push('Trust root does not match the externally pinned expected root hash.');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (input.registry.registryHash !== input.root.trustedRegistryHash) errors.push('Active verifier registry hash is not authorized by the trust root.');
  const now = instant(input.now ?? new Date().toISOString(), 'Trust-root verification now');
  const effective = instant(input.root.effectiveFrom, 'Trust-root effectiveFrom');
  if (now < effective) errors.push('Trust root is not effective yet.');
  const registryTrusted = input.registry.registryHash === input.root.trustedRegistryHash;
  const base = {
    valid: errors.length === 0,
    registryTrusted,
    errors: [...new Set(errors)].sort(),
    rootHash: input.root.rootHash,
    registryHash: input.registry.registryHash,
    rebuiltRootHash: rebuilt?.rootHash ?? null,
  };
  return { valid: base.valid, registryTrusted, errors: base.errors, verificationHash: scientificContentHash(base) };
}
