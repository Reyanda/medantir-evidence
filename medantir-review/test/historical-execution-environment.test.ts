import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareHistoricalExecutionEnvironments,
  createHistoricalExecutionEnvironmentFingerprint,
  historicalLockfileReceipt,
} from '../src/historical/execution-environment.js';

const runtime = { engine: 'node' as const, version: 'v22.0.0', platform: 'linux' as const, arch: 'x64' };
const base = () => createHistoricalExecutionEnvironmentFingerprint({
  codeIdentity: 'commit-a',
  runtime,
  locale: 'en-US',
  timezone: 'UTC',
  lockfiles: [{ name: 'review/package-lock.json', sha256: 'a'.repeat(64), byteLength: 100 }],
  moduleContractHashes: ['m1'],
  algorithmContractHashes: ['a1'],
  externalTools: [{ name: 'LiteParse', version: '1.0', contractHash: 'p1' }],
  randomness: { policy: 'deterministic-no-rng' },
});

test('identical historical execution environments have the same content address', () => {
  const left = base();
  const right = base();
  assert.equal(left.environmentHash, right.environmentHash);
  assert.equal(compareHistoricalExecutionEnvironments(left, right), 'runtime-identical');
});

test('code/lock/runtime changes are visible while unchanged scientific contracts can remain contract-equivalent', () => {
  const expected = base();
  const actual = createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'commit-b',
    runtime: { ...runtime, version: 'v22.1.0' },
    locale: 'en-US',
    timezone: 'UTC',
    lockfiles: [{ name: 'review/package-lock.json', sha256: 'b'.repeat(64), byteLength: 101 }],
    moduleContractHashes: ['m1'],
    algorithmContractHashes: ['a1'],
    externalTools: [{ name: 'LiteParse', version: '1.0', contractHash: 'p1' }],
    randomness: { policy: 'deterministic-no-rng' },
  });
  assert.notEqual(expected.environmentHash, actual.environmentHash);
  assert.equal(compareHistoricalExecutionEnvironments(expected, actual), 'scientific-contract-equivalent');
});

test('algorithm/parser/locale/randomness drift is scientific-contract drift, not silently equivalent', () => {
  const expected = base();
  const changedAlgorithm = createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'commit-a', runtime, locale: 'en-US', timezone: 'UTC',
    moduleContractHashes: ['m1'], algorithmContractHashes: ['a2'],
    externalTools: [{ name: 'LiteParse', version: '1.0', contractHash: 'p1' }],
    randomness: { policy: 'deterministic-no-rng' },
  });
  assert.equal(compareHistoricalExecutionEnvironments(expected, changedAlgorithm), 'scientific-contract-drift');

  const changedTimezone = createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'commit-a', runtime, locale: 'en-US', timezone: 'Europe/Paris',
    moduleContractHashes: ['m1'], algorithmContractHashes: ['a1'],
    externalTools: [{ name: 'LiteParse', version: '1.0', contractHash: 'p1' }],
    randomness: { policy: 'deterministic-no-rng' },
  });
  assert.equal(compareHistoricalExecutionEnvironments(expected, changedTimezone), 'scientific-contract-drift');
});

test('container identities require immutable digests and seeded execution requires an explicit seed', () => {
  assert.throws(() => createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'commit-a',
    containers: [{ name: 'parser', image: 'parser:latest', digest: 'latest' }],
  }), /immutable sha256 image digest/i);
  assert.throws(() => createHistoricalExecutionEnvironmentFingerprint({
    codeIdentity: 'commit-a',
    randomness: { policy: 'seeded' },
  }), /requires an explicit seed/i);
});

test('lockfile receipt hashes raw bytes rather than parsed package metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'medantir-lock-'));
  try {
    const path = join(root, 'package-lock.json');
    await writeFile(path, '{"lockfileVersion":3}\n', 'utf8');
    const first = await historicalLockfileReceipt('package-lock.json', path);
    await writeFile(path, '{ "lockfileVersion": 3 }\n', 'utf8');
    const second = await historicalLockfileReceipt('package-lock.json', path);
    assert.notEqual(first.sha256, second.sha256);
    assert.notEqual(first.byteLength, second.byteLength);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
