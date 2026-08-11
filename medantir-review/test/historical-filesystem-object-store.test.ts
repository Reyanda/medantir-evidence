import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemHistoricalObjectStore } from '../src/historical/filesystem-object-store.js';

async function withStore<T>(fn: (root: string, store: FilesystemHistoricalObjectStore) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'medantir-historical-'));
  try {
    return await fn(root, new FilesystemHistoricalObjectStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('filesystem historical archive is content-addressed and round-trips exact bytes', async () => {
  await withStore(async (_root, store) => {
    const bytes = new TextEncoder().encode('historical evidence bytes');
    const first = await store.put(bytes, {
      role: 'fulltext-source',
      mediaType: 'application/pdf',
      recordId: 'r1',
      accessClass: 'restricted-source',
    });
    const second = await store.put(bytes, {
      role: 'fulltext-source',
      mediaType: 'application/pdf',
      recordId: 'r1',
      accessClass: 'restricted-source',
    });
    assert.equal(first.objectId, second.objectId);
    assert.equal(first.sha256, second.sha256);
    assert.deepEqual(await store.get(first), bytes);
    assert.match(first.storageReference, /^file:\/\//);
  });
});

test('filesystem archive ignores hostile source names because storage paths derive only from SHA-256', async () => {
  await withStore(async (root, store) => {
    const receipt = await store.put(new TextEncoder().encode('safe'), {
      role: 'supplementary-file',
      mediaType: 'text/plain',
      recordId: '../../escape',
      sourceUri: 'file:///../../escape',
      accessClass: 'restricted-source',
    });
    assert.ok(receipt.storageReference.includes(`${root}/objects/`));
    assert.equal(receipt.storageReference.includes('../'), false);
  });
});

test('filesystem archive detects post-capture mutation and refuses the object', async () => {
  await withStore(async (_root, store) => {
    const receipt = await store.put(new TextEncoder().encode('original'), {
      role: 'database-export',
      mediaType: 'application/json',
      accessClass: 'public',
    });
    const path = receipt.storageReference.replace(/^file:\/\//, '');
    await writeFile(path, new TextEncoder().encode('tampered'));
    await assert.rejects(() => store.get(receipt), /immutable byte verification/i);
  });
});

test('existing content-addressed target is verified rather than overwritten', async () => {
  await withStore(async (_root, store) => {
    const bytes = new TextEncoder().encode('same immutable object');
    const receipt = await store.put(bytes, {
      role: 'analysis-input',
      mediaType: 'application/json',
      accessClass: 'verifier-receipt-only',
    });
    const path = receipt.storageReference.replace(/^file:\/\//, '');
    const before = await readFile(path);
    await store.put(bytes, {
      role: 'analysis-input',
      mediaType: 'application/json',
      accessClass: 'verifier-receipt-only',
    });
    const after = await readFile(path);
    assert.deepEqual(after, before);
  });
});

test('concurrent writers publish one immutable digest without replacing one another', async () => {
  await withStore(async (_root, store) => {
    const bytes = new TextEncoder().encode('concurrent historical object');
    const receipts = await Promise.all(Array.from({ length: 16 }, (_value, index) => store.put(bytes, {
      role: 'analysis-output',
      mediaType: 'application/json',
      recordId: `writer-${index}`,
      accessClass: 'verifier-receipt-only',
    })));
    assert.equal(new Set(receipts.map((receipt) => receipt.objectId)).size, 1);
    assert.equal(new Set(receipts.map((receipt) => receipt.sha256)).size, 1);
    assert.deepEqual(await store.get(receipts[0]!), bytes);
  });
});
