import test from 'node:test';
import assert from 'node:assert/strict';
import type { ReviewRequest } from '../src/core/types.js';
import { runRealPipeline } from '../src/real-engine.js';

const request: ReviewRequest = {
  reviewType: 'systematic',
  databases: ['PubMed'],
  autoApproveHumanGates: true,
  dualScreening: true,
  registration: { enabled: false },
  humanVerification: { enabled: false },
  protocolDevelopment: {
    searchPeerReviewRequired: false,
    protocolVersion: 'prospective-grade-gate-test-1',
  },
  question: {
    title: 'Intervention review with prospective certainty policy',
    objective: 'Evaluate treatment versus control for mortality in children.',
    population: 'children with the target condition',
    interventionOrExposure: 'treatment',
    comparator: 'control or usual care',
    outcomes: ['mortality'],
    studyDesigns: ['randomised controlled trial'],
    concepts: ['children', 'treatment'],
  },
};

test('real intervention pipeline halts at protocol-finalise before any evidence search when GRADE policy is absent', async () => {
  const state = await runRealPipeline(request);
  assert.equal(state.stages.question.status, 'passed');
  assert.equal(state.stages.protocol.status, 'passed');
  assert.equal(state.stages['protocol-finalise'].status, 'awaiting-human');
  assert.equal(state.stages['register-protocol'].status, 'pending');
  assert.equal(state.stages['search-execute'].status, 'pending');
  assert.equal(state.artifacts.searchProvenance, undefined);
  assert.equal(state.artifacts.searchResults, undefined);
  const protocol = state.artifacts.protocolPackage as { checksum?: string } | undefined;
  assert.ok(protocol?.checksum, 'gate must expose final protocol checksum for policy binding');
  const requirement = state.artifacts.gradePolicyRequirement as {
    status: string;
    protocolHash: string;
    staleDomains?: string[];
  };
  assert.equal(requirement.status, 'required');
  assert.equal(requirement.protocolHash, protocol?.checksum);
  assert.equal(state.artifacts.gradePolicyProtocolReady, false);
  assert.ok(state.audit.some((event) =>
    event.stage === 'protocol-finalise'
    && event.event === 'awaiting-human-evidence-review'));
});
