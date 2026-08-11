import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOsfFixtureFetch, type OsfSourceFixture } from '../src/benchmark/osf-source-resolver.js';
import { inventoryOsfSources } from '../src/benchmark/osf-source-inventory.js';

test('OSF inventory exposes stable file/revision metadata without producing qualification gold', async () => {
  const fixture = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/fixtures/osf-source-resolver/fixture.json'), 'utf8')) as OsfSourceFixture;
  const inventory = await inventoryOsfSources({ nodeId: 'abc12', fetchImpl: createOsfFixtureFetch(fixture) });

  assert.equal(inventory.qualificationReady, false);
  assert.equal(inventory.entries.length, 1);
  assert.deepEqual(inventory.entries[0], {
    path: 'analysis/report.csv',
    fileId: 'nested',
    currentRevision: '2',
    sha256: '8ddebf2b0a493950f2c91909bd079188f61ee49976298386627c3f3dd77a0b21',
    versionsUrl: 'https://api.osf.io/v2/files/nested/versions/',
    currentDownloadUrl: 'https://files.osf.io/v1/resources/abc12/providers/osfstorage/nested',
  });
  assert.match(inventory.inventoryHash, /^[a-f0-9]{64}$/);
});

test('OSF inventory hash changes when discovered source identity changes', async () => {
  const fixture = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/fixtures/osf-source-resolver/fixture.json'), 'utf8')) as OsfSourceFixture;
  const first = await inventoryOsfSources({ nodeId: 'abc12', fetchImpl: createOsfFixtureFetch(fixture) });
  const changed = structuredClone(fixture);
  const route = changed.routes['https://api.osf.io/v2/files/folder/files/']!;
  const payload = structuredClone(route.json) as any;
  payload.data[0].attributes.current_version = 3;
  changed.routes['https://api.osf.io/v2/files/folder/files/'] = { json: payload };
  const second = await inventoryOsfSources({ nodeId: 'abc12', fetchImpl: createOsfFixtureFetch(changed) });
  assert.notEqual(first.inventoryHash, second.inventoryHash);
  assert.equal(second.entries[0]?.currentRevision, '3');
});
