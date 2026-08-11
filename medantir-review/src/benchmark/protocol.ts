import type { BenchmarkCase, BenchmarkMode, BenchmarkTarget } from './types.js';

export interface BenchmarkProtocol {
  benchmarkId: string;
  mode: BenchmarkMode;
  objective: string;
  frozenInputsRequired: boolean;
  independentRuns: number;
  humanVerification: {
    required: boolean;
    initialMode: 'blinded' | 'unblinded';
    unblindForAdjudication: boolean;
  };
  freezeRequirements: string[];
  executionPhases: Array<{
    id: string;
    name: string;
    requiredOutputs: string[];
    stopConditions: string[];
  }>;
  targets: BenchmarkTarget[];
}

function target(
  id: string,
  stage: BenchmarkTarget['stage'],
  metric: BenchmarkTarget['metric'],
  minimum: number,
  rationale: string,
): BenchmarkTarget {
  return { id, stage, metric, kind: 'minimum', minimum, required: true, rationale };
}

export function defaultTargetsForCase(benchmark: BenchmarkCase): BenchmarkTarget[] {
  const stages = new Set(benchmark.targetStages);
  const targets: BenchmarkTarget[] = [];

  if (stages.has('search-build') || stages.has('search-execute')) {
    targets.push(target('search-known-study-recall', 'search-execute', 'known-study-recall', 0.95, 'Recover nearly all reference included studies from frozen search inputs.'));
    targets.push(target('search-provenance', 'search-execute', 'provenance-completeness', 1, 'Every executed search must have query, platform, date, count, export, and checksum provenance.'));
  }
  if (stages.has('deduplicate')) {
    targets.push(target('dedup-precision', 'deduplicate', 'deduplication-precision', 0.98, 'Avoid merging distinct reports or studies.'));
    targets.push(target('dedup-recall', 'deduplicate', 'deduplication-recall', 0.98, 'Recover duplicate record clusters in the reference set.'));
  }
  if (stages.has('tiab-screen')) {
    targets.push(target('tiab-recall', 'tiab-screen', 'screening-recall', 0.95, 'False exclusions at title and abstract screening are safety-critical.'));
    targets.push(target('tiab-proof', 'tiab-screen', 'provenance-completeness', 1, 'Every decision must retain the source text, rationale, actor, timestamp, and version.'));
  }
  if (stages.has('fulltext-retrieve')) {
    targets.push(target('retrieval-yield', 'fulltext-retrieve', 'full-text-retrieval-yield', 0.95, 'Retrieve the available reference full texts or document lawful failure routes.'));
  }
  if (stages.has('extract')) {
    targets.push(target('extraction-fields', 'extract', 'extraction-field-accuracy', 0.9, 'Core structured fields must match the reference extraction.'));
    targets.push(target('extraction-numeric', 'extract', 'numeric-extraction-within-tolerance', 0.98, 'Numerical values must be captured without transcription or denominator errors.'));
    targets.push(target('extraction-evidence', 'extract', 'required-section-coverage', 1, 'Rationale, objectives, results, discussion, and limitations require cited evidence.'));
  }
  if (stages.has('risk-of-bias')) {
    targets.push(target('rob-agreement', 'risk-of-bias', 'risk-of-bias-domain-agreement', 0.8, 'Domain judgements should substantially agree after evidence-bound adjudication.'));
  }
  if (stages.has('synthesise')) {
    targets.push({
      id: 'synthesis-model',
      stage: 'synthesise',
      metric: 'synthesis-model-match',
      kind: 'exact',
      expected: true,
      required: true,
      rationale: 'The model family, effect scale, dependency handling, and estimand must match the benchmark specification.',
    });
  }
  if (stages.has('grade')) {
    targets.push(target('certainty-agreement', 'grade', 'certainty-domain-agreement', 0.8, 'Domain-level certainty decisions must be evidence-bound and adjudicated.'));
  }
  if (stages.has('report')) {
    targets.push({
      id: 'prisma-counts',
      stage: 'report',
      metric: 'prisma-count-consistency',
      kind: 'exact',
      expected: true,
      required: true,
      rationale: 'Every flow count must reconcile with the underlying record ledger.',
    });
  }
  targets.push(target('human-verification', 'human-verify', 'human-adjudication-completeness', 1, 'No benchmark may close with unresolved required decisions.'));
  return targets;
}

