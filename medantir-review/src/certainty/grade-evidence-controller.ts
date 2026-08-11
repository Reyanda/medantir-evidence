import type { EvidenceExcerpt, PipelineState } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type { Rob2Assessment } from '../appraisal/rob2.js';
import type { GradeOutcomeEvidenceInput } from './grade-agent.js';
import type { DirectnessRating, GradeIndirectnessEvidence, GradePublicationBiasEvidence } from './grade.js';

export interface GradeEvidenceCatalogEntry {
  id: string;
  kind: 'source-excerpt' | 'protocol' | 'existing-grade-evidence' | 'publication-bias-assessment';
  description: string;
  allowedUses: Array<'information-size' | 'directness' | 'publication-bias'>;
  page?: number;
}

export interface GradeOutcomeEvidenceSubmission {
  outcome: string;
  totalParticipants?: number;
  totalParticipantsEvidenceIds?: string[];
  directness?: Omit<GradeIndirectnessEvidence, 'evidenceIds'> & { evidenceIds: string[] };
  publicationBias?: {
    assessmentEvidenceIds: string[];
    signals: Array<{ id: string; description: string; evidenceIds: string[] }>;
  };
}

export interface GradeOutcomeEvidenceReceipt {
  version: 1;
  receiptId: string;
  outcome: string;
  addedFields: string[];
  submissionHash: string;
  actorId: string;
  decidedAt: string;
}

export type ResumeGradePipeline = (state: PipelineState) => Promise<PipelineState>;
const DIRECTNESS = new Set<DirectnessRating>(['direct', 'partial', 'indirect']);
const PUBLICATION_BIAS_BASIS_ID = '__assessment-basis__';

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const semantic = (value: unknown) => stableHash(value);

function stringIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw Object.assign(new Error(`${label} must be a string array`), { status: 400 });
  return unique(value as string[]);
}

function directnessRating(value: unknown, label: string): DirectnessRating {
  if (typeof value !== 'string' || !DIRECTNESS.has(value as DirectnessRating)) throw Object.assign(new Error(`${label} must be direct, partial, or indirect`), { status: 400 });
  return value as DirectnessRating;
}

