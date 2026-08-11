import test from 'node:test';
import assert from 'node:assert/strict';
import type { Agent, AgentResult, EvidenceExcerpt, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { AdjustmentIdentityExtractionAgent } from '../src/synthesis/adjustment-identity-agent.js';

const excerpt = (id: string): EvidenceExcerpt => ({
  id,
  recordId: 'report-adjustment',
  section: 'results',
  page: 4,
  quote: `Adjustment source ${id}`,
  source: 'full-text',
});

const source = excerpt('adj-source');

function makeStudy(outcome: Record<string, unknown>): ExtractedStudy {
  return {
    studyId: 'study-adjustment',
    reportIds: ['report-adjustment'],
    design: 'randomised controlled trial',
    population: 'adults',
    interventionOrExposure: 'treatment',
    comparator: 'control',
    outcomes: [{ name: 'mortality', effect: -0.2, standardError: 0.1, ...outcome } as never],
    mechanisms: [], funding: 'none', rationale: 'r', objectives: ['o'], resultsSummary: 'r', discussionSummary: 'd', limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [source], discussion: [], limitations: [] },
    fieldEvidence: { outcomes: [source] },
    sourceQuotes: [],
  };
}

class ExtractionInner implements Agent {
  readonly stage = 'extract' as const;
  constructor(private readonly study: ExtractedStudy) {}
  async execute(): Promise<AgentResult> { return { artifacts: { extractedStudies: [this.study] } }; }
}

async function run(study: ExtractedStudy) {
  const state = createPipelineState(fixtureRequest);
  return new AdjustmentIdentityExtractionAgent(new ExtractionInner(study)).execute({ state, now: () => '2026-08-11T05:00:00.000Z' });
}

test('raw-arm deterministic derivation mints sourced unadjusted marginal identity', async () => {
  const result = await run(makeStudy({
    adjustmentMetadata: {
      kind: 'raw-arm-data',
      evidenceIds: ['adj-source'],
      rationale: 'Effect was calculated from raw arm-level event counts.',
    },
  }));
  const study = (result.artifacts.extractedStudies as ExtractedStudy[])[0]!;
  const outcome = study.outcomes[0] as unknown as { adjustmentIdentity: { status: string; estimand: string; sourceEvidenceIds: string[] } };
  assert.equal(outcome.adjustmentIdentity.status, 'unadjusted');
  assert.equal(outcome.adjustmentIdentity.estimand, 'marginal');
  assert.deepEqual(outcome.adjustmentIdentity.sourceEvidenceIds, ['adj-source']);
  assert.equal((result.artifacts.adjustmentIdentityQuality as { complete: boolean }).complete, true);
});

test('reported adjusted estimate requires exact covariate set and source evidence', async () => {
  const result = await run(makeStudy({
    adjustmentMetadata: {
      kind: 'reported-estimate',
      adjustmentStatus: 'adjusted',
      estimand: 'conditional',
      covariates: ['Age', 'Sex', 'Baseline Severity'],
      evidenceIds: ['adj-source'],
      rationale: 'Multivariable model reported these covariates.',
    },
  }));
  const outcome = (result.artifacts.extractedStudies as ExtractedStudy[])[0]!.outcomes[0] as unknown as {
    adjustmentIdentity: { status: string; covariates: string[]; sourceEvidenceIds: string[] };
  };
  assert.equal(outcome.adjustmentIdentity.status, 'adjusted');
  assert.deepEqual(outcome.adjustmentIdentity.covariates, ['age', 'baseline severity', 'sex']);
  assert.deepEqual(outcome.adjustmentIdentity.sourceEvidenceIds, ['adj-source']);
});

test('missing adjustment metadata remains unknown and emits certification debt', async () => {
  const result = await run(makeStudy({}));
  const outcome = (result.artifacts.extractedStudies as ExtractedStudy[])[0]!.outcomes[0] as unknown as { adjustmentIdentity: { status: string } };
  assert.equal(outcome.adjustmentIdentity.status, 'unknown');
  const quality = result.artifacts.adjustmentIdentityQuality as { complete: boolean; unknownAdjustmentIdentity: number };
  assert.equal(quality.complete, false);
  assert.equal(quality.unknownAdjustmentIdentity, 1);
  assert.ok(result.warnings?.some((warning) => /unknown adjustment identity/i.test(warning)));
});

test('adjusted estimate missing covariates degrades to unknown rather than inventing an adjustment set', async () => {
  const result = await run(makeStudy({
    adjustmentMetadata: {
      kind: 'reported-estimate',
      adjustmentStatus: 'adjusted',
      evidenceIds: ['adj-source'],
      rationale: 'Report says adjusted but does not name the variables.',
    },
  }));
  const outcome = (result.artifacts.extractedStudies as ExtractedStudy[])[0]!.outcomes[0] as unknown as { adjustmentIdentity: { status: string } };
  assert.equal(outcome.adjustmentIdentity.status, 'unknown');
});

test('unknown evidence IDs cannot be used to mint a known adjustment identity', async () => {
  const result = await run(makeStudy({
    adjustmentMetadata: {
      kind: 'reported-estimate',
      adjustmentStatus: 'unadjusted',
      evidenceIds: ['does-not-exist'],
      rationale: 'Claims crude estimate without valid locator.',
    },
  }));
  const outcome = (result.artifacts.extractedStudies as ExtractedStudy[])[0]!.outcomes[0] as unknown as { adjustmentIdentity: { status: string } };
  assert.equal(outcome.adjustmentIdentity.status, 'unknown');
});

test('raw arm data cannot claim adjusted status', async () => {
  await assert.rejects(() => run(makeStudy({
    adjustmentMetadata: {
      kind: 'raw-arm-data',
      adjustmentStatus: 'adjusted',
      evidenceIds: ['adj-source'],
      rationale: 'Contradictory metadata.',
    },
  })), /cannot simultaneously claim adjusted status/);
});
