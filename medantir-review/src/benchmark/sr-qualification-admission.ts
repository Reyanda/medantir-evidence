import { scientificContentHash } from '../core/canonical-hash.js';
import type { SrBenchmarkCase } from './sr-reproduction-benchmark.js';
import type { SrQualificationCandidate, SrQualificationCorpus } from './sr-qualification-corpus.js';

export const SR_QUALIFICATION_ADMISSION_SCHEMA_VERSION = 'medantir-sr-qualification-admission/1' as const;

export type SrQualificationAdmissionStatus = 'not-required' | 'blocked' | 'admitted';

export interface SrQualificationAdmissionCase {
  definition: SrBenchmarkCase;
  benchmarkClass: 'published-review' | 'synthetic-fixture';
  role: 'validation' | 'canary';
  qualificationCandidateId?: string;
}

export interface SrQualificationAdmission {
  schemaVersion: typeof SR_QUALIFICATION_ADMISSION_SCHEMA_VERSION;
  caseId: string;
  caseHash: string;
  qualificationCandidateId?: string;
  candidateHash?: string;
  status: SrQualificationAdmissionStatus;
  promotionAdmitted: boolean;
  reasons: string[];
  admissionHash: string;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function normalizeDoi(value: string | undefined): string | undefined {
  const result = clean(value)?.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  return result || undefined;
}

function identifierChecks(caseDefinition: SrBenchmarkCase, candidate: SrQualificationCandidate): string[] {
  const reasons: string[] = [];
  const caseIds = caseDefinition.sourceReview ?? {};
  const candidateIds = candidate.publication;
  const pairs: Array<[string, string | undefined, string | undefined]> = [
    ['DOI', normalizeDoi(caseIds.doi), normalizeDoi(candidateIds.doi)],
    ['PMID', clean(caseIds.pmid), clean(candidateIds.pmid)],
    ['PMCID', clean(caseIds.pmcid)?.toUpperCase(), clean(candidateIds.pmcid)?.toUpperCase()],
  ];
  let shared = 0;
  for (const [label, left, right] of pairs) {
    if (!left || !right) continue;
    shared += 1;
    if (left !== right) reasons.push(`${label} mismatch between SRBench case '${left}' and qualification candidate '${right}'.`);
  }
  if (shared === 0) reasons.push('Published validation case and qualification candidate have no shared DOI/PMID/PMCID identity to cross-bind.');
  return reasons;
}

function admissionForCase(input: {
  item: SrQualificationAdmissionCase;
  corpus?: SrQualificationCorpus;
}): SrQualificationAdmission {
  const { item } = input;
  const required = item.role === 'validation' && item.benchmarkClass === 'published-review';
  const reasons: string[] = [];
  let candidate: SrQualificationCandidate | undefined;

  if (!required) {
    const base = {
      schemaVersion: SR_QUALIFICATION_ADMISSION_SCHEMA_VERSION,
      caseId: item.definition.caseId,
      caseHash: item.definition.caseHash!,
      status: 'not-required' as const,
      promotionAdmitted: false,
      reasons: ['Qualification admission is only required for published-review validation cases used for model promotion.'],
    };
    return { ...base, admissionHash: scientificContentHash(base) };
  }

  const qualificationCandidateId = clean(item.qualificationCandidateId);
  if (!qualificationCandidateId) reasons.push('Published validation case has no qualificationCandidateId mapping.');
  if (!input.corpus) reasons.push('No qualification corpus is bound to the SRBench suite.');
  if (qualificationCandidateId && input.corpus) {
    candidate = input.corpus.candidates.find((entry) => entry.candidateId === qualificationCandidateId);
    if (!candidate) reasons.push(`Qualification candidate '${qualificationCandidateId}' is absent from the bound corpus.`);
  }
  if (candidate) {
    reasons.push(...identifierChecks(item.definition, candidate));
    if (candidate.domain !== item.definition.domain) {
      reasons.push(`Domain mismatch: benchmark case '${item.definition.domain}' versus qualification candidate '${candidate.domain}'.`);
    }
    if (!candidate.promotionEligible || candidate.readiness !== 'validation-ready') {
      reasons.push(`Qualification candidate '${candidate.candidateId}' is '${candidate.readiness}', not validation-ready.`);
    }
    if (candidate.missingOrWeakComponents.length > 0) {
      reasons.push(`Qualification candidate has ${candidate.missingOrWeakComponents.length} missing/weak component(s): ${candidate.missingOrWeakComponents.join(', ')}.`);
    }
  }

  const promotionAdmitted = reasons.length === 0 && Boolean(candidate);
  const base = {
    schemaVersion: SR_QUALIFICATION_ADMISSION_SCHEMA_VERSION,
    caseId: item.definition.caseId,
    caseHash: item.definition.caseHash!,
    ...(qualificationCandidateId ? { qualificationCandidateId } : {}),
    ...(candidate ? { candidateHash: candidate.candidateHash } : {}),
    status: promotionAdmitted ? 'admitted' as const : 'blocked' as const,
    promotionAdmitted,
    reasons: [...new Set(reasons)].sort(),
  };
  return { ...base, admissionHash: scientificContentHash(base) };
}

export function createSrQualificationAdmissions(input: {
  cases: SrQualificationAdmissionCase[];
  corpus: SrQualificationCorpus | undefined;
}): SrQualificationAdmission[] {
  const admissions = input.cases.map((item) => admissionForCase({
    item,
    ...(input.corpus ? { corpus: input.corpus } : {}),
  })).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const duplicate = admissions.find((item, index) => admissions.findIndex((other) => other.caseId === item.caseId) !== index);
  if (duplicate) throw new Error(`Qualification admission received duplicate SRBench case '${duplicate.caseId}'.`);
  return admissions;
}
