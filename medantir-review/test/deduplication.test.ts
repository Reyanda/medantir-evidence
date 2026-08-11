import test from 'node:test';
import assert from 'node:assert/strict';
import { DeduplicationAgent } from '../src/agents/pipeline-agents.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';

const contextFor = (records: typeof fixtureRecords) => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.searchResults = records;
  return { state, now: () => new Date().toISOString() };
};

test('deduplicates DOI matches and merges database provenance', async () => {
  const result = await new DeduplicationAgent().execute(contextFor(fixtureRecords));
  const unique = result.artifacts.uniqueRecords as typeof fixtureRecords;
  const report = result.artifacts.deduplicationReport as { duplicatesRemoved: number };
  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(unique.length, 3);
  const retained = unique.find((record) => record.doi === '10.1000/sam.001');
  assert.deepEqual(new Set(retained?.sourceDatabases), new Set(['PubMed', 'MEDLINE']));
});
