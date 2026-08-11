import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { createSrQualificationTrustRegistry } from '../src/benchmark/sr-qualification-signatures.js';
import {
  createSrQualificationTrustRoot,
  verifySrQualificationTrustRoot,
} from '../src/benchmark/sr-qualification-trust-root.js';

function registry(id = 'TRUST') {
  const keys = ['A', 'B'].map((suffix) => {
    const pair = generateKeyPairSync('ed25519');
    return {
      keyId: `${id}-${suffix}`,
      algorithm: 'ed25519' as const,
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      status: 'active' as const,
      scopes: ['qualification-candidate' as const],
      validFrom: '2026-01-01T00:00:00Z',
      organization: `Org-${suffix}`,
    };
  });
  return createSrQualificationTrustRegistry({
    registryId: id,
    registryVersion: '1',
    minimumDistinctSigners: 2,
    keys,
  });
}

function rootFor(registryHash: string) {
  const payload = {
    rootId: 'ROOT',
    rootVersion: '1',
    trustedRegistryHash: registryHash,
    effectiveFrom: '2026-08-10T18:00:00Z',
  };
  const payloadHash = scientificContentHash(payload);
  return createSrQualificationTrustRoot({
    ...payload,
    anchor: {
      kind: 'transparency-log',
      anchorId: 'log-entry-123',
      committedPayloadHash: payloadHash,
      anchorReceiptHash: 'a'.repeat(64),
      anchoredAt: '2026-08-10T17:59:00Z',
    },
  });
}

test('externally pinned trust root authorizes exactly its committed verifier registry', () => {
  const r = registry();
  const root = rootFor(r.registryHash);
  const verification = verifySrQualificationTrustRoot({
    root,
    registry: r,
    expectedRootHash: root.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.registryTrusted, true);
  assert.deepEqual(verification.errors, []);
});

test('repository editor cannot replace verifier registry without breaking the pinned trust root', () => {
  const trusted = registry('TRUSTED');
  const attacker = registry('ATTACKER');
  const root = rootFor(trusted.registryHash);
  const verification = verifySrQualificationTrustRoot({
    root,
    registry: attacker,
    expectedRootHash: root.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(verification.valid, false);
  assert.equal(verification.registryTrusted, false);
  assert.ok(verification.errors.some((error) => /not authorized by the trust root/i.test(error)));
});

test('recomputed replacement root still fails when caller pins the previously approved root hash', () => {
  const trusted = registry('TRUSTED');
  const attacker = registry('ATTACKER');
  const approved = rootFor(trusted.registryHash);
  const replacement = rootFor(attacker.registryHash);
  const verification = verifySrQualificationTrustRoot({
    root: replacement,
    registry: attacker,
    expectedRootHash: approved.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => /externally pinned expected root hash/i.test(error)));
});

test('anchor must commit to the exact trust-root payload and exist before effective time', () => {
  const r = registry();
  assert.throws(() => createSrQualificationTrustRoot({
    rootId: 'ROOT',
    rootVersion: '1',
    trustedRegistryHash: r.registryHash,
    effectiveFrom: '2026-08-10T18:00:00Z',
    anchor: {
      kind: 'transparency-log',
      anchorId: 'bad',
      committedPayloadHash: 'f'.repeat(64),
      anchorReceiptHash: 'a'.repeat(64),
      anchoredAt: '2026-08-10T17:59:00Z',
    },
  }), /does not commit to the current root payload/i);

  const payload = {
    rootId: 'ROOT',
    rootVersion: '1',
    trustedRegistryHash: r.registryHash,
    effectiveFrom: '2026-08-10T18:00:00Z',
  };
  assert.throws(() => createSrQualificationTrustRoot({
    ...payload,
    anchor: {
      kind: 'transparency-log',
      anchorId: 'late',
      committedPayloadHash: scientificContentHash(payload),
      anchorReceiptHash: 'a'.repeat(64),
      anchoredAt: '2026-08-10T18:01:00Z',
    },
  }), /cannot become effective before its external anchor/i);
});
