import { createHash } from 'node:crypto';
import type { PipelineState, StageName } from '../core/types.js';
import type {
  GradeInconsistencyPolicy,
  GradeIndirectnessPolicy,
  GradeImprecisionPolicy,
  GradePolicySet,
  GradePublicationBiasPolicy,
  GradeRiskOfBiasPolicy,
} from './grade.js';

export interface GradePolicyConfiguration {
  version: string;
  rationale: string;
  riskOfBias: Omit<GradeRiskOfBiasPolicy, 'id' | 'protocolHash' | 'version' | 'rationale' | 'frozenAt'>;
  inconsistency: Omit<GradeInconsistencyPolicy, 'id' | 'protocolHash' | 'version' | 'rationale' | 'frozenAt'>;
  imprecision: Omit<GradeImprecisionPolicy, 'id' | 'protocolHash' | 'version' | 'rationale' | 'frozenAt'>;
  indirectness: Omit<GradeIndirectnessPolicy, 'id' | 'protocolHash' | 'version' | 'rationale' | 'frozenAt'>;
  publicationBias: Omit<GradePublicationBiasPolicy, 'id' | 'protocolHash' | 'version' | 'rationale' | 'frozenAt'>;
}

export interface GradePolicyAmendmentReceipt {
  version: 1;
  amendmentId: string;
  protocolHash: string;
  beforePolicyHash: string | null;
  afterPolicyHash: string;
  rationale: string;
  actorId: string;
  decidedAt: string;
  timing: 'prospective' | 'post-results-amendment';
  earliestReplayStage: 'grade';
  warning?: string;
}

const GRADE_DOWNSTREAM_STAGES: StageName[] = ['grade', 'report', 'human-verify'];
const GRADE_DOWNSTREAM_ARTIFACTS = [
  'grade', 'gradeOutcomeAssessments', 'gradeEvidenceReviewPackage', 'gradeQuality',
  'draftReport', 'verificationPackage', 'verificationOutcome', 'finalReport',
] as const;
const RESULT_STAGES = new Set<StageName>([
  'search-execute', 'deduplicate', 'tiab-screen', 'fulltext-retrieve', 'pdf-to-text',
  'fulltext-screen', 'extract', 'risk-of-bias', 'synthesise',
]);

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function clean(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function objectField(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`GRADE policy ${key} must be an object`), { status: 400 });
  }
  return value as Record<string, unknown>;
}

function finiteNumber(parent: Record<string, unknown>, key: string, label: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw Object.assign(new Error(`${label} must be a finite number`), { status: 400 });
  }
  return value;
}

function range(value: number, min: number, max: number, label: string, includeMin = true): number {
  const lowerOkay = includeMin ? value >= min : value > min;
  if (!lowerOkay || value > max) throw Object.assign(new Error(`${label} must be within ${includeMin ? '[' : '('}${min},${max}]`), { status: 400 });
  return value;
}

function positiveInteger(parent: Record<string, unknown>, key: string, label: string): number {
  const value = finiteNumber(parent, key, label);
  if (!Number.isInteger(value) || value < 1) throw Object.assign(new Error(`${label} must be an integer >= 1`), { status: 400 });
  return value;
}

function booleanField(parent: Record<string, unknown>, key: string, label: string): boolean {
  const value = parent[key];
  if (typeof value !== 'boolean') throw Object.assign(new Error(`${label} must be boolean`), { status: 400 });
  return value;
}

