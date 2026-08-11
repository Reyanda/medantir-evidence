import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalScientificValue,
  containsRawSecretField,
  scientificContentHash,
  scientificHash,
} from '../src/core/canonical-hash.js';

test('scientific hashing is invariant to object key insertion order', () => {
  const left = { b: 2, a: { z: 3, y: [1, 2] } };
  const right = { a: { y: [1, 2], z: 3 }, b: 2 };
  assert.equal(scientificHash(left), scientificHash(right));
  assert.equal(scientificContentHash(left), scientificContentHash(right));
});

test('secret rotation and operational timestamps do not change scientific content hash', () => {
  const left = {
    runId: 'run-a',
    createdAt: '2026-08-10T01:00:00Z',
    authorization: 'Bearer secret-A',
    api_key: 'provider-A',
    reviewerId: 'reviewer-a',
    credentialRefs: { orcid: 'vault/orcid/researcher' },
    decision: { outcome: 'mortality', value: 0.8 },
  };
  const right = {
    decision: { value: 0.8, outcome: 'mortality' },
    credentialRefs: { orcid: 'vault/orcid/researcher' },
    reviewerId: 'reviewer-b',
    api_key: 'provider-B',
    authorization: 'Bearer secret-B',
    createdAt: '2026-08-11T01:00:00Z',
    runId: 'run-b',
  };
  assert.equal(scientificContentHash(left), scientificContentHash(right));
  assert.notEqual(scientificHash(left), scientificHash(right));
  const projected = canonicalScientificValue(left);
  assert.equal(containsRawSecretField(projected), false);
  assert.doesNotMatch(JSON.stringify(projected), /secret-A|provider-A/);
});

test('credential reference and substantive evidence changes remain scientifically visible', () => {
  const base = {
    credentialRefs: { orcid: 'vault/orcid/a' },
    evidence: { recordId: 'doi:10.1/example', quote: 'RR 0.80 [0.70, 0.90]' },
  };
  assert.notEqual(
    scientificContentHash(base),
    scientificContentHash({ ...base, credentialRefs: { orcid: 'vault/orcid/b' } }),
  );
  assert.notEqual(
    scientificContentHash(base),
    scientificContentHash({ ...base, evidence: { ...base.evidence, quote: 'RR 0.90 [0.80, 1.00]' } }),
  );
});
