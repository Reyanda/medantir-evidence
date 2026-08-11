import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION = 'medantir-sr-prospective-holdout/1' as const;

export type SrProspectiveAnchorKind = 'git-commit' | 'transparency-log' | 'timestamp-authority';

export interface SrProspectivePublicAnchor {
  kind: SrProspectiveAnchorKind;
  anchorId: string;
  anchorHash: string;
  anchoredAt: string;
}

export interface SrProspectiveHoldoutRegistration {
  schemaVersion: typeof SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION;
  holdoutId: string;
  domain: string;
  registeredAt: string;
  evidenceCutoff: string;
  requestedModel: string;
  pinnedModelIdentity: string;
  pinnedProvider?: string;
  suiteHash: string;
  codeIdentityHash: string;
  promptContractHash: string;
  protocolHash: string;
  plannedPipelineCoverage: 100;
  publicAnchor: SrProspectivePublicAnchor;
  registrationHash: string;
}

export interface SrProspectiveExecutionReceipt {
  schemaVersion: typeof SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION;
  holdoutId: string;
  registrationHash: string;
  submittedAt: string;
  actualModelIdentity: string;
  provider?: string;
  modelOutputBundleHash: string;
  scientificRunSeal: string;
  executionEnvironmentHash: string;
  executionHash: string;
}

export interface SrProspectiveGoldRevealReceipt {
  schemaVersion: typeof SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION;
  holdoutId: string;
  registrationHash: string;
  goldReleasedAt: string;
  goldCaseHash: string;
  qualificationCandidateHash: string;
  cryptographicQualificationVerificationHash: string;
  goldRevealHash: string;
}

export interface SrProspectiveScoreReceipt {
  schemaVersion: typeof SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION;
  holdoutId: string;
  registrationHash: string;
  executionHash: string;
  goldRevealHash: string;
  modelOutputBundleHash: string;
  goldCaseHash: string;
  reproductionScore: number;
  pipelineCoverage: number;
  criticalFailures: number;
  exactTasks: number;
  totalTasks: number;
  scoredAt: string;
  scoreHash: string;
}

export interface SrProspectiveHoldoutVerification {
  holdoutId: string;
  valid: boolean;
  perfect: boolean;
  errors: string[];
  verificationHash: string;
}

