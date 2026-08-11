import { scientificContentHash } from '../core/canonical-hash.js';
import {
  srPipelineCoverage,
  validateSrBenchmarkCase,
  type SrBenchmarkCase,
  type SrBenchmarkStage,
} from './sr-reproduction-benchmark.js';
import {
  SR_QUALIFICATION_COMPONENTS,
  type SrQualificationCandidate,
  type SrQualificationComponent,
} from './sr-qualification-corpus.js';

export const SR_QUALIFIED_CASE_BINDING_SCHEMA_VERSION = 'medantir-sr-qualified-case-binding/1' as const;

export const SR_STAGE_QUALIFICATION_COMPONENTS: Record<SrBenchmarkStage, SrQualificationComponent[]> = {
  question: ['protocol'],
  protocol: ['protocol'],
  search: ['search-strategy', 'search-corpus'],
  deduplication: ['dedup-truth'],
  'tiab-screening': ['tiab-truth'],
  'fulltext-screening': ['fulltext-truth', 'included-report-corpus'],
  extraction: ['extraction-truth'],
  appraisal: ['appraisal-truth'],
  synthesis: ['analysis-runtime', 'synthesis-targets'],
  report: ['report-source'],
};

export interface SrQualifiedStageBinding {
  stage: SrBenchmarkStage;
  benchmarkStageReceiptHash: string;
  qualificationComponents: Array<{
    component: SrQualificationComponent;
    receiptHash: string;
  }>;
  qualificationBindingHash: string;
  stageBindingHash: string;
}

export interface SrQualifiedCaseBinding {
  schemaVersion: typeof SR_QUALIFIED_CASE_BINDING_SCHEMA_VERSION;
  caseId: string;
  caseHash: string;
  candidateId: string;
  candidateHash: string;
  domain: string;
  stageBindings: SrQualifiedStageBinding[];
  bindingHash: string;
}

function sha(value: string | undefined, label: string): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function publicationIdentity(caseDefinition: SrBenchmarkCase, candidate: SrQualificationCandidate): boolean {
  const normalizeDoi = (value: string | undefined) => value?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  const pairs = [
    [normalizeDoi(caseDefinition.sourceReview?.doi), normalizeDoi(candidate.publication.doi)],
    [caseDefinition.sourceReview?.pmid?.trim(), candidate.publication.pmid?.trim()],
    [caseDefinition.sourceReview?.pmcid?.trim().toUpperCase(), candidate.publication.pmcid?.trim().toUpperCase()],
  ];
  const shared = pairs.filter(([left, right]) => Boolean(left && right));
  return shared.length > 0 && shared.every(([left, right]) => left === right);
}

export function createSrQualifiedCaseBinding(input: {
  caseDefinition: SrBenchmarkCase;
  candidate: SrQualificationCandidate;
}): SrQualifiedCaseBinding {
  const benchmark = validateSrBenchmarkCase(input.caseDefinition);
  const candidate = input.candidate;
  if (!candidate.promotionEligible || candidate.readiness !== 'validation-ready') {
    throw new Error(`Qualified-case binding requires a validation-ready candidate; '${candidate.candidateId}' is '${candidate.readiness}'.`);
  }
  if (srPipelineCoverage(benchmark) !== 100) throw new Error('Qualified-case binding requires 100% benchmark pipeline coverage.');
  if (benchmark.domain !== candidate.domain) throw new Error(`Qualified-case domain mismatch: '${benchmark.domain}' versus '${candidate.domain}'.`);
  if (!publicationIdentity(benchmark, candidate)) throw new Error('Qualified-case publication identity does not cross-bind by DOI/PMID/PMCID.');
  for (const component of SR_QUALIFICATION_COMPONENTS) {
    const asset = candidate.assets[component];
    if (asset.status !== 'frozen-verified' || !asset.receiptHash) throw new Error(`Qualified-case candidate component '${component}' is not frozen-verified.`);
  }

  const stageBindings: SrQualifiedStageBinding[] = (Object.keys(SR_STAGE_QUALIFICATION_COMPONENTS) as SrBenchmarkStage[])
    .sort()
    .map((stage) => {
      const coverage = benchmark.stageGold[stage];
      if (coverage.status !== 'complete') throw new Error(`Qualified-case stage '${stage}' is not complete.`);
      const benchmarkStageReceiptHash = sha(coverage.receiptHash, `Qualified-case ${stage} benchmark receipt`);
      const qualificationComponents = SR_STAGE_QUALIFICATION_COMPONENTS[stage]
        .map((component) => ({
          component,
          receiptHash: sha(candidate.assets[component].receiptHash, `Qualified-case ${component} receipt`),
        }))
        .sort((a, b) => a.component.localeCompare(b.component));
      const qualificationBindingHash = scientificContentHash(qualificationComponents);
      const base = { stage, benchmarkStageReceiptHash, qualificationComponents, qualificationBindingHash };
      return { ...base, stageBindingHash: scientificContentHash(base) };
    });

  const base = {
    schemaVersion: SR_QUALIFIED_CASE_BINDING_SCHEMA_VERSION,
    caseId: benchmark.caseId,
    caseHash: benchmark.caseHash!,
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    domain: benchmark.domain,
    stageBindings,
  };
  return { ...base, bindingHash: scientificContentHash(base) };
}
