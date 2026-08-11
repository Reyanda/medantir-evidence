import { createHash } from 'node:crypto';

export type AdjustmentStatus = 'unadjusted' | 'adjusted' | 'unknown';
export type AdjustmentEstimand = 'marginal' | 'conditional' | 'unspecified';

export interface AdjustmentIdentity {
  version: 1;
  status: AdjustmentStatus;
  estimand: AdjustmentEstimand;
  covariates: string[];
  sourceEvidenceIds: string[];
  rationale: string;
  identityHash: string;
}

export interface AdjustmentEquivalenceRule {
  id: string;
  protocolHash: string;
  rationale: string;
  actorId: string;
  createdAt: string;
  allowedIdentityHashes: string[];
}

export interface AdjustmentEstimateDescriptor {
  studyId: string;
  outcome: string;
  adjustment: AdjustmentIdentity;
}

export interface AdjustmentCompatibilityReceipt {
  version: 1;
  outcome: string;
  status: 'compatible' | 'incompatible' | 'unclassified';
  identityHashes: string[];
  groups: Array<{
    identityHash: string;
    status: AdjustmentStatus;
    estimand: AdjustmentEstimand;
    covariates: string[];
    studyIds: string[];
  }>;
  conflicts: string[];
  ruleId?: string;
  receiptHash: string;
}

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function normalizeCovariate(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createAdjustmentIdentity(input: {
  status: AdjustmentStatus;
  estimand?: AdjustmentEstimand;
  covariates?: string[];
  sourceEvidenceIds?: string[];
  rationale: string;
}): AdjustmentIdentity {
  if (!input.rationale.trim()) throw new Error('Adjustment identity requires a rationale');
  const covariates = [...new Set((input.covariates ?? []).map(normalizeCovariate).filter(Boolean))].sort();
  const sourceEvidenceIds = [...new Set((input.sourceEvidenceIds ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  const estimand = input.estimand ?? 'unspecified';
  if (input.status === 'unadjusted' && covariates.length > 0) throw new Error('Unadjusted estimate cannot declare adjustment covariates');
  if (input.status === 'adjusted' && covariates.length === 0) throw new Error('Adjusted estimate requires the reported adjustment covariates');
  if (input.status !== 'unknown' && sourceEvidenceIds.length === 0) throw new Error(`${input.status} adjustment identity requires source evidence`);
  const hashable = {
    version: 1 as const,
    status: input.status,
    estimand,
    covariates,
    sourceEvidenceIds,
    rationale: input.rationale.trim(),
  };
  return { ...hashable, identityHash: hash(hashable) };
}

export function validateAdjustmentIdentity(identity: AdjustmentIdentity): void {
  const recreated = createAdjustmentIdentity({
    status: identity.status,
    estimand: identity.estimand,
    covariates: identity.covariates,
    sourceEvidenceIds: identity.sourceEvidenceIds,
    rationale: identity.rationale,
  });
  if (recreated.identityHash !== identity.identityHash) throw new Error('Adjustment identity hash mismatch');
}

function validateRule(rule: AdjustmentEquivalenceRule): void {
  if (!rule.id.trim() || !rule.protocolHash.trim() || !rule.rationale.trim() || !rule.actorId.trim()) {
    throw new Error('Adjustment equivalence rule requires id, protocolHash, rationale, and actorId');
  }
  if (!Number.isFinite(Date.parse(rule.createdAt))) throw new Error('Adjustment equivalence rule requires a valid createdAt timestamp');
  if (rule.allowedIdentityHashes.length < 2) throw new Error('Adjustment equivalence rule must authorize at least two identities');
  if (new Set(rule.allowedIdentityHashes).size !== rule.allowedIdentityHashes.length) throw new Error('Adjustment equivalence rule identity hashes must be unique');
}

export function assessAdjustmentCompatibility(
  estimates: AdjustmentEstimateDescriptor[],
  rule?: AdjustmentEquivalenceRule,
): AdjustmentCompatibilityReceipt {
  if (estimates.length === 0) throw new Error('Adjustment compatibility requires at least one estimate');
  const outcomes = new Set(estimates.map((estimate) => estimate.outcome));
  if (outcomes.size !== 1) throw new Error('Adjustment compatibility must be assessed within one outcome');
  const studyIds = estimates.map((estimate) => estimate.studyId);
  if (new Set(studyIds).size !== studyIds.length) throw new Error('Adjustment compatibility requires one estimate per independent study');
  for (const estimate of estimates) validateAdjustmentIdentity(estimate.adjustment);
  if (rule) validateRule(rule);

  const grouped = new Map<string, AdjustmentEstimateDescriptor[]>();
  for (const estimate of estimates) {
    const current = grouped.get(estimate.adjustment.identityHash) ?? [];
    current.push(estimate);
    grouped.set(estimate.adjustment.identityHash, current);
  }
  const groups = [...grouped.entries()].map(([identityHash, rows]) => ({
    identityHash,
    status: rows[0]!.adjustment.status,
    estimand: rows[0]!.adjustment.estimand,
    covariates: [...rows[0]!.adjustment.covariates],
    studyIds: rows.map((row) => row.studyId).sort(),
  }));
  const identityHashes = groups.map((group) => group.identityHash).sort();
  const conflicts: string[] = [];

  if (groups.some((group) => group.status === 'unknown')) {
    conflicts.push('One or more estimates have unknown adjustment status; crude/adjusted compatibility cannot be established.');
  }

  const knownGroups = groups.filter((group) => group.status !== 'unknown');
  const statusSet = new Set(knownGroups.map((group) => group.status));
  if (statusSet.size > 1) {
    conflicts.push('Adjusted and unadjusted estimates are mixed without an explicit protocol equivalence rule.');
  }

  const estimands = new Set(knownGroups.map((group) => group.estimand));
  if (estimands.size > 1 || (estimands.has('unspecified') && knownGroups.length > 1)) {
    conflicts.push('Adjustment identities target different or unspecified marginal/conditional estimands.');
  }

  const adjustedGroups = knownGroups.filter((group) => group.status === 'adjusted');
  if (adjustedGroups.length > 1) {
    const sets = new Set(adjustedGroups.map((group) => group.covariates.join('|')));
    if (sets.size > 1) conflicts.push('Adjusted estimates use materially different covariate sets.');
  }

  let ruleId: string | undefined;
  if (conflicts.length > 0 && rule) {
    const allowed = new Set(rule.allowedIdentityHashes);
    const allAuthorized = identityHashes.every((identityHash) => allowed.has(identityHash));
    if (allAuthorized) {
      conflicts.length = 0;
      ruleId = rule.id;
    }
  }

  const status: AdjustmentCompatibilityReceipt['status'] = groups.some((group) => group.status === 'unknown') && conflicts.length > 0
    ? 'unclassified'
    : conflicts.length > 0
      ? 'incompatible'
      : 'compatible';
  const hashable = {
    version: 1 as const,
    outcome: estimates[0]!.outcome,
    status,
    identityHashes,
    groups,
    conflicts,
    ...(ruleId ? { ruleId } : {}),
  };
  return { ...hashable, receiptHash: hash(hashable) };
}
