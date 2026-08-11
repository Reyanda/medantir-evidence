import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrTournamentPerformanceSummary } from '../src/benchmark/sr-performance-summary.js';
import type { SrBenchmarkTournamentResult } from '../src/benchmark/sr-benchmark-suite.js';

test('performance summary exposes per-stage model review/domain breadth and failed gates', () => {
  const tournament = {
    schemaVersion: 'medantir-srbench-suite/1',
    suiteId: 'CAPABILITY-SUITE',
    suiteVersion: '1',
    suiteHash: '1'.repeat(64),
    models: ['candidate'],
    repeats: 3,
    cases: [{ caseId: 'review-a', benchmarkClass: 'published-review', role: 'validation', domain: 'nutrition', pipelineCoverage: 100, sourcePath: '/review-a' }],
    qualificationAdmissions: [],
    counterfactualChallenges: [],
    runs: [],
    driftSentinels: [],
    promotion: [{
      requestedModel: 'candidate',
      tier: 'shadow-eligible',
      modelCapabilityCoverage: [
        { stage: 'tiab-screening', distinctReviewHashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)], domains: ['nutrition', 'infectious-disease', 'cardiology'] },
        { stage: 'extraction', distinctReviewHashes: ['a'.repeat(64)], domains: ['nutrition'] },
      ],
      checks: [
        { code: 'model-stage-tiab-screening-review-coverage', passed: true, observed: 3, required: 3, rationale: 'fixture' },
        { code: 'model-stage-tiab-screening-domain-coverage', passed: true, observed: 3, required: 3, rationale: 'fixture' },
        { code: 'model-stage-extraction-review-coverage', passed: false, observed: 1, required: 3, rationale: 'fixture' },
        { code: 'model-stage-extraction-domain-coverage', passed: false, observed: 1, required: 3, rationale: 'fixture' },
      ],
    }],
    leaderboard: [],
    tournamentHash: '2'.repeat(64),
  } as unknown as SrBenchmarkTournamentResult;

  const model = createSrTournamentPerformanceSummary(tournament).models[0]!;
  assert.equal(model.modelCapability.requiredStages.length, 2);
  assert.equal(model.modelCapability.allRequiredStagesPassed, false);
  const screening = model.modelCapability.stages.find((stage) => stage.stage === 'tiab-screening')!;
  assert.equal(screening.distinctReviewCount, 3);
  assert.equal(screening.domainCount, 3);
  assert.equal(screening.reviewBreadthPassed, true);
  assert.equal(screening.domainBreadthPassed, true);
  const extraction = model.modelCapability.stages.find((stage) => stage.stage === 'extraction')!;
  assert.equal(extraction.distinctReviewCount, 1);
  assert.equal(extraction.domainCount, 1);
  assert.equal(extraction.reviewBreadthPassed, false);
  assert.equal(extraction.domainBreadthPassed, false);
});
