import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { scientificContentHash } from '../src/core/canonical-hash.js';
import { createSrDeploymentAuthorizationSeal } from '../src/benchmark/sr-deployment-authorization.js';
import { createSrQualificationTrustRegistry } from '../src/benchmark/sr-qualification-signatures.js';
import { createSrQualificationTrustRoot } from '../src/benchmark/sr-qualification-trust-root.js';
import type { SrReliabilityAuthorizationSeal } from '../src/benchmark/sr-reliability-authorization.js';

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
  return createSrQualificationTrustRoot({
    ...payload,
    anchor: {
      kind: 'transparency-log',
      anchorId: 'external-log-1',
      committedPayloadHash: scientificContentHash(payload),
      anchorReceiptHash: 'a'.repeat(64),
      anchoredAt: '2026-08-10T17:59:00Z',
    },
  });
}

function evidence(tier: 'prospective-pilot-only' | 'high-confidence-future-review' | 'high-confidence-living-review'): SrReliabilityAuthorizationSeal {
  return {
    schemaVersion: 'medantir-sr-reliability-authorization/1',
    prospectiveAuthorizationSealHash: '1'.repeat(64),
    reliabilityReportHashes: ['2'.repeat(64)],
    authorizations: [{
      requestedModel: 'model-a',
      prospectiveAuthorizationTier: tier === 'high-confidence-living-review' ? 'supervised-living-review' : 'supervised-future-review',
      reliabilityEvidenceTier: tier === 'prospective-pilot-only' ? 'prospective-validated' : tier === 'high-confidence-future-review' ? 'high-confidence-future' : 'high-confidence-living',
      reliabilityLowerBound: tier === 'prospective-pilot-only' ? 0.776 : tier === 'high-confidence-future-review' ? 0.902 : 0.951,
      finalAuthorizationTier: tier,
      checks: [],
      autonomousAuthorityGranted: false,
      authorizationHash: '3'.repeat(64),
    }],
    sealHash: '4'.repeat(64),
  };
}

test('high-confidence evidence plus externally pinned trusted registry yields deployable future-review model', () => {
  const r = registry();
  const root = rootFor(r.registryHash);
  const seal = createSrDeploymentAuthorizationSeal({
    reliabilityAuthorizationSeal: evidence('high-confidence-future-review'),
    trustRegistry: r,
    trustRoot: root,
    expectedTrustRootHash: root.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(seal.authorizations[0]!.deploymentAuthorizationTier, 'high-confidence-future-review');
  assert.deepEqual(seal.deployableModels, ['model-a']);
  assert.match(seal.sealHash, /^[a-f0-9]{64}$/);
});

test('prospective pilot evidence is never promoted to deployable high-confidence use by a valid trust root', () => {
  const r = registry();
  const root = rootFor(r.registryHash);
  const seal = createSrDeploymentAuthorizationSeal({
    reliabilityAuthorizationSeal: evidence('prospective-pilot-only'),
    trustRegistry: r,
    trustRoot: root,
    expectedTrustRootHash: root.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(seal.authorizations[0]!.deploymentAuthorizationTier, 'shadow-only');
  assert.deepEqual(seal.deployableModels, []);
});

test('rogue verifier registry substitution destroys deployment authorization even when evidence is high-confidence', () => {
  const trusted = registry('TRUSTED');
  const rogue = registry('ROGUE');
  const root = rootFor(trusted.registryHash);
  const seal = createSrDeploymentAuthorizationSeal({
    reliabilityAuthorizationSeal: evidence('high-confidence-living-review'),
    trustRegistry: rogue,
    trustRoot: root,
    expectedTrustRootHash: root.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(seal.authorizations[0]!.trustRootValid, false);
  assert.equal(seal.authorizations[0]!.deploymentAuthorizationTier, 'shadow-only');
  assert.deepEqual(seal.deployableModels, []);
});

test('replacement trust root cannot authorize rogue registry when operator pins approved root hash', () => {
  const trusted = registry('TRUSTED');
  const rogue = registry('ROGUE');
  const approvedRoot = rootFor(trusted.registryHash);
  const rogueRoot = rootFor(rogue.registryHash);
  const seal = createSrDeploymentAuthorizationSeal({
    reliabilityAuthorizationSeal: evidence('high-confidence-future-review'),
    trustRegistry: rogue,
    trustRoot: rogueRoot,
    expectedTrustRootHash: approvedRoot.rootHash,
    now: '2026-08-10T19:00:00Z',
  });
  assert.equal(seal.authorizations[0]!.deploymentAuthorizationTier, 'shadow-only');
  assert.deepEqual(seal.deployableModels, []);
});
