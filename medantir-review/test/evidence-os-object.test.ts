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

  const builder = new ImmutableEvidenceGraphBuilder('systematic', '2026-08-14T08:00:00Z');
  const v1 = builder.add({ kind: 'question', logicalId: 'q', payload: { objective: 'A' }, root: true });
  const v2 = builder.add({ kind: 'question', logicalId: 'q', payload: { objective: 'B' }, root: true });
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.supersedes, [v1.objectId]);
  const graph = builder.snapshot();
  assert.equal(graph.edges.some((edge) => edge.relation === 'supersedes'), true);
  assert.match(graph.graphHash, /^[a-f0-9]{64}$/);
});
