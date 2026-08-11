import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_ANALYSIS_PREFLIGHT_SCHEMA_VERSION = 'medantir-sr-analysis-preflight/1' as const;

export type SrAnalysisPreflightSeverity = 'blocker' | 'warning' | 'info';
export type SrAnalysisRepairSemanticImpact = 'none' | 'potential' | 'scientific';

export interface SrAnalysisPreflightFinding {
  code: string;
  severity: SrAnalysisPreflightSeverity;
  message: string;
  files?: string[];
  evidence?: string[];
}

export interface SrAnalysisEnvironmentRepair {
  repairId: string;
  description: string;
  affectedFiles: string[];
  semanticImpact: SrAnalysisRepairSemanticImpact;
  rationale: string;
}

export interface SrAnalysisRuntimeDependency {
  name: string;
  version: string | null;
  source?: string;
}

export interface SrAnalysisRuntimeSourceObject {
  objectId: string;
  sha256: string;
  byteLength: number;
  path?: string;
  revision?: string;
}

export interface SrAnalysisReproductionPreflightInput {
  candidateId: string;
  /** Human-readable repository/deposit identity, e.g. org/repo or osf.io/U3YRP. */
  sourceRepository: string;
  /** Full Git commit when the runtime source is Git-backed. Null for content-addressed deposits. */
  sourceCommit: string | null;
  /** Exact HOBJ identities when the runtime source is not Git-backed. */
  sourceObjects?: SrAnalysisRuntimeSourceObject[];
  language: 'R' | 'Python' | 'other';
  runtimeVersion: string | null;
  /** Empty only while source inventory has not yet established the executable entrypoints. */
  entrypoints: string[];
  dependencies: SrAnalysisRuntimeDependency[];
  findings: SrAnalysisPreflightFinding[];
  proposedRepairs?: SrAnalysisEnvironmentRepair[];
}

export interface SrAnalysisReproductionPreflightReport extends SrAnalysisReproductionPreflightInput {
  blockerCount: number;
  warningCount: number;
  unresolvedSourceIdentity: boolean;
  unresolvedEntrypoints: boolean;
  unresolvedRuntimeIdentity: boolean;
  nonScientificRepairCount: number;
  potentiallySemanticRepairCount: number;
  runnableWithoutSemanticRepair: boolean;
  exactReproductionReady: boolean;
  reportHash: string;
}

function clean(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function exactVersion(value: string | null): boolean {
  if (!value?.trim()) return false;
  const v = value.trim().toLowerCase();
  return !['latest', '*', 'any', 'unknown', 'unspecified'].includes(v) && !/[~^><=*x]/i.test(v);
}

function normalizeSourceObject(input: SrAnalysisRuntimeSourceObject): SrAnalysisRuntimeSourceObject {
  const sha256 = input.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Analysis preflight source object sha256 must be a SHA-256 digest.');
  if (input.objectId !== `HOBJ-${sha256}`) throw new Error('Analysis preflight source objectId must equal HOBJ-<sha256>.');
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0) throw new Error('Analysis preflight source object byteLength must be a non-negative integer.');
  return {
    objectId: input.objectId,
    sha256,
    byteLength: input.byteLength,
    ...(input.path?.trim() ? { path: input.path.trim() } : {}),
    ...(input.revision?.trim() ? { revision: input.revision.trim() } : {}),
  };
}

function normalizeSourceIdentity(input: SrAnalysisReproductionPreflightInput): {
  sourceCommit: string | null;
  sourceObjects?: SrAnalysisRuntimeSourceObject[];
  unresolvedSourceIdentity: boolean;
} {
  const sourceCommit = input.sourceCommit?.trim().toLowerCase() ?? null;
  if (sourceCommit && !/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error('Analysis preflight sourceCommit must be a full immutable Git commit SHA when supplied.');
  }
  const sourceObjects = (input.sourceObjects ?? []).map(normalizeSourceObject)
    .sort((a, b) => `${a.path ?? ''}:${a.objectId}`.localeCompare(`${b.path ?? ''}:${b.objectId}`));
  if (sourceCommit && sourceObjects.length > 0) {
    throw new Error('Analysis preflight must use either a Git commit or content-addressed source objects, not both.');
  }
  return {
    sourceCommit,
    ...(sourceObjects.length > 0 ? { sourceObjects } : {}),
    unresolvedSourceIdentity: !sourceCommit && sourceObjects.length === 0,
  };
}

