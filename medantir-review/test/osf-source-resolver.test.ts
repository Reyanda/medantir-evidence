import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryHistoricalObjectStore,
  type HistoricalArchiveObjectMetadata,
  type HistoricalArchiveObjectReceipt,
  type HistoricalObjectStorePort,
} from '../src/historical/object-archive.js';
import {
  OSF_SOURCE_FIXTURE_SCHEMA_VERSION,
  createOsfFixtureFetch,
  resolveOsfSources,
  type OsfSourceFixture,
} from '../src/benchmark/osf-source-resolver.js';

const API = 'https://api.osf.io/v2';
const ROOT = `${API}/nodes/abc12/files/osfstorage/`;
const FOLDER = `${API}/files/folder/files/`;
const VERSIONS = `${API}/files/nested/versions/`;
const DOWNLOAD = 'https://files.osf.io/v1/resources/abc12/providers/osfstorage/nested';
const SHA = '8ddebf2b0a493950f2c91909bd079188f61ee49976298386627c3f3dd77a0b21';

class RelocatedStore implements HistoricalObjectStorePort {
  private readonly inner = new InMemoryHistoricalObjectStore();
  constructor(private readonly prefix: string) {}
  async put(bytes: Uint8Array, metadata: HistoricalArchiveObjectMetadata): Promise<HistoricalArchiveObjectReceipt> {
    const receipt = await this.inner.put(bytes, metadata);
    return { ...receipt, storageReference: `${this.prefix}/${receipt.objectId}` };
  }
  async get(receipt: HistoricalArchiveObjectReceipt): Promise<Uint8Array> {
    return this.inner.get(receipt);
  }
}

class CorruptReadbackStore implements HistoricalObjectStorePort {
  private readonly inner = new InMemoryHistoricalObjectStore();
  async put(bytes: Uint8Array, metadata: HistoricalArchiveObjectMetadata): Promise<HistoricalArchiveObjectReceipt> {
    return this.inner.put(bytes, metadata);
  }
  async get(_receipt: HistoricalArchiveObjectReceipt): Promise<Uint8Array> {
    return new TextEncoder().encode('corrupt-readback\n');
  }
}

function fixture(extra: OsfSourceFixture['routes'] = {}): OsfSourceFixture {
  return {
    schemaVersion: OSF_SOURCE_FIXTURE_SCHEMA_VERSION,
    routes: {
      [`${API}/nodes/abc12/files/`]: { json: { data: [{ id: 'osfstorage', links: { files: ROOT } }], links: { next: null } } },
      [ROOT]: { json: { data: [
        { id: 'folder', attributes: { kind: 'folder', name: 'analysis', materialized_path: '/analysis/' }, relationships: { files: { links: { related: { href: FOLDER } } } } },
        { id: 'root', attributes: { kind: 'file', name: 'report.csv', materialized_path: '/archive/report.csv', current_version: 1 }, links: { download: 'https://files.osf.io/root' }, relationships: { versions: { links: { related: { href: `${API}/files/root/versions/` } } } } },
      ], links: { next: null } } },
      [FOLDER]: { json: { data: [{
        id: 'nested',
        attributes: { kind: 'file', name: 'report.csv', materialized_path: '/analysis/report.csv', current_version: 2, extra: { hashes: { sha256: SHA } } },
        links: { download: DOWNLOAD },
        relationships: { versions: { links: { related: { href: VERSIONS } } } },
      }], links: { next: null } } },
      [VERSIONS]: { json: { data: [{ id: '2', attributes: { size: 14, content_type: 'text/csv' }, links: { html: 'https://osf.io/abc12/files/osfstorage/nested?revision=2' } }], links: { next: null } } },
      [DOWNLOAD]: { headers: { 'content-type': 'text/csv; charset=utf-8' }, bytesBase64: 'YWxwaGEtZGF0YS12Mgo=' },
      ...extra,
    },
  };
}

