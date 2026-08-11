import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { FileCheckpointStore } from '../src/durability/file-checkpoint-store.js';

async function temporaryStore(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'medantir-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new FileCheckpointStore({ rootDir: root, lockTimeoutMs: 500, lockRetryMs: 5, staleLockMs: 500 }) };
}

test('persists ordered hash-chained checkpoints and recovers latest snapshot', async (t) => {
  const { store } = await temporaryStore(t);
  const state = createPipelineState(fixtureRequest);
  state.audit.push({ id: 'a1', runId: state.runId, stage: 'question', event: 'started', timestamp: '2026-08-11T00:00:00.000Z', attempt: 1, details: {} });
  await store.checkpoint({ state, stage: 'question', event: 'started', attempt: 1, recordedAt: '2026-08-11T00:00:00.000Z' });
  state.stages.question.status = 'awaiting-human';
  state.artifacts.clarificationRequest = { issue: 'design' };
  state.audit.push({ id: 'a2', runId: state.runId, stage: 'question', event: 'awaiting-human-evidence-review', timestamp: '2026-08-11T00:00:01.000Z', attempt: 1, details: {} });
  await store.checkpoint({ state, stage: 'question', event: 'awaiting-human-evidence-review', attempt: 1, recordedAt: '2026-08-11T00:00:01.000Z' });

  const events = await store.listEvents(state.runId);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((entry) => entry.sequence), [1, 2]);
  assert.equal(events[0]?.previousEventHash, null);
  assert.equal(events[1]?.previousEventHash, events[0]?.eventHash);
  const recovered = await store.recover(state.runId);
  assert.ok(recovered);
  assert.equal(recovered.stages.question.status, 'awaiting-human');
  assert.deepEqual(recovered.artifacts.clarificationRequest, { issue: 'design' });
});

test('recovers from append-only journal when snapshot is deleted', async (t) => {
  const { store } = await temporaryStore(t);
  const state = createPipelineState(fixtureRequest);
  state.stages.question.status = 'passed';
  state.audit.push({ id: 'a1', runId: state.runId, stage: 'question', event: 'passed', timestamp: '2026-08-11T00:00:00.000Z', attempt: 1, details: {} });
  await store.checkpoint({ state, stage: 'question', event: 'passed', attempt: 1, recordedAt: '2026-08-11T00:00:00.000Z' });
  await store.deleteSnapshotForRecoveryTest(state.runId);
  const recovered = await store.recover(state.runId);
  assert.equal(recovered?.stages.question.status, 'passed');
});

test('same latest checkpoint is idempotent and a new store instance continues sequence safely', async (t) => {
  const { root, store } = await temporaryStore(t);
  const state = createPipelineState(fixtureRequest);
  state.audit.push({ id: 'a1', runId: state.runId, stage: 'question', event: 'started', timestamp: '2026-08-11T00:00:00.000Z', attempt: 1, details: {} });
  const input = { state, stage: 'question' as const, event: 'started', attempt: 1, recordedAt: '2026-08-11T00:00:00.000Z' };
  await store.checkpoint(input);
  await store.checkpoint({ ...input, recordedAt: '2026-08-11T00:00:09.000Z' });
  assert.equal((await store.listEvents(state.runId)).length, 1);

  const restartedStore = new FileCheckpointStore({ rootDir: root, lockTimeoutMs: 500, lockRetryMs: 5, staleLockMs: 500 });
  state.stages.question.status = 'awaiting-human';
  state.audit.push({ id: 'a2', runId: state.runId, stage: 'question', event: 'awaiting-human-evidence-review', timestamp: '2026-08-11T00:00:10.000Z', attempt: 1, details: {} });
  await restartedStore.checkpoint({ state, stage: 'question', event: 'awaiting-human-evidence-review', attempt: 1, recordedAt: '2026-08-11T00:00:10.000Z' });
  assert.deepEqual((await restartedStore.listEvents(state.runId)).map((entry) => entry.sequence), [1, 2]);
});

test('detects tampered journal state before recovery', async (t) => {
  const { root, store } = await temporaryStore(t);
  const state = createPipelineState(fixtureRequest);
  state.audit.push({ id: 'a1', runId: state.runId, stage: 'question', event: 'started', timestamp: '2026-08-11T00:00:00.000Z', attempt: 1, details: {} });
  await store.checkpoint({ state, stage: 'question', event: 'started', attempt: 1, recordedAt: '2026-08-11T00:00:00.000Z' });
  const eventPath = join(root, 'runs', state.runId, 'journal', '000000000001.json');
  const event = JSON.parse(await readFile(eventPath, 'utf8')) as { state: { artifacts: Record<string, unknown> } };
  event.state.artifacts.tampered = true;
  await writeFile(eventPath, JSON.stringify(event), 'utf8');
  await assert.rejects(() => store.recover(state.runId), /hash mismatch/);
});

test('rejects path traversal in run identity', async (t) => {
  const { store } = await temporaryStore(t);
  const state = createPipelineState(fixtureRequest);
  state.runId = '../escape';
  await assert.rejects(() => store.checkpoint({ state, stage: 'question', event: 'started', attempt: 1, recordedAt: '2026-08-11T00:00:00.000Z' }), /Unsafe run id/);
});