export function parseGradePolicyConfiguration(value: unknown): GradePolicyConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('GRADE policy submission must be an object'), { status: 400 });
  const root = value as Record<string, unknown>;
  if (typeof root.version !== 'string' || !root.version.trim()) throw Object.assign(new Error('GRADE policy version is required'), { status: 400 });
  if (typeof root.rationale !== 'string' || !root.rationale.trim()) throw Object.assign(new Error('GRADE policy rationale is required'), { status: 400 });
  const rob = objectField(root, 'riskOfBias');
  const inc = objectField(root, 'inconsistency');
  const imp = objectField(root, 'imprecision');
  const ind = objectField(root, 'indirectness');
  const pub = objectField(root, 'publicationBias');

  const highSerious = range(finiteNumber(rob, 'highRiskWeightSerious', 'GRADE riskOfBias.highRiskWeightSerious'), 0, 1, 'GRADE riskOfBias.highRiskWeightSerious');
  const highVery = range(finiteNumber(rob, 'highRiskWeightVerySerious', 'GRADE riskOfBias.highRiskWeightVerySerious'), 0, 1, 'GRADE riskOfBias.highRiskWeightVerySerious');
  const someSerious = range(finiteNumber(rob, 'someConcernsWeightSerious', 'GRADE riskOfBias.someConcernsWeightSerious'), 0, 1, 'GRADE riskOfBias.someConcernsWeightSerious');
  if (highVery < highSerious) throw Object.assign(new Error('GRADE riskOfBias.highRiskWeightVerySerious must be >= highRiskWeightSerious'), { status: 400 });
  const minimumWeightCoverage = rob.minimumWeightCoverage === undefined
    ? undefined
    : range(finiteNumber(rob, 'minimumWeightCoverage', 'GRADE riskOfBias.minimumWeightCoverage'), 0, 1, 'GRADE riskOfBias.minimumWeightCoverage', false);

  const i2Serious = range(finiteNumber(inc, 'i2Serious', 'GRADE inconsistency.i2Serious'), 0, 100, 'GRADE inconsistency.i2Serious');
  const i2Very = range(finiteNumber(inc, 'i2VerySerious', 'GRADE inconsistency.i2VerySerious'), 0, 100, 'GRADE inconsistency.i2VerySerious');
  if (i2Very < i2Serious) throw Object.assign(new Error('GRADE inconsistency.i2VerySerious must be >= i2Serious'), { status: 400 });

  const nullValue = finiteNumber(imp, 'nullValue', 'GRADE imprecision.nullValue');
  const benefitThreshold = finiteNumber(imp, 'benefitThreshold', 'GRADE imprecision.benefitThreshold');
  const harmThreshold = finiteNumber(imp, 'harmThreshold', 'GRADE imprecision.harmThreshold');
  if (!(benefitThreshold < nullValue && nullValue < harmThreshold)) throw Object.assign(new Error('GRADE imprecision thresholds must satisfy benefitThreshold < nullValue < harmThreshold'), { status: 400 });
  const requiredInformationSize = finiteNumber(imp, 'requiredInformationSize', 'GRADE imprecision.requiredInformationSize');
  if (!(requiredInformationSize > 0)) throw Object.assign(new Error('GRADE imprecision.requiredInformationSize must be > 0'), { status: 400 });
  const verySeriousOisFraction = range(finiteNumber(imp, 'verySeriousOisFraction', 'GRADE imprecision.verySeriousOisFraction'), 0, 1, 'GRADE imprecision.verySeriousOisFraction', false);

  const seriousSignalWeight = finiteNumber(pub, 'seriousSignalWeight', 'GRADE publicationBias.seriousSignalWeight');
  const verySeriousSignalWeight = finiteNumber(pub, 'verySeriousSignalWeight', 'GRADE publicationBias.verySeriousSignalWeight');
  if (!(seriousSignalWeight > 0)) throw Object.assign(new Error('GRADE publicationBias.seriousSignalWeight must be > 0'), { status: 400 });
  if (verySeriousSignalWeight < seriousSignalWeight) throw Object.assign(new Error('GRADE publicationBias.verySeriousSignalWeight must be >= seriousSignalWeight'), { status: 400 });

  return {
    version: root.version.trim(),
    rationale: root.rationale.trim(),
    riskOfBias: {
      highRiskWeightSerious: highSerious,
      highRiskWeightVerySerious: highVery,
      someConcernsWeightSerious: someSerious,
      ...(minimumWeightCoverage !== undefined ? { minimumWeightCoverage } : {}),
    },
    inconsistency: {
      i2Serious,
      i2VerySerious: i2Very,
      predictionIntervalDecisionConflictSerious: booleanField(inc, 'predictionIntervalDecisionConflictSerious', 'GRADE inconsistency.predictionIntervalDecisionConflictSerious'),
    },
    imprecision: { nullValue, benefitThreshold, harmThreshold, requiredInformationSize, verySeriousOisFraction },
    indirectness: {
      seriousIfPartialDimensionsAtLeast: positiveInteger(ind, 'seriousIfPartialDimensionsAtLeast', 'GRADE indirectness.seriousIfPartialDimensionsAtLeast'),
      verySeriousIfIndirectDimensionsAtLeast: positiveInteger(ind, 'verySeriousIfIndirectDimensionsAtLeast', 'GRADE indirectness.verySeriousIfIndirectDimensionsAtLeast'),
    },
    publicationBias: { seriousSignalWeight, verySeriousSignalWeight },
  };
}

