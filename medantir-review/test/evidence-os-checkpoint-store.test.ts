import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { EvidenceOsFileCheckpointStore } from '../src/durability/evidence-os-checkpoint-store.js';
import { createEvidenceObject } from '../src/evidence-os/object-store.js';

test('durable checkpoints retain cumulative versioned evidence graphs and recover without a latest pointer', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'medantir-evidence-os-checkpoints-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new EvidenceOsFileCheckpointStore({ rootDir: root });
  const state = createPipelineState(fixtureRequest);
  const firstTime = '2026-08-14T08:00:00.000Z';
  state.stages.question.status = 'running';
  state.stages.question.attempts = 1;
  state.stages.question.startedAt = firstTime;
  state.updatedAt = firstTime;
  state.audit.push({
    id: 'eos-audit-started', runId: state.runId, stage: 'question', event: 'started',
    timestamp: firstTime, attempt: 1, details: {},
  });
  await store.checkpoint({ state, stage: 'question', event: 'started', attempt: 1, recordedAt: firstTime });

  const firstReceipt = await store.evidenceGraphs.latestReceipt(state.runId);
  assert.ok(firstReceipt);
  const firstGraph = await store.evidenceGraphs.getGraph(state.runId);
  assert.ok(firstGraph);
  assert.equal(firstReceipt.graphHash, firstGraph.graphHash);

  const secondTime = '2026-08-14T08:01:00.000Z';
  state.stages.question.status = 'awaiting-human';
  state.updatedAt = secondTime;
  state.audit.push({
    id: 'eos-audit-gate', runId: state.runId, stage: 'question', event: 'awaiting-human-evidence-review',
    timestamp: secondTime, attempt: 1, details: { summary: 'Resolve the material question.' },
  });
  await store.checkpoint({
    state,
    stage: 'question',
    event: 'awaiting-human-evidence-review',
    attempt: 1,
    recordedAt: secondTime,
  });

  const receipts = await store.evidenceGraphs.listCheckpointReceipts(state.runId);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1]?.previousGraphHash, receipts[0]?.graphHash);
  const graph = await store.evidenceGraphs.getGraph(state.runId);
  assert.ok(graph);
  const questionStages = graph.objects
    .filter((object) => object.kind === 'pipeline-stage' && object.logicalId === 'stage:question')
    .sort((left, right) => left.version - right.version);
  assert.deepEqual(questionStages.map((object) => object.version), [1, 2]);
  assert.ok(graph.edges.some((edge) => edge.relation === 'supersedes'
    && edge.fromObjectId === questionStages[1]?.objectId
    && edge.toObjectId === questionStages[0]?.objectId));
  assert.ok(await store.evidenceGraphs.getObject(questionStages[0]!.objectId));

  const observedFirst = createEvidenceObject({
    kind: 'artifact', logicalId: 'clock-stable', version: 1, createdAt: firstTime, payload: { value: 1 },
  });
  const observedLater = createEvidenceObject({
    kind: 'artifact', logicalId: 'clock-stable', version: 1, createdAt: secondTime, payload: { value: 1 },
  });
  assert.equal(observedFirst.objectId, observedLater.objectId);
  assert.equal((await store.evidenceGraphs.putObject(observedFirst)).stored, true);
  assert.equal((await store.evidenceGraphs.putObject(observedLater)).stored, false);

  await store.evidenceGraphs.deleteLatestPointerForRecoveryTest(state.runId);
  const ledgerRecoveredGraph = await store.evidenceGraphs.getGraph(state.runId);
  assert.equal(ledgerRecoveredGraph?.graphHash, graph.graphHash);
  const recoveredState = await store.recover(state.runId);
  assert.equal(recoveredState?.stages.question.status, 'awaiting-human');

  const graphPath = join(root, 'runs', state.runId, 'evidence-os', 'graphs', `${graph.graphHash}.json`);
  const tampered = JSON.parse(await readFile(graphPath, 'utf8')) as { summary: { objectCount: number } };
  tampered.summary.objectCount += 1;
  await writeFile(graphPath, `${JSON.stringify(tampered)}\n`, 'utf8');
  await assert.rejects(() => store.evidenceGraphs.getGraph(state.runId, graph.graphHash), /summary count mismatch|hash mismatch/i);
});
