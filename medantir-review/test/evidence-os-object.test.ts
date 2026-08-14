import test from 'node:test';
import assert from 'node:assert/strict';
import { ImmutableEvidenceGraphBuilder, createEvidenceObject } from '../src/evidence-os/object-store.js';

test('evidence objects are content-addressed, secret-safe, and versioned through supersession', () => {
  const first = createEvidenceObject({
    kind: 'question', logicalId: 'q', version: 1, createdAt: '2026-08-14T08:00:00Z', payload: { objective: 'A' },
  });
  const again = createEvidenceObject({
    kind: 'question', logicalId: 'q', version: 1, createdAt: '2026-08-15T08:00:00Z', payload: { objective: 'A' },
  });
  assert.equal(first.objectId, again.objectId);
  assert.equal(Object.isFrozen(first), true);

  const safe = createEvidenceObject({
    kind: 'artifact', logicalId: 'secret-safe', version: 1, createdAt: '2026-08-14T08:00:00Z',
    payload: { accessToken: 'must-not-survive' },
  });
  assert.equal((safe.payload as { accessToken: string }).accessToken, '[REDACTED]');

  const firstBuilder = new ImmutableEvidenceGraphBuilder('systematic', '2026-08-14T08:00:00Z');
  const v1 = firstBuilder.add({ kind: 'question', logicalId: 'q', payload: { objective: 'A' }, root: true });
  const firstGraph = firstBuilder.snapshot();

  const unchangedBuilder = new ImmutableEvidenceGraphBuilder('systematic', '2026-08-15T08:00:00Z', firstGraph);
  const unchanged = unchangedBuilder.add({ kind: 'question', logicalId: 'q', payload: { objective: 'A' }, root: true });
  const unchangedGraph = unchangedBuilder.snapshot();
  assert.equal(unchanged.objectId, v1.objectId);
  assert.equal(unchanged.version, 1);
  assert.equal(unchangedGraph.graphHash, firstGraph.graphHash);

  const secondBuilder = new ImmutableEvidenceGraphBuilder('systematic', '2026-08-16T08:00:00Z', firstGraph);
  const v2 = secondBuilder.add({ kind: 'question', logicalId: 'q', payload: { objective: 'B' }, root: true });
  const secondGraph = secondBuilder.snapshot();
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.supersedes, [v1.objectId]);
  assert.equal(secondGraph.objects.some((object) => object.objectId === v1.objectId), true);
  assert.equal(secondGraph.objects.some((object) => object.objectId === v2.objectId), true);
  assert.deepEqual(secondGraph.rootObjectIds, [v2.objectId]);
  assert.equal(secondGraph.edges.some((edge) => edge.relation === 'supersedes'
    && edge.fromObjectId === v2.objectId
    && edge.toObjectId === v1.objectId), true);
  assert.match(secondGraph.graphHash, /^[a-f0-9]{64}$/);
});
