import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conformanceSuiteHash,
  evaluateRob2Conformance,
  validateRob2ConformanceSuite,
  type Rob2ConformanceSuite,
} from '../src/appraisal/rob2-conformance.js';

const source = (captured: boolean) => ({
  tool: 'RoB 2' as const,
  version: '2019-08-22' as const,
  variant: 'individual-parallel-assignment' as const,
  sourcePage: 'https://www.riskofbias.info/welcome/rob-2-0-tool/current-version-of-rob-2',
  sourceFileId: '1malyRF_b-DgvAGHssrdt4N9R7Yhljmt0',
  workbookSha256: captured ? 'a'.repeat(64) : null,
  captured,
  ...(captured ? { capturedAt: '2026-08-11T05:00:00.000Z' } : {}),
  notes: ['Synthetic harness test; not an official parity receipt.'],
});

function suite(input: Omit<Rob2ConformanceSuite, 'suiteHash'>): Rob2ConformanceSuite {
  return { ...input, suiteHash: conformanceSuiteHash(input) };
}

const d1Low = {
  id: 'synthetic-d1-low',
  domain: 'D1' as const,
  description: 'Synthetic low-risk D1 harness case.',
  responses: [
    { questionId: '1.1', response: 'Y' as const },
    { questionId: '1.2', response: 'Y' as const },
    { questionId: '1.3', response: 'N' as const },
  ],
  expected: 'low' as const,
  sourceLocator: 'synthetic-test-only',
};

test('uncaptured empty official suite is valid metadata but cannot certify parity', () => {
  const input = suite({ version: 1, source: source(false), cases: [] });
  validateRob2ConformanceSuite(input);
  const result = evaluateRob2Conformance(input);
  assert.equal(result.exactParity, false);
  assert.equal(result.certificationEligible, false);
  assert.ok(result.blockers.includes('official-workbook-not-captured'));
  assert.ok(result.blockers.includes('official-workbook-sha256-missing'));
  assert.ok(result.blockers.includes('official-truth-table-cases-missing'));
});

test('captured synthetic matching case proves harness mechanics but not official provenance by itself', () => {
  const input = suite({ version: 1, source: source(true), cases: [d1Low] });
  const result = evaluateRob2Conformance(input);
  assert.equal(result.failedCases, 0);
  assert.equal(result.passedCases, 1);
  assert.equal(result.exactParity, true);
  assert.equal(result.certificationEligible, true);
});

test('a deliberately wrong expected official judgement is detected as a conformance mismatch', () => {
  const input = suite({
    version: 1,
    source: source(true),
    cases: [{ ...d1Low, id: 'synthetic-wrong', expected: 'high' }],
  });
  const result = evaluateRob2Conformance(input);
  assert.equal(result.exactParity, false);
  assert.equal(result.failedCases, 1);
  assert.deepEqual(result.mismatches[0], {
    caseId: 'synthetic-wrong',
    domain: 'D1',
    expected: 'high',
    actual: 'low',
    sourceLocator: 'synthetic-test-only',
  });
  assert.ok(result.blockers.includes('algorithm-mismatch'));
});

test('tampered suite hash is rejected before any algorithm comparison', () => {
  const input = suite({ version: 1, source: source(true), cases: [d1Low] });
  input.cases[0]!.expected = 'high';
  assert.throws(() => validateRob2ConformanceSuite(input), /suite hash mismatch/i);
});

test('captured source metadata requires an exact SHA-256 and timestamp', () => {
  const badSource = { ...source(true), workbookSha256: 'bad' };
  const input = suite({ version: 1, source: badSource, cases: [d1Low] });
  assert.throws(() => validateRob2ConformanceSuite(input), /valid SHA-256/i);
});