export function createSrAnalysisReproductionPreflight(input: SrAnalysisReproductionPreflightInput): SrAnalysisReproductionPreflightReport {
  if (!input.candidateId.trim() || !input.sourceRepository.trim()) throw new Error('Analysis preflight requires candidate and source-repository identity.');
  const source = normalizeSourceIdentity(input);
  const entrypoints = clean(input.entrypoints);
  const unresolvedEntrypoints = entrypoints.length === 0;
  const dependencyNames = input.dependencies.map((dependency) => dependency.name.trim()).filter(Boolean);
  if (dependencyNames.length !== input.dependencies.length || new Set(dependencyNames).size !== dependencyNames.length) {
    throw new Error('Analysis preflight dependencies require unique non-empty names.');
  }
  const findings = input.findings.map((finding) => ({
    ...finding,
    code: finding.code.trim().toUpperCase(),
    message: finding.message.trim(),
    ...(finding.files ? { files: clean(finding.files) } : {}),
    ...(finding.evidence ? { evidence: clean(finding.evidence) } : {}),
  }));
  if (findings.some((finding) => !finding.code || !finding.message)) throw new Error('Analysis preflight findings require code and message.');
  const repairs = (input.proposedRepairs ?? []).map((repair) => ({
    ...repair,
    repairId: repair.repairId.trim(),
    description: repair.description.trim(),
    affectedFiles: clean(repair.affectedFiles),
    rationale: repair.rationale.trim(),
  }));
  if (repairs.some((repair) => !repair.repairId || !repair.description || !repair.rationale)) throw new Error('Analysis preflight repairs require ID, description and rationale.');
  const unresolvedRuntimeIdentity = !exactVersion(input.runtimeVersion)
    || input.dependencies.some((dependency) => !exactVersion(dependency.version));
  const blockerCount = findings.filter((finding) => finding.severity === 'blocker').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const nonScientificRepairCount = repairs.filter((repair) => repair.semanticImpact === 'none').length;
  const potentiallySemanticRepairCount = repairs.filter((repair) => repair.semanticImpact !== 'none').length;
  const runnableWithoutSemanticRepair = blockerCount === 0 && potentiallySemanticRepairCount === 0;
  const exactReproductionReady = runnableWithoutSemanticRepair
    && !source.unresolvedSourceIdentity
    && !unresolvedEntrypoints
    && !unresolvedRuntimeIdentity;
  const base = {
    ...input,
    candidateId: input.candidateId.trim(),
    sourceRepository: input.sourceRepository.trim(),
    sourceCommit: source.sourceCommit,
    ...(source.sourceObjects ? { sourceObjects: source.sourceObjects } : {}),
    runtimeVersion: input.runtimeVersion?.trim() ?? null,
    entrypoints,
    dependencies: [...input.dependencies].map((dependency) => ({
      name: dependency.name.trim(),
      version: dependency.version?.trim() ?? null,
      ...(dependency.source?.trim() ? { source: dependency.source.trim() } : {}),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    findings: findings.sort((a, b) => `${a.severity}:${a.code}`.localeCompare(`${b.severity}:${b.code}`)),
    ...(repairs.length > 0 ? { proposedRepairs: repairs.sort((a, b) => a.repairId.localeCompare(b.repairId)) } : {}),
    blockerCount,
    warningCount,
    unresolvedSourceIdentity: source.unresolvedSourceIdentity,
    unresolvedEntrypoints,
    unresolvedRuntimeIdentity,
    nonScientificRepairCount,
    potentiallySemanticRepairCount,
    runnableWithoutSemanticRepair,
    exactReproductionReady,
  };
  return { ...base, reportHash: scientificContentHash(base) };
}