export function parseGradeOutcomeEvidenceSubmission(value: unknown): GradeOutcomeEvidenceSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('GRADE evidence submission must be an object'), { status: 400 });
  const root = value as Record<string, unknown>;
  if (typeof root.outcome !== 'string' || !root.outcome.trim()) throw Object.assign(new Error('GRADE outcome is required'), { status: 400 });
  const result: GradeOutcomeEvidenceSubmission = { outcome: root.outcome.trim() };

  if (root.totalParticipants !== undefined) {
    if (typeof root.totalParticipants !== 'number' || !Number.isInteger(root.totalParticipants) || root.totalParticipants <= 0) throw Object.assign(new Error('GRADE totalParticipants must be a positive integer'), { status: 400 });
    const ids = stringIds(root.totalParticipantsEvidenceIds, 'GRADE totalParticipantsEvidenceIds');
    if (ids.length === 0) throw Object.assign(new Error('GRADE totalParticipants requires source evidence IDs'), { status: 400 });
    result.totalParticipants = root.totalParticipants;
    result.totalParticipantsEvidenceIds = ids;
  } else if (root.totalParticipantsEvidenceIds !== undefined) {
    throw Object.assign(new Error('GRADE totalParticipantsEvidenceIds cannot be supplied without totalParticipants'), { status: 400 });
  }

  if (root.directness !== undefined) {
    if (!root.directness || typeof root.directness !== 'object' || Array.isArray(root.directness)) throw Object.assign(new Error('GRADE directness must be an object'), { status: 400 });
    const item = root.directness as Record<string, unknown>;
    const directness: GradeOutcomeEvidenceSubmission['directness'] = {
      population: directnessRating(item.population, 'GRADE directness.population'),
      interventionOrExposure: directnessRating(item.interventionOrExposure, 'GRADE directness.interventionOrExposure'),
      comparator: directnessRating(item.comparator, 'GRADE directness.comparator'),
      outcome: directnessRating(item.outcome, 'GRADE directness.outcome'),
      evidenceIds: stringIds(item.evidenceIds, 'GRADE directness.evidenceIds'),
      ...(item.setting !== undefined ? { setting: directnessRating(item.setting, 'GRADE directness.setting') } : {}),
      ...(item.followUp !== undefined ? { followUp: directnessRating(item.followUp, 'GRADE directness.followUp') } : {}),
    };
    if (directness.evidenceIds.length === 0) throw Object.assign(new Error('GRADE directness requires source/protocol evidence IDs'), { status: 400 });
    result.directness = directness;
  }

  if (root.publicationBias !== undefined) {
    if (!root.publicationBias || typeof root.publicationBias !== 'object' || Array.isArray(root.publicationBias)) throw Object.assign(new Error('GRADE publicationBias must be an object'), { status: 400 });
    const publication = root.publicationBias as Record<string, unknown>;
    const assessmentEvidenceIds = stringIds(publication.assessmentEvidenceIds, 'GRADE publicationBias.assessmentEvidenceIds');
    if (assessmentEvidenceIds.length === 0) throw Object.assign(new Error('GRADE publicationBias requires assessmentEvidenceIds proving the bias assessment was performed'), { status: 400 });
    if (!Array.isArray(publication.signals)) throw Object.assign(new Error('GRADE publicationBias.signals must be an array'), { status: 400 });
    const seen = new Set<string>();
    const signals = publication.signals.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('GRADE publication-bias signal must be an object'), { status: 400 });
      const signal = raw as Record<string, unknown>;
      if (typeof signal.id !== 'string' || !signal.id.trim()) throw Object.assign(new Error('GRADE publication-bias signal id is required'), { status: 400 });
      const id = signal.id.trim();
      if (id === PUBLICATION_BIAS_BASIS_ID) throw Object.assign(new Error(`GRADE publication-bias signal id ${PUBLICATION_BIAS_BASIS_ID} is reserved`), { status: 400 });
      if (seen.has(id)) throw Object.assign(new Error(`Duplicate GRADE publication-bias signal ${id}`), { status: 400 });
      seen.add(id);
      if (typeof signal.description !== 'string' || !signal.description.trim()) throw Object.assign(new Error(`GRADE publication-bias signal ${id} requires a description`), { status: 400 });
      const evidenceIds = stringIds(signal.evidenceIds, `GRADE publication-bias signal ${id} evidenceIds`);
      if (evidenceIds.length === 0) throw Object.assign(new Error(`GRADE publication-bias signal ${id} requires evidence IDs`), { status: 400 });
      return { id, description: signal.description.trim(), evidenceIds };
    });
    result.publicationBias = { assessmentEvidenceIds, signals };
  }

  if (result.totalParticipants === undefined && !result.directness && !result.publicationBias) throw Object.assign(new Error('GRADE evidence submission did not provide any resolvable evidence field'), { status: 400 });
  return result;
}

function excerpts(state: PipelineState): EvidenceExcerpt[] {
  const byId = new Map<string, EvidenceExcerpt>();
  const studies = Array.isArray(state.artifacts.extractedStudies) ? state.artifacts.extractedStudies as Array<{ fieldEvidence?: Record<string, EvidenceExcerpt[]>; sectionEvidence?: Record<string, EvidenceExcerpt[]> }> : [];
  for (const study of studies) {
    for (const excerpt of Object.values(study.fieldEvidence ?? {}).flat()) byId.set(excerpt.id, excerpt);
    for (const excerpt of Object.values(study.sectionEvidence ?? {}).flat()) byId.set(excerpt.id, excerpt);
  }
  const rob2 = Array.isArray(state.artifacts.rob2Assessments) ? state.artifacts.rob2Assessments as Rob2Assessment[] : [];
  for (const assessment of rob2) for (const domain of assessment.domains) for (const response of domain.responses) for (const excerpt of response.evidence) byId.set(excerpt.id, excerpt);
  return [...byId.values()];
}