export function createBenchmarkProtocol(benchmark: BenchmarkCase, mode: BenchmarkMode): BenchmarkProtocol {
  if (!benchmark.supportedModes.includes(mode)) {
    throw new Error(`${benchmark.id} does not support benchmark mode ${mode}`);
  }
  if (mode === 'frozen-reproduction' && benchmark.readiness === 'methods-only') {
    throw new Error(`${benchmark.id} is a method-conformance case and has no frozen numeric reference package`);
  }

  const frozenInputsRequired = mode === 'frozen-reproduction';
  return {
    benchmarkId: benchmark.id,
    mode,
    objective: mode === 'frozen-reproduction'
      ? 'Reproduce the reference review from immutable inputs and compare every stage against frozen outputs.'
      : mode === 'live-rerun'
        ? 'Rerun the review against current public interfaces and distinguish evidence drift from pipeline defects.'
        : 'Independently reconstruct and audit the review, allowing evidence-supported challenges to the source review.',
    frozenInputsRequired,
    independentRuns: mode === 'independent-audit' ? 2 : 1,
    humanVerification: {
      required: true,
      initialMode: mode === 'independent-audit' ? 'blinded' : 'unblinded',
      unblindForAdjudication: true,
    },
    freezeRequirements: [
      'Protocol, amendments, and registration version',
      'All database-specific search strings and exact execution dates',
      'Raw exports with cryptographic checksums',
      'Deduplication ledger and study-family links',
      'Screening decisions and exclusion reasons',
      'Full-text corpus with lawful access provenance',
      'Extraction tables with source-page evidence',
      'Risk-of-bias signalling questions and rationales',
      'Analysis code, package versions, seeds, and model options',
      'Certainty assessments and evidence-to-decision records',
      'Final report, flow diagram, tables, and appendices',
    ],
    executionPhases: [
      {
        id: 'B0',
        name: 'Eligibility and access audit',
        requiredOutputs: ['benchmark eligibility decision', 'licensing and lawful-access matrix'],
        stopConditions: ['Reference outputs are unavailable', 'Required use is legally prohibited'],
      },
      {
        id: 'B1',
        name: 'Reference package freezing',
        requiredOutputs: ['manifest', 'checksums', 'version map', 'source-to-artifact lineage'],
        stopConditions: ['Any required artifact lacks a stable version or checksum'],
      },
      {
        id: 'B2',
        name: 'Protocol reconstruction',
        requiredOutputs: ['machine-readable eligibility rules', 'review-family profile', 'estimand and synthesis specification'],
        stopConditions: ['Critical methodological choices cannot be reconstructed without guessing'],
      },
      {
        id: 'B3',
        name: 'Stage-by-stage execution',
        requiredOutputs: ['stage artifacts', 'audit events', 'failure and retry ledger'],
        stopConditions: ['A required stage fails validation', 'Human safety gate rejects continuation'],
      },
      {
        id: 'B4',
        name: 'Difference analysis',
        requiredOutputs: ['metric results', 'difference taxonomy', 'proof packets'],
        stopConditions: ['A discrepancy is labelled an error without source-level proof'],
      },
      {
        id: 'B5',
        name: 'Human adjudication and closure',
        requiredOutputs: ['blinded decisions', 'unblinded adjudication where needed', 'final benchmark verdict'],
        stopConditions: ['Required decisions remain deferred or unresolved'],
      },
    ],
    targets: defaultTargetsForCase(benchmark),
  };
}
