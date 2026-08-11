import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Checkpoint = {
  schemaVersion: string;
  candidateId: string;
  status: string;
  source: {
    commit: string;
    sha256: string;
  };
  observed: {
    sheetDataRows: number;
    overallRegexRows: number;
    includedRows: number;
    excludedRows: number;
    includedUniqueIdentifiers: number;
    frequencyEligibleTests: Record<string, number>;
    includedRowsByTest: Record<string, number>;
    exclusionReasons: Record<string, number>;
    allIncludedRowsHaveComplete2x2: boolean;
    allIncludedMetricDenominatorsPositive: boolean;
    includedRowIds: string[];
  };
  qualification: {
    component: string;
    claim: string;
    analysisRuntimeExactReproductionReady: boolean;
  };
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

test('rapid-antigen historical selection checkpoint is internally reconciled and cannot masquerade as runtime qualification', async () => {
  const checkpoint = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/covid-rat-2024/overall-selection-source.json'), 'utf8')) as Checkpoint;

  assert.equal(checkpoint.schemaVersion, 'medantir-covid-rat-selection-checkpoint/1');
  assert.equal(checkpoint.candidateId, 'SRQ-COVID-RAT-2024');
  assert.equal(checkpoint.status, 'frozen-unverified');
  assert.match(checkpoint.source.commit, /^[a-f0-9]{40}$/);
  assert.match(checkpoint.source.sha256, /^[a-f0-9]{64}$/);

  assert.equal(checkpoint.observed.sheetDataRows, 688);
  assert.equal(checkpoint.observed.overallRegexRows, 205);
  assert.equal(checkpoint.observed.includedRows + checkpoint.observed.excludedRows, checkpoint.observed.overallRegexRows);
  assert.equal(sum(Object.values(checkpoint.observed.exclusionReasons)), checkpoint.observed.excludedRows);
  assert.equal(sum(Object.values(checkpoint.observed.includedRowsByTest)), checkpoint.observed.includedRows);
  assert.equal(checkpoint.observed.includedRowIds.length, checkpoint.observed.includedRows);
  assert.equal(new Set(checkpoint.observed.includedRowIds).size, checkpoint.observed.includedRowIds.length);
  assert.ok(checkpoint.observed.includedRowIds.every((id) => /^RAT-XLSX-\d{4}$/.test(id)));
  assert.equal(checkpoint.observed.allIncludedRowsHaveComplete2x2, true);
  assert.equal(checkpoint.observed.allIncludedMetricDenominatorsPositive, true);

  assert.deepEqual(checkpoint.observed.frequencyEligibleTests, {
    'BinaxNOW (Abbott)': 10,
    'PanBio (Abbott)': 14,
    'Roche SARS-CoV-2 Rapid Antigen Test (Roche)': 11,
    'Standard Q COVID-19 Ag (SD Biosensor)': 27,
  });
  assert.deepEqual(checkpoint.observed.includedRowsByTest, {
    'BinaxNOW (Abbott)': 10,
    'PanBio (Abbott)': 13,
    'Roche SARS-CoV-2 Rapid Antigen Test (Roche)': 11,
    'Standard Q COVID-19 Ag (SD Biosensor)': 27,
  });
  assert.equal(checkpoint.observed.frequencyEligibleTests['PanBio (Abbott)']! - checkpoint.observed.includedRowsByTest['PanBio (Abbott)']!, 1);
  assert.equal(checkpoint.observed.exclusionReasons['tp-zero'], 1);

  assert.equal(checkpoint.qualification.component, 'analysis-runtime');
  assert.equal(checkpoint.qualification.claim, 'historical-row-selection-checkpoint-only');
  assert.equal(checkpoint.qualification.analysisRuntimeExactReproductionReady, false);
});

test('rapid-antigen analysis preflight retains the blockers that prevent false exact-runtime certification', async () => {
  const preflight = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/covid-rat-2024/runtime-preflight.json'), 'utf8')) as {
    runtimeVersion: string | null;
    findings: Array<{ code: string; severity: string }>;
  };
  const blockers = new Set(preflight.findings.filter((finding) => finding.severity === 'blocker').map((finding) => finding.code));

  assert.equal(preflight.runtimeVersion, null);
  assert.ok(blockers.has('BARE_SETWD'));
  assert.ok(blockers.has('INPUT_CASE_MISMATCH'));
  assert.ok(blockers.has('R_VERSION_UNPINNED'));
  assert.ok(blockers.has('PACKAGE_VERSIONS_INCOMPLETE'));
});
