import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';
import { runMockPipeline } from '../src/engine.js';

const state = await runMockPipeline(fixtureRequest, {
  PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
  MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
});

console.log(JSON.stringify({
  runId: state.runId,
  stages: Object.fromEntries(Object.entries(state.stages).map(([name, stage]) => [name, stage.status])),
  report: state.artifacts.finalReport,
  auditEvents: state.audit.length,
}, null, 2));