export function buildGradeEvidenceCatalog(state: PipelineState): GradeEvidenceCatalogEntry[] {
  const catalog = new Map<string, GradeEvidenceCatalogEntry>();
  for (const excerpt of excerpts(state)) {
    catalog.set(excerpt.id, { id: excerpt.id, kind: 'source-excerpt', description: excerpt.quote, allowedUses: ['information-size', 'directness'], ...(excerpt.page ? { page: excerpt.page } : {}) });
  }
  const protocol = state.artifacts.protocolPackage as { checksum?: unknown } | undefined;
  const checksum = typeof protocol?.checksum === 'string' ? protocol.checksum.trim() : '';
  if (checksum) {
    const id = `protocol:${checksum}:review-question`;
    catalog.set(id, { id, kind: 'protocol', description: 'Frozen protocol/ReviewSpec target PICO identity.', allowedUses: ['directness'] });
  }
  const biasCatalog = Array.isArray(state.artifacts.publicationBiasEvidenceCatalog)
    ? state.artifacts.publicationBiasEvidenceCatalog as Array<{ id?: unknown; description?: unknown }> : [];
  for (const raw of biasCatalog) {
    if (typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.description !== 'string' || !raw.description.trim()) continue;
    catalog.set(raw.id.trim(), { id: raw.id.trim(), kind: 'publication-bias-assessment', description: raw.description.trim(), allowedUses: ['publication-bias'] });
  }
  const existing = Array.isArray(state.artifacts.gradeOutcomeEvidence) ? state.artifacts.gradeOutcomeEvidence as GradeOutcomeEvidenceInput[] : [];
  for (const input of existing) {
    for (const id of input.totalParticipantsEvidenceIds ?? []) if (!catalog.has(id)) catalog.set(id, { id, kind: 'existing-grade-evidence', description: `Existing information-size evidence for ${input.outcome}.`, allowedUses: ['information-size'] });
    for (const id of input.directness?.evidenceIds ?? []) if (!catalog.has(id)) catalog.set(id, { id, kind: 'existing-grade-evidence', description: `Existing directness evidence for ${input.outcome}.`, allowedUses: ['directness'] });
    for (const signal of input.publicationBias?.signals ?? []) for (const id of signal.evidenceIds) if (!catalog.has(id)) catalog.set(id, { id, kind: 'existing-grade-evidence', description: `Existing publication-bias evidence (${signal.id}) for ${input.outcome}.`, allowedUses: ['publication-bias'] });
  }
  return [...catalog.values()];
}

function validateUse(catalog: Map<string, GradeEvidenceCatalogEntry>, ids: string[], use: GradeEvidenceCatalogEntry['allowedUses'][number]): void {
  const unknown = ids.filter((id) => !catalog.has(id));
  if (unknown.length > 0) throw Object.assign(new Error(`GRADE submission references unknown evidence id(s): ${unknown.join(', ')}`), { status: 400 });
  const wrongUse = ids.filter((id) => !catalog.get(id)!.allowedUses.includes(use));
  if (wrongUse.length > 0) throw Object.assign(new Error(`GRADE evidence id(s) are not authorized for ${use}: ${wrongUse.join(', ')}`), { status: 400 });
}

