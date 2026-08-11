import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureRequest } from '../src/fixtures.js';
import { runRealPipeline } from '../src/real-engine.js';
import { FileCheckpointStore } from '../src/durability/file-checkpoint-store.js';

test('real autonomous intake is recoverable from durable journal before any network work', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'medantir-real-durable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new FileCheckpointStore({ rootDir: root });

  const state = await runRealPipeline(fixtureRequest, null, undefined, undefined, store);
  assert.equal(state.stages.question.status, 'awaiting-human');
  assert.equal(state.artifacts.searchProvenance, undefined);

  const events = await store.listEvents(state.runId);
  assert.deepEqual(events.map((event) => event.event), ['started', 'awaiting-human-evidence-review']);
  assert.equal(events[0]?.state.stages.question.status, 'running');
  assert.equal(events[1]?.state.stages.question.status, 'awaiting-human');

  const recovered = await store.recover(state.runId);
  assert.ok(recovered);
  assert.equal(recovered.stages.question.status, 'awaiting-human');
  assert.deepEqual(recovered.artifacts.clarificationRequest, state.artifacts.clarificationRequest);
  assert.equal(recovered.artifacts.searchProvenance, undefined);
});