export interface SrProspectiveQualificationSummary {
  requestedModel: string;
  validHoldouts: number;
  perfectHoldouts: number;
  distinctDomains: string[];
  allPerfect: boolean;
  qualificationReady: boolean;
  requiredHoldouts: number;
  requiredDomains: number;
  holdoutVerificationHashes: string[];
  summaryHash: string;
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function time(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be a valid date-time.`);
  return parsed;
}

function clean(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function anchor(input: SrProspectivePublicAnchor): SrProspectivePublicAnchor {
  return {
    kind: input.kind,
    anchorId: clean(input.anchorId, 'Prospective anchorId'),
    anchorHash: sha(input.anchorHash, 'Prospective anchorHash'),
    anchoredAt: input.anchoredAt,
  };
}

export function createSrProspectiveHoldoutRegistration(input: Omit<SrProspectiveHoldoutRegistration, 'schemaVersion' | 'registrationHash'>): SrProspectiveHoldoutRegistration {
  const registeredAt = time(input.registeredAt, 'Prospective registration registeredAt');
  const evidenceCutoff = time(input.evidenceCutoff, 'Prospective registration evidenceCutoff');
  const publicAnchor = anchor(input.publicAnchor);
  const anchoredAt = time(publicAnchor.anchoredAt, 'Prospective anchor anchoredAt');
  if (anchoredAt < registeredAt) throw new Error('Prospective public anchor cannot predate the registration it anchors.');
  if (input.plannedPipelineCoverage !== 100) throw new Error('Prospective SR100 holdout registration must plan 100% pipeline coverage.');
  const base = {
    schemaVersion: SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION,
    holdoutId: clean(input.holdoutId, 'Prospective holdoutId'),
    domain: clean(input.domain, 'Prospective domain'),
    registeredAt: input.registeredAt,
    evidenceCutoff: input.evidenceCutoff,
    requestedModel: clean(input.requestedModel, 'Prospective requestedModel'),
    pinnedModelIdentity: clean(input.pinnedModelIdentity, 'Prospective pinnedModelIdentity'),
    ...(input.pinnedProvider?.trim() ? { pinnedProvider: input.pinnedProvider.trim() } : {}),
    suiteHash: sha(input.suiteHash, 'Prospective suiteHash'),
    codeIdentityHash: sha(input.codeIdentityHash, 'Prospective codeIdentityHash'),
    promptContractHash: sha(input.promptContractHash, 'Prospective promptContractHash'),
    protocolHash: sha(input.protocolHash, 'Prospective protocolHash'),
    plannedPipelineCoverage: 100 as const,
    publicAnchor,
  };
  return { ...base, registrationHash: scientificContentHash(base) };
}

export function createSrProspectiveExecutionReceipt(input: Omit<SrProspectiveExecutionReceipt, 'schemaVersion' | 'executionHash'>): SrProspectiveExecutionReceipt {
  time(input.submittedAt, 'Prospective execution submittedAt');
  const base = {
    schemaVersion: SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION,
    holdoutId: clean(input.holdoutId, 'Prospective execution holdoutId'),
    registrationHash: sha(input.registrationHash, 'Prospective execution registrationHash'),
    submittedAt: input.submittedAt,
    actualModelIdentity: clean(input.actualModelIdentity, 'Prospective execution actualModelIdentity'),
    ...(input.provider?.trim() ? { provider: input.provider.trim() } : {}),
    modelOutputBundleHash: sha(input.modelOutputBundleHash, 'Prospective modelOutputBundleHash'),
    scientificRunSeal: sha(input.scientificRunSeal, 'Prospective scientificRunSeal'),
    executionEnvironmentHash: sha(input.executionEnvironmentHash, 'Prospective executionEnvironmentHash'),
  };
  return { ...base, executionHash: scientificContentHash(base) };
}

export function createSrProspectiveGoldRevealReceipt(input: Omit<SrProspectiveGoldRevealReceipt, 'schemaVersion' | 'goldRevealHash'>): SrProspectiveGoldRevealReceipt {
  time(input.goldReleasedAt, 'Prospective gold goldReleasedAt');
  const base = {
    schemaVersion: SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION,
    holdoutId: clean(input.holdoutId, 'Prospective gold holdoutId'),
    registrationHash: sha(input.registrationHash, 'Prospective gold registrationHash'),
    goldReleasedAt: input.goldReleasedAt,
    goldCaseHash: sha(input.goldCaseHash, 'Prospective goldCaseHash'),
    qualificationCandidateHash: sha(input.qualificationCandidateHash, 'Prospective qualificationCandidateHash'),
    cryptographicQualificationVerificationHash: sha(input.cryptographicQualificationVerificationHash, 'Prospective cryptographicQualificationVerificationHash'),
  };
  return { ...base, goldRevealHash: scientificContentHash(base) };
}

export function createSrProspectiveScoreReceipt(input: Omit<SrProspectiveScoreReceipt, 'schemaVersion' | 'scoreHash'>): SrProspectiveScoreReceipt {
  time(input.scoredAt, 'Prospective score scoredAt');
  for (const [label, value] of [['reproductionScore', input.reproductionScore], ['pipelineCoverage', input.pipelineCoverage]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Prospective ${label} must be within [0,100].`);
  }
  if (!Number.isInteger(input.criticalFailures) || input.criticalFailures < 0) throw new Error('Prospective criticalFailures must be a non-negative integer.');
  if (!Number.isInteger(input.exactTasks) || input.exactTasks < 0 || !Number.isInteger(input.totalTasks) || input.totalTasks <= 0 || input.exactTasks > input.totalTasks) {
    throw new Error('Prospective exactTasks/totalTasks are invalid.');
  }
  const base = {
    schemaVersion: SR_PROSPECTIVE_HOLDOUT_SCHEMA_VERSION,
    holdoutId: clean(input.holdoutId, 'Prospective score holdoutId'),
    registrationHash: sha(input.registrationHash, 'Prospective score registrationHash'),
    executionHash: sha(input.executionHash, 'Prospective score executionHash'),
    goldRevealHash: sha(input.goldRevealHash, 'Prospective score goldRevealHash'),
    modelOutputBundleHash: sha(input.modelOutputBundleHash, 'Prospective score modelOutputBundleHash'),
    goldCaseHash: sha(input.goldCaseHash, 'Prospective score goldCaseHash'),
    reproductionScore: input.reproductionScore,
    pipelineCoverage: input.pipelineCoverage,
    criticalFailures: input.criticalFailures,
    exactTasks: input.exactTasks,
    totalTasks: input.totalTasks,
    scoredAt: input.scoredAt,
  };
  return { ...base, scoreHash: scientificContentHash(base) };
}

