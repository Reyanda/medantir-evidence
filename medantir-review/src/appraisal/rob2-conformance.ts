import { createHash } from 'node:crypto';
import { assessRob2, type Rob2Judgement, type Rob2SignalResponse } from './rob2.js';

export interface Rob2OfficialSourceReceipt {
  tool: 'RoB 2';
  version: '2019-08-22';
  variant: 'individual-parallel-assignment';
  sourcePage: string;
  sourceFileId: string;
  workbookSha256: string | null;
  captured: boolean;
  capturedAt?: string;
  notes: string[];
}

export interface Rob2ConformanceCase {
  id: string;
  domain: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'overall';
  description: string;
  responses: Array<{ questionId: string; response: Rob2SignalResponse['response'] }>;
  expected: Rob2Judgement;
  sourceLocator: string;
}

export interface Rob2ConformanceSuite {
  version: 1;
  source: Rob2OfficialSourceReceipt;
  cases: Rob2ConformanceCase[];
  suiteHash: string;
}

export interface Rob2ConformanceMismatch {
  caseId: string;
  domain: Rob2ConformanceCase['domain'];
  expected: Rob2Judgement;
  actual: Rob2Judgement;
  sourceLocator: string;
}

export interface Rob2ConformanceResult {
  suiteHash: string;
  sourceWorkbookSha256: string | null;
  sourceCaptured: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  mismatches: Rob2ConformanceMismatch[];
  exactParity: boolean;
  certificationEligible: boolean;
  blockers: string[];
}

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function conformanceSuiteHash(input: Omit<Rob2ConformanceSuite, 'suiteHash'>): string {
  return sha256(input);
}

export function validateRob2ConformanceSuite(suite: Rob2ConformanceSuite): void {
  if (suite.version !== 1) throw new Error('Unsupported RoB 2 conformance suite version');
  if (suite.source.tool !== 'RoB 2' || suite.source.version !== '2019-08-22' || suite.source.variant !== 'individual-parallel-assignment') {
    throw new Error('RoB 2 conformance suite source identity is invalid');
  }
  const { suiteHash, ...hashable } = suite;
  if (suiteHash !== conformanceSuiteHash(hashable)) throw new Error('RoB 2 conformance suite hash mismatch');
  const seen = new Set<string>();
  for (const testCase of suite.cases) {
    if (!testCase.id.trim()) throw new Error('RoB 2 conformance case requires an id');
    if (seen.has(testCase.id)) throw new Error(`Duplicate RoB 2 conformance case ${testCase.id}`);
    seen.add(testCase.id);
    if (!testCase.description.trim() || !testCase.sourceLocator.trim()) throw new Error(`RoB 2 conformance case ${testCase.id} lacks description/source locator`);
    if (testCase.responses.length === 0) throw new Error(`RoB 2 conformance case ${testCase.id} has no signalling responses`);
    if (!['low', 'some-concerns', 'high'].includes(testCase.expected)) throw new Error(`RoB 2 conformance case ${testCase.id} has invalid expected judgement`);
  }
  if (suite.source.captured) {
    if (!suite.source.workbookSha256 || !/^[a-f0-9]{64}$/.test(suite.source.workbookSha256)) {
      throw new Error('Captured RoB 2 workbook requires a valid SHA-256');
    }
    if (!suite.source.capturedAt || !Number.isFinite(Date.parse(suite.source.capturedAt))) {
      throw new Error('Captured RoB 2 workbook requires a valid capturedAt timestamp');
    }
  }
}

function syntheticEvidence(questionId: string) {
  return {
    id: `conformance-${questionId}`,
    recordId: 'official-conformance-case',
    section: 'methods' as const,
    page: 1,
    quote: `Official conformance signalling response ${questionId}`,
    source: 'derived' as const,
  };
}

function completeResponses(input: Rob2ConformanceCase['responses']): Rob2SignalResponse[] {
  return input.map((item) => ({
    questionId: item.questionId,
    response: item.response,
    rationale: 'Official workbook conformance truth-table input.',
    evidence: item.response === 'NI' || item.response === 'NA' ? [] : [syntheticEvidence(item.questionId)],
    source: 'deterministic',
  }));
}

export function evaluateRob2Conformance(suite: Rob2ConformanceSuite): Rob2ConformanceResult {
  validateRob2ConformanceSuite(suite);
  const mismatches: Rob2ConformanceMismatch[] = [];
  for (const testCase of suite.cases) {
    const assessment = assessRob2({
      studyId: `conformance-study-${testCase.id}`,
      resultId: `conformance-result-${testCase.id}`,
      outcome: `conformance-${testCase.id}`,
      responses: completeResponses(testCase.responses),
    });
    const actual = testCase.domain === 'overall'
      ? assessment.algorithmOverall
      : assessment.domains.find((domain) => domain.domain === testCase.domain)?.algorithmJudgement;
    if (!actual) throw new Error(`RoB 2 conformance case ${testCase.id} did not produce ${testCase.domain}`);
    if (actual !== testCase.expected) {
      mismatches.push({
        caseId: testCase.id,
        domain: testCase.domain,
        expected: testCase.expected,
        actual,
        sourceLocator: testCase.sourceLocator,
      });
    }
  }

  const blockers: string[] = [];
  if (!suite.source.captured) blockers.push('official-workbook-not-captured');
  if (!suite.source.workbookSha256) blockers.push('official-workbook-sha256-missing');
  if (suite.cases.length === 0) blockers.push('official-truth-table-cases-missing');
  if (mismatches.length > 0) blockers.push('algorithm-mismatch');
  const exactParity = suite.source.captured && Boolean(suite.source.workbookSha256) && suite.cases.length > 0 && mismatches.length === 0;
  return {
    suiteHash: suite.suiteHash,
    sourceWorkbookSha256: suite.source.workbookSha256,
    sourceCaptured: suite.source.captured,
    totalCases: suite.cases.length,
    passedCases: suite.cases.length - mismatches.length,
    failedCases: mismatches.length,
    mismatches,
    exactParity,
    certificationEligible: exactParity && blockers.length === 0,
    blockers,
  };
}
