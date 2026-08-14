import test from 'node:test';
import assert from 'node:assert/strict';
import { SingleReplicaWorkflowRuntime } from '../src/evidence-os/runtime.js';

test('single-replica workflow runtime excludes duplicate active runs and exposes terminal state', async () => {
  const runtime = new SingleReplicaWorkflowRuntime();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const scheduled = runtime.schedule({
    runId: 'r1',
    kind: 'review-pipeline',
    execute: async () => { await gate; return 1; },
    onSuccess: () => {},
    onFailure: () => {},
  });
  assert.equal(scheduled, true);
  assert.equal(runtime.schedule({
    runId: 'r1', kind: 'review-pipeline', execute: async () => 2, onSuccess: () => {}, onFailure: () => {},
  }), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.isRunning('r1'), true);
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const snapshot = runtime.snapshot('2026-08-14T08:00:00Z');
  assert.equal(snapshot.succeeded, 1);
  assert.equal(snapshot.running, 0);
  assert.equal(snapshot.failed, 0);
  assert.equal(runtime.isRunning('r1'), false);
});