export function verifySrProspectiveHoldout(input: {
  registration: SrProspectiveHoldoutRegistration;
  execution: SrProspectiveExecutionReceipt;
  gold: SrProspectiveGoldRevealReceipt;
  score: SrProspectiveScoreReceipt;
}): SrProspectiveHoldoutVerification {
  const errors: string[] = [];
  let registration: SrProspectiveHoldoutRegistration;
  let execution: SrProspectiveExecutionReceipt;
  let gold: SrProspectiveGoldRevealReceipt;
  let score: SrProspectiveScoreReceipt;
  try {
    const { schemaVersion: _rsv, registrationHash: _rh, ...registrationInput } = input.registration;
    registration = createSrProspectiveHoldoutRegistration(registrationInput);
    if (registration.registrationHash !== input.registration.registrationHash) errors.push('Prospective registration hash mismatch.');
    const { schemaVersion: _esv, executionHash: _eh, ...executionInput } = input.execution;
    execution = createSrProspectiveExecutionReceipt(executionInput);
    if (execution.executionHash !== input.execution.executionHash) errors.push('Prospective execution hash mismatch.');
    const { schemaVersion: _gsv, goldRevealHash: _gh, ...goldInput } = input.gold;
    gold = createSrProspectiveGoldRevealReceipt(goldInput);
    if (gold.goldRevealHash !== input.gold.goldRevealHash) errors.push('Prospective gold reveal hash mismatch.');
    const { schemaVersion: _ssv, scoreHash: _sh, ...scoreInput } = input.score;
    score = createSrProspectiveScoreReceipt(scoreInput);
    if (score.scoreHash !== input.score.scoreHash) errors.push('Prospective score hash mismatch.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    const base = { holdoutId: input.registration.holdoutId, valid: false, perfect: false, errors };
    return { ...base, verificationHash: scientificContentHash(base) };
  }

  if (execution.holdoutId !== registration.holdoutId || gold.holdoutId !== registration.holdoutId || score.holdoutId !== registration.holdoutId) errors.push('Prospective holdout IDs do not reconcile.');
  if (execution.registrationHash !== registration.registrationHash || gold.registrationHash !== registration.registrationHash || score.registrationHash !== registration.registrationHash) errors.push('Prospective receipts are bound to different registrations.');
  if (execution.actualModelIdentity !== registration.pinnedModelIdentity) errors.push('Prospective execution used a different actual model identity than preregistered.');
  if (registration.pinnedProvider && execution.provider !== registration.pinnedProvider) errors.push('Prospective execution used a different provider than preregistered.');
  const submitted = time(execution.submittedAt, 'Prospective execution submittedAt');
  const goldReleased = time(gold.goldReleasedAt, 'Prospective gold goldReleasedAt');
  const registered = time(registration.registeredAt, 'Prospective registration registeredAt');
  const anchored = time(registration.publicAnchor.anchoredAt, 'Prospective anchor anchoredAt');
  if (registered >= submitted) errors.push('Prospective execution must occur after preregistration.');
  if (anchored >= submitted) errors.push('Prospective public anchor must exist before model execution is submitted.');
  if (submitted >= goldReleased) errors.push('Prospective model output was submitted at or after gold release; temporal holdout is contaminated.');
  if (score.executionHash !== execution.executionHash || score.modelOutputBundleHash !== execution.modelOutputBundleHash) errors.push('Prospective score is not bound to the prerelease model output bundle.');
  if (score.goldRevealHash !== gold.goldRevealHash || score.goldCaseHash !== gold.goldCaseHash) errors.push('Prospective score is bound to a different gold reveal/case.');
  if (time(score.scoredAt, 'Prospective score scoredAt') < goldReleased) errors.push('Prospective score predates gold release.');
  const valid = errors.length === 0;
  const perfect = valid
    && score.reproductionScore === 100
    && score.pipelineCoverage === 100
    && score.criticalFailures === 0
    && score.exactTasks === score.totalTasks;
  const base = { holdoutId: registration.holdoutId, valid, perfect, errors: [...new Set(errors)].sort() };
  return { ...base, verificationHash: scientificContentHash(base) };
}

export function summarizeSrProspectiveQualification(input: {
  requestedModel: string;
  holdouts: Array<{
    domain: string;
    verification: SrProspectiveHoldoutVerification;
  }>;
  requiredHoldouts?: number;
  requiredDomains?: number;
}): SrProspectiveQualificationSummary {
  const requiredHoldouts = input.requiredHoldouts ?? 2;
  const requiredDomains = input.requiredDomains ?? 2;
  if (!Number.isInteger(requiredHoldouts) || requiredHoldouts < 1 || !Number.isInteger(requiredDomains) || requiredDomains < 1) throw new Error('Prospective qualification thresholds must be positive integers.');
  const valid = input.holdouts.filter((item) => item.verification.valid);
  const perfect = valid.filter((item) => item.verification.perfect);
  const distinctDomains = [...new Set(perfect.map((item) => item.domain.trim()).filter(Boolean))].sort();
  const allPerfect = input.holdouts.length > 0 && input.holdouts.every((item) => item.verification.valid && item.verification.perfect);
  const qualificationReady = allPerfect && perfect.length >= requiredHoldouts && distinctDomains.length >= requiredDomains;
  const base = {
    requestedModel: clean(input.requestedModel, 'Prospective qualification requestedModel'),
    validHoldouts: valid.length,
    perfectHoldouts: perfect.length,
    distinctDomains,
    allPerfect,
    qualificationReady,
    requiredHoldouts,
    requiredDomains,
    holdoutVerificationHashes: input.holdouts.map((item) => item.verification.verificationHash).sort(),
  };
  return { ...base, summaryHash: scientificContentHash(base) };
}
