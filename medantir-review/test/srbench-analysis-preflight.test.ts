import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSrAnalysisReproductionPreflight,
  type SrAnalysisReproductionPreflightInput,
} from '../src/benchmark/sr-analysis-reproduction-preflight.js';

test('rapid-antigen pinned analysis remains blocked until runtime/package identity is reconstructed', async () => {
  const input = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/covid-rat-2024/runtime-preflight.json'), 'utf8')) as SrAnalysisReproductionPreflightInput;
  const report = createSrAnalysisReproductionPreflight(input);
  assert.equal(report.sourceCommit, '957343bf17087f492e38cf6cb9d26b6882a146a1');
  assert.equal(report.blockerCount, 4);
  assert.equal(report.warningCount, 1);
  assert.equal(report.unresolvedRuntimeIdentity, true);
  assert.equal(report.nonScientificRepairCount, 2);
  assert.equal(report.potentiallySemanticRepairCount, 0);
  assert.equal(report.runnableWithoutSemanticRepair, false);
  assert.equal(report.exactReproductionReady, false);
  assert.ok(report.findings.some((finding) => finding.code === 'BARE_SETWD'));
  assert.ok(report.findings.some((finding) => finding.code === 'INPUT_CASE_MISMATCH'));
  assert.ok(report.findings.some((finding) => finding.code === 'R_VERSION_UNPINNED'));
  assert.ok(report.findings.some((finding) => finding.code === 'PACKAGE_VERSIONS_INCOMPLETE'));
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test('preflight becomes exact-ready only with no blockers, no semantic repair and fully pinned runtime/dependencies', () => {
  const report = createSrAnalysisReproductionPreflight({
    candidateId: 'C1',
    sourceRepository: 'org/repo',
    sourceCommit: 'a'.repeat(40),
    language: 'R',
    runtimeVersion: '4.2.2',
    entrypoints: ['analysis.R'],
    dependencies: [{ name: 'meta', version: '6.0-0' }, { name: 'readxl', version: '1.4.1' }],
    findings: [],
    proposedRepairs: [{
      repairId: 'WD',
      description: 'Provide working directory through harness.',
      affectedFiles: ['analysis.R'],
      semanticImpact: 'none',
      rationale: 'Path setup only.',
    }],
  });
  assert.equal(report.blockerCount, 0);
  assert.equal(report.unresolvedRuntimeIdentity, false);
  assert.equal(report.potentiallySemanticRepairCount, 0);
  assert.equal(report.runnableWithoutSemanticRepair, true);
  assert.equal(report.exactReproductionReady, true);
});

test('semantic or potential repair prevents exact reproduction readiness even with a pinned runtime', () => {
  const report = createSrAnalysisReproductionPreflight({
    candidateId: 'C1',
    sourceRepository: 'org/repo',
    sourceCommit: 'a'.repeat(40),
    language: 'R',
    runtimeVersion: '4.2.2',
    entrypoints: ['analysis.R'],
    dependencies: [{ name: 'meta', version: '6.0-0' }],
    findings: [],
    proposedRepairs: [{
      repairId: 'MODEL',
      description: 'Change estimator to make current package execute.',
      affectedFiles: ['analysis.R'],
      semanticImpact: 'scientific',
      rationale: 'Changes statistical method.',
    }],
  });
  assert.equal(report.potentiallySemanticRepairCount, 1);
  assert.equal(report.exactReproductionReady, false);
});