function base() {
  return {
    nodeId: 'abc12',
    candidateId: 'SRQ-FIXTURE',
    component: 'extraction-truth' as const,
    sourceRole: 'results-code' as const,
    qualificationUse: 'benchmark-gold' as const,
    capturedAt: '2026-08-10T21:30:00Z',
    archiveStore: new InMemoryHistoricalObjectStore(),
    archiveMetadata: { role: 'extraction-source' as const, accessClass: 'public' as const },
  };
}

test('pins exact nested OSF revision, persists bytes and emits HOBJ-bound qualification capture', async () => {
  const result = await resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '2', expectedSha256: SHA, expectedByteLength: 14 }],
    fetchImpl: createOsfFixtureFetch(fixture()),
  });
  assert.equal(result.resolvedObjects[0]?.fileId, 'nested');
  assert.equal(result.resolvedObjects[0]?.revision, '2');
  assert.equal(result.resolvedObjects[0]?.objectId, `HOBJ-${SHA}`);
  assert.equal(result.resolvedObjects[0]?.mediaType, 'text/csv');
  assert.equal(result.archivePersistence, 'verified');
  assert.equal(result.archiveReceipts[0]?.objectId, `HOBJ-${SHA}`);
  assert.equal(result.archiveReceipts[0]?.role, 'extraction-source');
  assert.deepEqual(result.sourceCapture.selectedPaths, ['analysis/report.csv?revision=2']);
  assert.equal(result.sourceCapture.qualificationUse, 'benchmark-gold');
  assert.equal(result.sourceCapture.captureMethod, 'content-addressed-archive');
  assert.match(result.sourceCapture.captureHash, /^[a-f0-9]{64}$/);
  assert.match(result.resolutionHash, /^[a-f0-9]{64}$/);
});

test('scientific resolution hash is independent of object-store location', async () => {
  const common = {
    nodeId: 'abc12',
    candidateId: 'SRQ-FIXTURE',
    component: 'extraction-truth' as const,
    sourceRole: 'results-code' as const,
    qualificationUse: 'benchmark-gold' as const,
    capturedAt: '2026-08-10T21:30:00Z',
    archiveMetadata: { role: 'extraction-source' as const, accessClass: 'public' as const },
    targets: [{ path: 'analysis/report.csv', revision: '2', expectedSha256: SHA }],
  };
  const left = await resolveOsfSources({
    ...common,
    archiveStore: new RelocatedStore('file:///machine-a/archive'),
    fetchImpl: createOsfFixtureFetch(fixture()),
  });
  const right = await resolveOsfSources({
    ...common,
    archiveStore: new RelocatedStore('s3://institution-b/immutable'),
    fetchImpl: createOsfFixtureFetch(fixture()),
  });
  assert.notEqual(left.archiveReceipts[0]?.storageReference, right.archiveReceipts[0]?.storageReference);
  assert.equal(left.archiveReceipts[0]?.objectId, right.archiveReceipts[0]?.objectId);
  assert.equal(left.sourceCapture.captureHash, right.sourceCapture.captureHash);
  assert.equal(left.resolutionHash, right.resolutionHash);
});

test('benchmark-gold archive must successfully replay the exact stored bytes', async () => {
  await assert.rejects(() => resolveOsfSources({
    ...base(),
    archiveStore: new CorruptReadbackStore(),
    targets: [{ path: 'analysis/report.csv', revision: '2', expectedSha256: SHA }],
    fetchImpl: createOsfFixtureFetch(fixture()),
  }), /archive write\/read verification failed/i);
});

test('benchmark-gold OSF bytes cannot be certified without durable archive persistence', async () => {
  const configured = base();
  const { archiveStore: _archiveStore, archiveMetadata: _archiveMetadata, ...withoutArchive } = configured;
  await assert.rejects(() => resolveOsfSources({
    ...withoutArchive,
    targets: [{ path: 'analysis/report.csv', revision: '2' }],
    fetchImpl: createOsfFixtureFetch(fixture()),
  }), /must be persisted.*content-addressed object store/i);
});