function policyId(domain: string, protocolHash: string, config: unknown): string {
  return `grade-policy-${domain}-${digest({ protocolHash, config }).slice(0, 20)}`;
}

export function gradePolicyHash(policy: GradePolicySet): string { return digest(policy); }

function gradePolicySemanticHash(policy: GradePolicySet): string {
  const stripFrozenAt = <T extends { frozenAt: string }>(item: T | undefined): Omit<T, 'frozenAt'> | null => {
    if (!item) return null;
    const { frozenAt: _frozenAt, ...rest } = item;
    return rest;
  };
  return digest({
    riskOfBias: stripFrozenAt(policy.riskOfBias),
    inconsistency: stripFrozenAt(policy.inconsistency),
    imprecision: stripFrozenAt(policy.imprecision),
    indirectness: stripFrozenAt(policy.indirectness),
    publicationBias: stripFrozenAt(policy.publicationBias),
  });
}

export function freezeGradePolicySet(input: { protocolHash: string; configuration: GradePolicyConfiguration; frozenAt: string }): GradePolicySet {
  const protocolHash = clean(input.protocolHash, 'protocolHash');
  const version = clean(input.configuration.version, 'GRADE policy version');
  const rationale = clean(input.configuration.rationale, 'GRADE policy rationale');
  if (!Number.isFinite(Date.parse(input.frozenAt))) throw new Error('GRADE policy frozenAt must be a valid timestamp');
  const identity = { protocolHash, version, rationale, frozenAt: input.frozenAt };
  return {
    riskOfBias: { ...identity, id: policyId('risk-of-bias', protocolHash, input.configuration.riskOfBias), ...input.configuration.riskOfBias },
    inconsistency: { ...identity, id: policyId('inconsistency', protocolHash, input.configuration.inconsistency), ...input.configuration.inconsistency },
    imprecision: { ...identity, id: policyId('imprecision', protocolHash, input.configuration.imprecision), ...input.configuration.imprecision },
    indirectness: { ...identity, id: policyId('indirectness', protocolHash, input.configuration.indirectness), ...input.configuration.indirectness },
    publicationBias: { ...identity, id: policyId('publication-bias', protocolHash, input.configuration.publicationBias), ...input.configuration.publicationBias },
  };
}

function historicalResultAttemptExists(state: PipelineState): boolean {
  const ledger = state.artifacts.scientificRunLedger as {
    attempts?: Array<{ stage?: StageName; status?: string }>;
  } | undefined;
  return (ledger?.attempts ?? []).some((attempt) => attempt.stage && RESULT_STAGES.has(attempt.stage));
}

function scientificResultsExist(state: PipelineState): boolean {
  if (historicalResultAttemptExists(state)) return true;
  return [...RESULT_STAGES].some((name) => {
    const status = state.stages[name]?.status;
    return status === 'running' || status === 'passed' || status === 'awaiting-human' || status === 'failed';
  });
}

function protocolHashOf(state: PipelineState): string {
  const protocol = state.artifacts.protocolPackage as { checksum?: unknown } | undefined;
  const checksum = typeof protocol?.checksum === 'string' ? protocol.checksum.trim() : '';
  if (!checksum) throw Object.assign(new Error('GRADE policy cannot be frozen before a final protocol checksum exists'), { status: 409 });
  return checksum;
}

function invalidateGradeAndDownstream(state: PipelineState): void {
  for (const artifact of GRADE_DOWNSTREAM_ARTIFACTS) delete state.artifacts[artifact];
  for (const name of GRADE_DOWNSTREAM_STAGES) state.stages[name] = { name, status: 'pending', attempts: 0, errors: [] };
}

