import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistoricalReviewBundleManifest,
  verifyHistoricalReviewBundleManifest,
} from '../src/historical/bundle-manifest.js';

const hash = (character: string) => character.repeat(64);
const entries = [
  {
    logicalPath: 'capsules/search.json',
    kind: 'capsule' as const,
    scientificHash: hash('a'),
    accessClass: 'verifier-receipt-only' as const,
    requiredForClaim: true,
  },
  {
    logicalPath: 'objects/publication.xml',
    kind: 'source-object' as const,
    scientificHash: hash('b'),
    byteHash: hash('c'),
    byteLength: 1234,
    accessClass: 'public' as const,
    requiredForClaim: true,
  },
  {
    logicalPath: 'objects/restricted-primary.pdf.receipt',
    kind: 'source-object' as const,
    scientificHash: hash('d'),
    byteHash: hash('e'),
    byteLength: 9876,
    accessClass: 'restricted-source' as const,
    requiredForClaim: true,
    description: 'Receipt only; body stored outside verifier bundle.',
  },
];

test('historical bundle root is independent of packaging/input order', () => {
  const left = createHistoricalReviewBundleManifest({ reviewId: 'r', benchmarkId: 'b', entries });
  const right = createHistoricalReviewBundleManifest({ reviewId: 'r', benchmarkId: 'b', entries: [...entries].reverse() });
  assert.equal(left.merkleRoot, right.merkleRoot);
  assert.equal(left.manifestId, right.manifestId);
  assert.equal(left.entryCount, 3);
  assert.equal(left.requiredEntryCount, 3);
  assert.equal(verifyHistoricalReviewBundleManifest(left).valid, true);
});

test('restricted historical evidence contributes its receipt/hash without exposing body or storage location', () => {
  const manifest = createHistoricalReviewBundleManifest({ reviewId: 'r', benchmarkId: 'b', entries });
  const restricted = manifest.entries.find((entry) => entry.accessClass === 'restricted-source');
  assert.ok(restricted);
  assert.equal(restricted?.byteHash, hash('e'));
  assert.equal(restricted?.byteLength, 9876);
  assert.equal('content' in (restricted ?? {}), false);
  assert.equal('storageReference' in (restricted ?? {}), false);
});

test('changing logical receipt content changes both leaf and bundle root', () => {
  const original = createHistoricalReviewBundleManifest({ reviewId: 'r', benchmarkId: 'b', entries });
  const changed = createHistoricalReviewBundleManifest({
    reviewId: 'r',
    benchmarkId: 'b',
    entries: entries.map((entry) => entry.logicalPath === 'capsules/search.json' ? { ...entry, scientificHash: hash('f') } : entry),
  });
  assert.notEqual(original.merkleRoot, changed.merkleRoot);
  assert.notEqual(original.manifestId, changed.manifestId);
});

test('manifest verification detects post-construction leaf/root/id tampering', () => {
  const manifest = createHistoricalReviewBundleManifest({ reviewId: 'r', benchmarkId: 'b', entries });
  const tamperedLeaf = structuredClone(manifest);
  tamperedLeaf.entries[0]!.scientificHash = hash('f');
  const leafCheck = verifyHistoricalReviewBundleManifest(tamperedLeaf);
  assert.equal(leafCheck.valid, false);
  assert.ok(leafCheck.entryErrors.some((error) => /leaf hash mismatch/i.test(error.error)));

  const tamperedRoot = structuredClone(manifest);
  tamperedRoot.merkleRoot = hash('0');
  assert.equal(verifyHistoricalReviewBundleManifest(tamperedRoot).merkleRootValid, false);

  const tamperedId = structuredClone(manifest);
  tamperedId.manifestId = `HBM-${'0'.repeat(24)}`;
  assert.equal(verifyHistoricalReviewBundleManifest(tamperedId).manifestIdValid, false);
});

test('bundle logical paths and byte receipts fail closed on traversal, duplicates and partial byte metadata', () => {
  assert.throws(() => createHistoricalReviewBundleManifest({
    reviewId: 'r', benchmarkId: 'b', entries: [{ ...entries[0]!, logicalPath: '../escape' }],
  }), /logical path.*invalid/i);
  assert.throws(() => createHistoricalReviewBundleManifest({
    reviewId: 'r', benchmarkId: 'b', entries: [entries[0]!, { ...entries[0]! }],
  }), /duplicates logical path/i);
  assert.throws(() => createHistoricalReviewBundleManifest({
    reviewId: 'r', benchmarkId: 'b', entries: [{ ...entries[0]!, byteHash: hash('a') }],
  }), /byteHash and byteLength must be supplied together/i);
});
