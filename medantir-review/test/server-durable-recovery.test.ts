import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { createReviewDurabilityRuntime } from '../src/durability/runtime.js';

const identityProvider = { authenticate: async () => ({ sub: 'recovery-user', projectId: 'recovery-project' }) };

async function poll(base: string, runId: string) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await fetch(`${base}/runs/${runId}`);
    assert.equal(response.status, 200);
    const state = await response.json() as ReturnType<typeof createPipelineState>;
    if (state.stages.question.status === 'awaiting-human') return state;
    if (state.stages.question.status === 'failed') {
      throw new Error(`Recovered question stage failed: ${state.stages.question.errors.join('; ')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Recovered run did not reach a stable question gate');
}

test('live server recovers a crash-interrupted durable run and resumes without consuming retry budget', async (t) => {
  process.env.REVIEW_LIVE = '1';
  const { startServer } = await import('../src/server.js');
  const root = await mkdtemp(join(tmpdir(), 'medantir-server-recovery-'));
  t.after(async () => {
    delete process.env.REVIEW_LIVE;
    await rm(root, { recursive: true, force: true });
  });

  const runsFile = join(root, 'runs.json');
  const durabilityRoot = join(root, 'durability');
  const durability = createReviewDurabilityRuntime(durabilityRoot);
  const interrupted = createPipelineState(fixtureRequest);
  interrupted.stages.question.status = 'running';
  interrupted.stages.question.attempts = 1;
  interrupted.stages.question.startedAt = '2026-08-11T05:00:00.000Z';
  interrupted.updatedAt = '2026-08-11T05:00:00.000Z';
  interrupted.audit.push({
    id: 'before-crash',
    runId: interrupted.runId,
    stage: 'question',
    event: 'started',
    timestamp: '2026-08-11T05:00:00.000Z',
    attempt: 1,
    details: {},
  });
  await durability.checkpoints.checkpoint({
    state: interrupted,
    stage: 'question',
    event: 'started',
    attempt: 1,
    recordedAt: '2026-08-11T05:00:00.000Z',
  });
  await writeFile(runsFile, JSON.stringify([[interrupted.runId, {
    ownerSub: 'recovery-user',
    projectId: 'recovery-project',
    state: interrupted,
  }]]), { mode: 0o600 });

  const firstServer = await startServer(0, {
    identityProvider,
    runsFile,
    durabilityRuntime: durability,
  });
  let firstServerClosed = false;
  const closeFirstServer = async () => {
    if (firstServerClosed) return;
    firstServerClosed = true;
    await firstServer.close();
  };
  t.after(closeFirstServer);

  const firstBase = `http://127.0.0.1:${firstServer.port}`;
  const recovered = await poll(firstBase, interrupted.runId);

  assert.equal(recovered.stages.question.status, 'awaiting-human');
  assert.equal(recovered.stages.question.attempts, 1);
  assert.equal(recovered.stages['search-execute'].status, 'pending');
  assert.equal(recovered.artifacts.searchProvenance, undefined);
  const control = recovered.artifacts.recoveryControl as {
    interruptedStages: string[];
    resumedAutomatically: boolean;
  };
  assert.deepEqual(control.interruptedStages, ['question']);
  assert.equal(control.resumedAutomatically, true);
  assert.ok(recovered.audit.some((event) => event.event === 'process-interruption-recovered'));
  assert.ok(recovered.audit.some((event) => event.event === 'recovered-run-resumed'));

  // Seeing an authoritative awaiting-human state through the API must imply that
  // its checkpoint has already committed. The owner view is copy-on-write and is
  // published only after the background orchestrator reaches its durable rest point.
  const eventsAfterRecovery = await durability.checkpoints.listEvents(interrupted.runId);
  assert.ok(eventsAfterRecovery.length >= 3);
  assert.equal(eventsAfterRecovery[0]?.event, 'started');
  assert.equal(eventsAfterRecovery.at(-1)?.event, 'awaiting-human-evidence-review');
  await closeFirstServer();

  // A second restart must recover the already-stable awaiting-human state and must
  // not auto-run the question stage again.
  const secondServer = await startServer(0, {
    identityProvider,
    runsFile,
    durabilityRuntime: createReviewDurabilityRuntime(durabilityRoot),
  });
  t.after(() => secondServer.close());
  const secondBase = `http://127.0.0.1:${secondServer.port}`;
  const response = await fetch(`${secondBase}/runs/${interrupted.runId}`);
  assert.equal(response.status, 200);
  const stable = await response.json() as ReturnType<typeof createPipelineState>;
  assert.equal(stable.stages.question.status, 'awaiting-human');
  assert.equal(stable.stages.question.attempts, 1);
  assert.equal((stable.artifacts.recoveryControl as { resumedAutomatically: boolean }).resumedAutomatically, true);

  const clarification = await fetch(`${secondBase}/runs/${interrupted.runId}/clarification`);
  assert.equal(clarification.status, 200);
  const packageBody = await clarification.json() as { request: { issue: { field: string } } };
  assert.equal(packageBody.request.issue.field, 'eligibleDesigns');
});