function reopenProspectivePolicyGate(state: PipelineState): boolean {
  const requirement = state.artifacts.gradePolicyRequirement as { protocolHash?: unknown; status?: unknown } | undefined;
  const protocolStage = state.stages['protocol-finalise'];
  if (!requirement || typeof requirement.protocolHash !== 'string') return false;
  if (protocolStage.status !== 'awaiting-human' && protocolStage.status !== 'failed') return false;
  protocolStage.status = 'pending';
  protocolStage.attempts = 0;
  protocolStage.errors = [];
  delete protocolStage.startedAt;
  delete protocolStage.completedAt;
  return true;
}

export function recordGradePolicyConfiguration(input: {
  state: PipelineState;
  configuration: GradePolicyConfiguration;
  actorId: string;
  decidedAt: string;
}): { state: PipelineState; receipt: GradePolicyAmendmentReceipt; changed: boolean } {
  const actorId = clean(input.actorId, 'GRADE policy actorId');
  const rationale = clean(input.configuration.rationale, 'GRADE policy rationale');
  if (!Number.isFinite(Date.parse(input.decidedAt))) throw new Error('GRADE policy decidedAt must be a valid timestamp');
  const protocolHash = protocolHashOf(input.state);
  const after = freezeGradePolicySet({ protocolHash, configuration: input.configuration, frozenAt: input.decidedAt });
  const afterPolicyHash = gradePolicyHash(after);
  const before = input.state.artifacts.gradePolicySet as GradePolicySet | undefined;
  const beforePolicyHash = before ? gradePolicyHash(before) : null;

  if (before && gradePolicySemanticHash(before) === gradePolicySemanticHash(after)) {
    const amendments = Array.isArray(input.state.artifacts.gradePolicyAmendments)
      ? input.state.artifacts.gradePolicyAmendments as GradePolicyAmendmentReceipt[] : [];
    const receipt = amendments.find((item) => item.afterPolicyHash === beforePolicyHash);
    if (receipt) {
      const gateReopened = reopenProspectivePolicyGate(input.state);
      if (gateReopened) input.state.updatedAt = input.decidedAt;
      return { state: input.state, receipt, changed: gateReopened };
    }
  }

  const timing: GradePolicyAmendmentReceipt['timing'] = scientificResultsExist(input.state) ? 'post-results-amendment' : 'prospective';
  const warning = timing === 'post-results-amendment'
    ? 'GRADE decision thresholds were introduced or changed after review results existed. This is an auditable post-results protocol amendment and must be disclosed in the final report.'
    : undefined;
  const receipt: GradePolicyAmendmentReceipt = {
    version: 1,
    amendmentId: `grade-amend-${digest({ protocolHash, beforePolicyHash, afterSemantic: gradePolicySemanticHash(after), actorId, rationale }).slice(0, 24)}`,
    protocolHash, beforePolicyHash, afterPolicyHash, rationale, actorId, decidedAt: input.decidedAt,
    timing, earliestReplayStage: 'grade', ...(warning ? { warning } : {}),
  };

  invalidateGradeAndDownstream(input.state);
  input.state.artifacts.gradePolicySet = after;
  const amendments = Array.isArray(input.state.artifacts.gradePolicyAmendments)
    ? input.state.artifacts.gradePolicyAmendments as GradePolicyAmendmentReceipt[] : [];
  input.state.artifacts.gradePolicyAmendments = [...amendments, receipt];
  if (warning) input.state.artifacts.gradePolicyLateAmendment = { amendmentId: receipt.amendmentId, warning };
  else delete input.state.artifacts.gradePolicyLateAmendment;
  const gateReopened = reopenProspectivePolicyGate(input.state);
  input.state.updatedAt = input.decidedAt;
  input.state.audit.push({
    id: `grade-policy-audit-${digest({ runId: input.state.runId, amendmentId: receipt.amendmentId }).slice(0, 24)}`,
    runId: input.state.runId,
    stage: 'grade',
    event: 'grade-policy-amended',
    timestamp: input.decidedAt,
    attempt: 0,
    details: {
      amendmentId: receipt.amendmentId, protocolHash, beforePolicyHash, afterPolicyHash, actorId, timing,
      earliestReplayStage: 'grade', invalidatedStages: GRADE_DOWNSTREAM_STAGES,
      invalidatedArtifacts: GRADE_DOWNSTREAM_ARTIFACTS,
      prospectiveGateReopened: gateReopened,
      ...(warning ? { warning } : {}),
    },
  });
  return { state: input.state, receipt, changed: true };
}