test('supporting-only OSF evidence may be hash-verified without being promoted to archived gold', async () => {
  const result = await resolveOsfSources({
    nodeId: 'abc12',
    candidateId: 'SRQ-FIXTURE',
    component: 'extraction-truth',
    sourceRole: 'restricted-supporting-data',
    qualificationUse: 'supporting-evidence-only',
    capturedAt: '2026-08-10T21:30:00Z',
    targets: [{ path: 'analysis/report.csv', revision: '2', expectedSha256: SHA }],
    fetchImpl: createOsfFixtureFetch(fixture()),
  });
  assert.equal(result.archivePersistence, 'not-requested');
  assert.deepEqual(result.archiveReceipts, []);
  assert.equal(result.sourceCapture.captureMethod, 'content-hash-verification');
});

test('basename ambiguity and missing revision fail closed', async () => {
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'report.csv', revision: '2' }], fetchImpl: createOsfFixtureFetch(fixture()),
  }), /ambiguous.*exact materialized path/i);
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '' }], fetchImpl: createOsfFixtureFetch(fixture()),
  }), /Invalid OSF file revision/i);
});

test('non-current revision cannot fall back to current download URL', async () => {
  const oldVersions = { json: { data: [{ id: '1', attributes: { size: 14, content_type: 'text/csv' }, links: { html: 'https://osf.io/abc12/files/osfstorage/nested?revision=1' } }], links: { next: null } } };
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '1' }],
    fetchImpl: createOsfFixtureFetch(fixture({ [VERSIONS]: oldVersions })),
  }), /no version-specific download link.*not the current/i);
});

test('version-specific historical download is accepted and archived when explicitly supplied', async () => {
  const historical = `${DOWNLOAD}?revision=1`;
  const historicalSha = 'b0739ec274e09ce59471944bb1a835533a38ad13b65c9839d3db57082bf1f693';
  const oldVersions = { json: { data: [{ id: '1', attributes: { size: 13, content_type: 'text/plain' }, links: { download: historical } }], links: { next: null } } };
  const result = await resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '1', expectedSha256: historicalSha }],
    fetchImpl: createOsfFixtureFetch(fixture({
      [VERSIONS]: oldVersions,
      [historical]: { headers: { 'content-type': 'text/plain' }, bytesBase64: 'YmV0YS1jb2RlLXYxCg==' },
    })),
  });
  assert.equal(result.resolvedObjects[0]?.sha256, historicalSha);
  assert.equal(result.resolvedObjects[0]?.downloadUrl, historical);
  assert.equal(result.archiveReceipts[0]?.objectId, `HOBJ-${historicalSha}`);
});

test('size, expected hash and OSF current hash mismatches are fatal', async () => {
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '2' }],
    fetchImpl: createOsfFixtureFetch(fixture({ [DOWNLOAD]: { text: 'short\n' } })),
  }), /reported 14 bytes but downloaded 6/i);
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '2', expectedSha256: 'a'.repeat(64) }],
    fetchImpl: createOsfFixtureFetch(fixture()),
  }), /SHA-256 mismatch/i);

  const badFolder = {
    json: {
      data: [{
        id: 'nested',
        attributes: { kind: 'file', name: 'report.csv', materialized_path: '/analysis/report.csv', current_version: 2, extra: { hashes: { sha256: 'a'.repeat(64) } } },
        links: { download: DOWNLOAD },
        relationships: { versions: { links: { related: { href: VERSIONS } } } },
      }],
      links: { next: null },
    },
  };
  await assert.rejects(() => resolveOsfSources({
    ...base(), targets: [{ path: 'analysis/report.csv', revision: '2' }],
    fetchImpl: createOsfFixtureFetch(fixture({ [FOLDER]: badFolder })),
  }), /current-file SHA-256 disagrees/i);
});
