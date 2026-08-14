import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceExcerpt, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';

function excerpt(id: string, section: EvidenceExcerpt['section']): EvidenceExcerpt {
  return { id, recordId: 'r1', section, page: 1, quote: 'Source text.', source: 'full-text' };
}

function study(): ExtractedStudy {
  return {
    studyId: 's1',
    reportIds: ['r1'],
    design: 'randomised controlled trial',
    population: 'Adults',
    interventionOrExposure: 'Treatment',
    comparator: 'Control',
    outcomes: [{ name: 'Mortality', effect: 0.9, standardError: 0.1 }],
    mechanisms: [],
    funding: 'Not reported',
    rationale: 'Rationale',
    objectives: ['Objective'],
    resultsSummary: 'Results',
    discussionSummary: 'Discussion',
    limitations: ['Limitations'],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {},
    sourceQuotes: [],
  };
}

function extractStage() {
  const stage = createReviewProtocol('systematic').stages.find((entry) => entry.stage === 'extract');
  if (!stage) throw new Error('extract stage missing');
  return stage;
}

test('extract stage treats absent source binding as visible debt without breaking legacy extraction', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.extractedStudies = [study()];
  const result = extractStage().validate(state);
  assert.equal(result.ok, true);
  assert.ok(result.issues.some((entry) => entry.code === 'EXTRACTION_MISSING_FIELD_EVIDENCE' && entry.severity === 'warning'));
});

test('extract stage blocks explicit IMRAD contract violations', () => {
  const state = createPipelineState(fixtureRequest);
  const value = study();
  value.fieldEvidence['outcomes.effect'] = [excerpt('wrong-effect-source', 'methods')];
  state.artifacts.extractedStudies = [value];
  const result = extractStage().validate(state);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((entry) => entry.code === 'EXTRACTION_EVIDENCE_SECTION_OUTSIDE_CONTRACT' && entry.severity === 'error'));
});
