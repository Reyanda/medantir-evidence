import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PipelineState, StageName } from '../src/core/types.js';

const stageNames = [
  'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build', 'search-test',
  'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve',
  'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
] as StageName[];

function run(): PipelineState {
  return {
    runId: 'eos-run',
    request: { reviewType: 'systematic', databases: ['PubMed'], question: { title: 'Q', objective: 'O' } },
    stages: Object.fromEntries(stageNames.map((name) => [name, { name, status: 'pending', attempts: 0, errors: [] }])) as unknown as PipelineState['stages'],
    artifacts: { searchResults: [{ id: 'p1', title: 'Paper', abstract: 'A', authors: [], year: 2024, sourceDatabases: ['PubMed'] }] },
    audit: [],
    createdAt: '2026-08-14T08:00:00Z',
    updatedAt: '2026-08-14T08:00:00Z',
  };
}

test('Evidence OS exposes architecture publicly and graph objects only to the owning project', async (t) => {
  process.env.REVIEW_LIVE = '1';
  const { startEvidenceOsServer } = await import('../src/evidence-os-server.js');
  const root = await mkdtemp(join(tmpdir(), 'eos-api-'));
  const runsFile = join(root, 'runs.json');
  await writeFile(runsFile, JSON.stringify([['eos-run', { ownerSub: 'owner', projectId: 'project', state: run() }]]), { mode: 0o600 });
  const server = await startEvidenceOsServer(0, {
    runsFile,
    identityProvider: {
      authenticate: async (req) => ({
        sub: String(req.headers['x-test-user'] ?? 'owner'),
        projectId: String(req.headers['x-actiora-project'] ?? 'project'),
      }),
    },
  });
  t.after(async () => {
    delete process.env.REVIEW_LIVE;
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.port}`;

  const architecture = await fetch(`${base}/evidence-os/architecture`);
  assert.equal(architecture.status, 200);
  const manifest = await architecture.json() as { product: string; runtime: { horizontalScaleReady: boolean } };
  assert.equal(manifest.product, 'MEDANTIR Evidence OS');
  assert.equal(manifest.runtime.horizontalScaleReady, false);

  const graph = await fetch(`${base}/runs/eos-run/evidence-graph`, {
    headers: { 'x-actiora-project': 'project' },
  });
  assert.equal(graph.status, 200);
  const graphBody = await graph.json() as { graphHash: string; objects: Array<{ objectId: string }> };
  assert.match(graphBody.graphHash, /^[a-f0-9]{64}$/);
  assert.ok(graphBody.objects.length > 0);

  const object = await fetch(`${base}/runs/eos-run/evidence-objects/${graphBody.objects[0]!.objectId}`, {
    headers: { 'x-actiora-project': 'project' },
  });
  assert.equal(object.status, 200);

  const otherOwner = await fetch(`${base}/runs/eos-run/evidence-graph`, {
    headers: { 'x-test-user': 'other', 'x-actiora-project': 'project' },
  });
  assert.equal(otherOwner.status, 404);
});
