import test from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceExcerpt, EvidenceSectionName, ExtractedStudy } from '../src/core/types.js';
import { createPipelineState } from '../src/core/state.js';
import { fixtureRequest } from '../src/fixtures.js';
import {
  EXTRACTION_FIELD_CONTRACTS,
  buildArtifactContextPlan,
  buildArtifactTokenisationManifest,
  tokeniseArtifact,
  validateExtractedStudyImrad,
  verifyArtifactTokenDocument,
  type ModelTokenCounterPort,
} from '../src/tokenisation/index.js';

function excerpt(id: string, section: EvidenceSectionName, quote = 'Source evidence.'): EvidenceExcerpt {
  return { id, recordId: 'report-1', section, page: 1, quote, source: 'full-text' };
}

function validStudy(): ExtractedStudy {
  return {
    studyId: 'study-1',
    reportIds: ['report-1'],
    design: 'parallel randomised controlled trial',
    population: 'children aged 6 to 59 months',
    interventionOrExposure: 'reduced-dose therapeutic food',
    comparator: 'standard-dose therapeutic food',
    outcomes: [{ name: 'recovery', effect: 0.84, standardError: 0.08 }],
    mechanisms: ['improved treatment adherence'],
    funding: 'Independent research grant',
    rationale: 'Treatment burden may affect adherence.',
    objectives: ['Estimate recovery under reduced dosing.'],
    resultsSummary: 'Recovery was similar between groups.',
    discussionSummary: 'The findings may support simplified delivery.',
    limitations: ['The study was conducted in one region.'],
    sectionEvidence: {
      rationale: [excerpt('rationale-1', 'rationale')],
      objectives: [excerpt('objectives-1', 'objectives')],
      results: [excerpt('results-1', 'results')],
      discussion: [excerpt('discussion-1', 'discussion')],
      limitations: [excerpt('limitations-1', 'limitations')],
    },
    fieldEvidence: {
      design: [excerpt('design-1', 'methods')],
      population: [excerpt('population-1', 'methods')],
      interventionOrExposure: [excerpt('intervention-1', 'methods')],
      comparator: [excerpt('comparator-1', 'methods')],
      'outcomes.name': [excerpt('outcome-name-1', 'methods')],
      'outcomes.effect': [excerpt('effect-1', 'results')],
      'outcomes.standardError': [excerpt('se-1', 'results')],
      mechanisms: [excerpt('mechanism-1', 'results')],
      funding: [excerpt('funding-1', 'other')],
    },
    sourceQuotes: [],
  };
}

test('artifact tokenisation is deterministic, hierarchical, IMRAD-aware, and citation-aware', () => {
  const first = tokeniseArtifact('extractedStudies', {
    z: 2,
    design: 'Randomised trial',
    resultsSummary: 'Recovery improved [1].',
  }, '2026-08-14T00:00:00.000Z');
  const second = tokeniseArtifact('extractedStudies', {
    resultsSummary: 'Recovery improved [1].',
    design: 'Randomised trial',
    z: 2,
  }, '2026-08-15T00:00:00.000Z');

  assert.equal(first.documentHash, second.documentHash);
  assert.deepEqual(first.tokens.map((token) => token.tokenId), second.tokens.map((token) => token.tokenId));
  assert.ok(first.tokens.some((token) => token.kind === 'citation' && token.text === '[1]'));
  assert.ok(first.tokens.filter((token) => token.jsonPointer === '/design').every((token) => token.imradRole === 'methods'));
  assert.ok(first.tokens.filter((token) => token.jsonPointer === '/resultsSummary').every((token) => token.imradRole === 'results'));
  assert.ok(first.tokens.every((token, index) => token.sequence === index + 1));
  verifyArtifactTokenDocument(first);
});

test('tokenisation redacts raw secrets and detects token tampering', () => {
  const document = tokeniseArtifact('credential-bearing-artifact', {
    database: 'MEDLINE',
    apiKey: 'super-secret-value',
  }, '2026-08-14T00:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(document), /super-secret-value/);
  assert.match(JSON.stringify(document), /REDACTED/);

  const tampered = structuredClone(document);
  const lexical = tampered.tokens.find((token) => token.kind === 'word');
  if (!lexical) throw new Error('Expected a lexical token.');
  lexical.text = 'tampered';
  assert.throws(() => verifyArtifactTokenDocument(tampered), /identity mismatch/);
});

test('extraction contracts bind every populated field to an allowed IMRAD source region', () => {
  const study = validStudy();
  const validation = validateExtractedStudyImrad(study);
  assert.equal(validation.valid, true);
  assert.equal(validation.issues.length, 0);
  assert.ok(validation.checkedFields.some((field) => field.startsWith('outcomes.effect@')));
  assert.ok(EXTRACTION_FIELD_CONTRACTS.some((contract) => contract.field === 'resultsSummary' && contract.allowedImradRoles.includes('results')));
});

test('effect estimates citing methods fail closed under strict extraction validation', () => {
  const study = validStudy();
  study.fieldEvidence['outcomes.effect'] = [excerpt('effect-wrong-section', 'methods')];
  const validation = validateExtractedStudyImrad(study);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((entry) => entry.code === 'EVIDENCE_SECTION_OUTSIDE_CONTRACT' && entry.field === 'outcomes.effect'));
  assert.throws(() => validateExtractedStudyImrad(study, { strict: true }), /Extraction field contract validation failed/);
});

test('manifest tokenises request, stages, audit, and every run artifact', () => {
  const state = createPipelineState(fixtureRequest);
  state.artifacts.extractedStudies = [validStudy()];
  state.artifacts.finalReport = { title: 'Review', sections: { methods: 'Methods text', results: 'Results text' } };

  const first = buildArtifactTokenisationManifest(state, '2026-08-14T00:00:00.000Z');
  const second = buildArtifactTokenisationManifest(state, '2026-08-15T00:00:00.000Z');
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.entries.length, Object.keys(state.artifacts).length + 3);
  assert.ok(first.entries.some((entry) => entry.artifactKey === '@request'));
  assert.ok(first.entries.some((entry) => entry.artifactKey === 'extractedStudies' && entry.extractedStudyCount === 1));
  assert.equal(first.totals.extractionContractErrors, 0);
  assert.ok(first.totals.tokens > first.totals.lexicalTokens);
});

test('context plans preserve artifact and IMRAD boundaries with exact-counter adapters', () => {
  const document = tokeniseArtifact('finalReport', {
    methods: 'Participants were randomly allocated to treatment groups.',
    results: 'Recovery was similar across groups with narrow uncertainty.',
    discussion: 'The result supports cautious implementation.',
  }, '2026-08-14T00:00:00.000Z');
  const counter: ModelTokenCounterPort = {
    counterId: 'test-word-counter',
    exact: true,
    count: (text) => text.trim() ? text.trim().split(/\s+/).length : 0,
  };
  const plan = buildArtifactContextPlan([document], { maxContextTokens: 8, reservedOutputTokens: 2, counter });
  assert.equal(plan.countMethod, 'exact-adapter');
  assert.equal(plan.counterId, 'test-word-counter');
  assert.ok(plan.chunks.length >= 3);
  assert.ok(plan.chunks.every((chunk) => chunk.modelTokens <= plan.usableInputTokens));
  assert.ok(plan.chunks.every((chunk) => chunk.boundary.startsWith(`${chunk.imradRole}:`)));
  assert.ok(new Set(plan.chunks.map((chunk) => chunk.artifactKey)).size === 1);
});
