import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scientificModuleContractsFor,
  scientificModuleIdsForStage,
} from '../src/core/scientific-module-contracts.js';

test('quantitative systematic reviews expose the full scientific control stack without inventing new stages', () => {
  const contracts = scientificModuleContractsFor('systematic');
  const ids = new Set(contracts.map((contract) => contract.id));
  for (const required of [
    'document-intelligence',
    'quantitative-provenance',
    'study-family-linkage',
    'estimand-identity',
    'dependence-control',
    'human-verification',
  ]) {
    assert.equal(ids.has(required as never), true, `missing scientific module ${required}`);
  }
  const validStages = new Set([
    'question', 'identity', 'protocol', 'review-landscape', 'protocol-draft', 'search-build',
    'search-test', 'protocol-finalise', 'register-protocol', 'search-execute', 'deduplicate',
    'tiab-screen', 'fulltext-retrieve', 'pdf-to-text', 'fulltext-screen', 'extract',
    'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify',
  ]);
  assert.equal(contracts.every((contract) => contract.stages.every((stage) => validStages.has(stage))), true);
});

test('scoping review does not claim quantitative provenance/estimand/dependence controls it does not require', () => {
  const ids = new Set(scientificModuleContractsFor('scoping').map((contract) => contract.id));
  assert.equal(ids.has('document-intelligence'), true);
  assert.equal(ids.has('study-family-linkage'), true);
  assert.equal(ids.has('quantitative-provenance'), false);
  assert.equal(ids.has('estimand-identity'), false);
  assert.equal(ids.has('dependence-control'), false);
});

test('extract and synthesis stages reveal the controls operating inside them', () => {
  assert.deepEqual(
    scientificModuleIdsForStage('systematic', 'extract'),
    ['estimand-identity', 'quantitative-provenance', 'section-aware-extraction', 'study-family-linkage'].sort(),
  );
  assert.ok(scientificModuleIdsForStage('systematic', 'synthesise').includes('dependence-control'));
});