export async function submitGradeOutcomeEvidenceAndResume(input: {
  state: PipelineState;
  submission: GradeOutcomeEvidenceSubmission;
  actor: { sub: string };
  resume: ResumeGradePipeline;
  now?: string;
}): Promise<PipelineState> {
  if (!input.actor.sub.trim()) throw Object.assign(new Error('Authenticated GRADE reviewer is required'), { status: 401 });
  const stage = input.state.stages.grade;
  if (stage.status !== 'awaiting-human' && stage.status !== 'pending') throw Object.assign(new Error(`Cannot submit GRADE evidence while stage is ${stage.status}`), { status: 409 });
  const review = input.state.artifacts.gradeEvidenceReviewPackage as { items?: Array<{ outcome: string }> } | undefined;
  if (!review?.items?.some((item) => item.outcome === input.submission.outcome)) throw Object.assign(new Error(`GRADE outcome ${input.submission.outcome} is not active for evidence review`), { status: 409 });

  const catalog = new Map(buildGradeEvidenceCatalog(input.state).map((item) => [item.id, item]));
  if (input.submission.totalParticipants !== undefined) validateUse(catalog, input.submission.totalParticipantsEvidenceIds ?? [], 'information-size');
  if (input.submission.directness) validateUse(catalog, input.submission.directness.evidenceIds, 'directness');
  if (input.submission.publicationBias) {
    validateUse(catalog, input.submission.publicationBias.assessmentEvidenceIds, 'publication-bias');
    for (const signal of input.submission.publicationBias.signals) validateUse(catalog, signal.evidenceIds, 'publication-bias');
  }

  const current = Array.isArray(input.state.artifacts.gradeOutcomeEvidence) ? input.state.artifacts.gradeOutcomeEvidence as GradeOutcomeEvidenceInput[] : [];
  const existing = current.find((item) => item.outcome === input.submission.outcome);
  const addedFields: string[] = [];
  const next: GradeOutcomeEvidenceInput = existing ? structuredClone(existing) : { outcome: input.submission.outcome };
  const setField = <K extends 'totalParticipants' | 'directness' | 'publicationBias'>(key: K, value: GradeOutcomeEvidenceInput[K] | undefined): void => {
    if (value === undefined) return;
    const prior = next[key];
    if (prior !== undefined && semantic(prior) !== semantic(value)) throw Object.assign(new Error(`GRADE outcome ${input.submission.outcome} already has different ${key} evidence; use an explicit protocol/evidence amendment workflow`), { status: 409 });
    if (prior === undefined) addedFields.push(key);
    (next as Record<string, unknown>)[key] = structuredClone(value);
  };

  setField('totalParticipants', input.submission.totalParticipants);
  if (input.submission.totalParticipantsEvidenceIds) {
    const priorIds = next.totalParticipantsEvidenceIds;
    if (priorIds && semantic([...priorIds].sort()) !== semantic([...input.submission.totalParticipantsEvidenceIds].sort())) throw Object.assign(new Error(`GRADE outcome ${input.submission.outcome} already has different totalParticipants evidence IDs`), { status: 409 });
    next.totalParticipantsEvidenceIds = [...input.submission.totalParticipantsEvidenceIds];
  }
  setField('directness', input.submission.directness as GradeIndirectnessEvidence | undefined);
  const publicationBias: GradePublicationBiasEvidence | undefined = input.submission.publicationBias
    ? { signals: [
        { id: PUBLICATION_BIAS_BASIS_ID, description: 'Source-bound evidence that a publication-bias assessment was performed.', strength: 0, evidenceIds: input.submission.publicationBias.assessmentEvidenceIds },
        ...input.submission.publicationBias.signals.map((signal) => ({ ...signal, strength: 1 })),
      ] }
    : undefined;
  setField('publicationBias', publicationBias);
  next.evidenceIds = unique([
    ...(existing?.evidenceIds ?? []),
    ...(input.submission.totalParticipantsEvidenceIds ?? []),
    ...(input.submission.directness?.evidenceIds ?? []),
    ...(input.submission.publicationBias?.assessmentEvidenceIds ?? []),
    ...(input.submission.publicationBias?.signals.flatMap((signal) => signal.evidenceIds) ?? []),
  ]);

  if (existing && addedFields.length === 0 && semantic(existing) === semantic(next)) return input.state;
  input.state.artifacts.gradeOutcomeEvidence = [...current.filter((item) => item.outcome !== input.submission.outcome), next];
  const now = input.now ?? new Date().toISOString();
  const receipt: GradeOutcomeEvidenceReceipt = {
    version: 1,
    receiptId: `grade-evidence-${stableHash({ runId: input.state.runId, outcome: input.submission.outcome, next }).slice(0, 24)}`,
    outcome: input.submission.outcome,
    addedFields,
    submissionHash: semantic(input.submission),
    actorId: `user:${input.actor.sub}`,
    decidedAt: now,
  };
  const ledger = Array.isArray(input.state.artifacts.gradeOutcomeEvidenceLedger) ? input.state.artifacts.gradeOutcomeEvidenceLedger as GradeOutcomeEvidenceReceipt[] : [];
  input.state.artifacts.gradeOutcomeEvidenceLedger = [...ledger, receipt];
  const priorAttempt = stage.attempts;
  stage.status = 'pending'; stage.attempts = 0; stage.errors = [];
  delete stage.startedAt; delete stage.completedAt;
  input.state.updatedAt = now;
  input.state.audit.push({
    id: `grade-evidence-audit-${stableHash(receipt).slice(0, 24)}`,
    runId: input.state.runId,
    stage: 'grade',
    event: 'grade-outcome-evidence-submitted',
    timestamp: now,
    attempt: priorAttempt,
    details: { receiptId: receipt.receiptId, outcome: receipt.outcome, actorId: receipt.actorId, addedFields, submissionHash: receipt.submissionHash, retryBudgetReset: true },
  });
  return input.resume(input.state);
}
