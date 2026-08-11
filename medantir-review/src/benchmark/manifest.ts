import type { BenchmarkMode, BenchmarkReferenceArtifact } from './types.js';
import type { ReviewType, StageName } from '../core/types.js';

export interface BenchmarkManifestArtifact extends BenchmarkReferenceArtifact {
  id: string;
  path: string;
  required: boolean;
  checksum?: string;
}

export interface BenchmarkManifest {
  schemaVersion: '1.0';
  benchmarkId: string;
  benchmarkVersion: string;
  mode: BenchmarkMode;
  reviewType: ReviewType;
  diseaseDomains: string[];
  sourceReview: {
    title: string;
    locator: string;
    publicationDate?: string;
    lastSearchDate?: string;
  };
  oracleSealed: boolean;
  expectedStages: StageName[];
  artifacts: BenchmarkManifestArtifact[];
  softwareEnvironment: {
    nodeVersion?: string;
    packageLockChecksum?: string;
    containerDigest?: string;
  };
  curators: Array<{
    id: string;
    role: 'primary' | 'independent-verifier';
    signedAt: string;
  }>;
}

export interface ManifestValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ManifestValidationResult {
  ok: boolean;
  issues: ManifestValidationIssue[];
}

const sha256Pattern = /^[a-f0-9]{64}$/i;

export function validateBenchmarkManifest(manifest: BenchmarkManifest): ManifestValidationResult {
  const issues: ManifestValidationIssue[] = [];
  if (!manifest.benchmarkId.trim()) issues.push({ code: 'MISSING_ID', message: 'benchmarkId is required.', severity: 'error' });
  if (!manifest.benchmarkVersion.trim()) issues.push({ code: 'MISSING_VERSION', message: 'benchmarkVersion is required.', severity: 'error' });
  if (!manifest.sourceReview.title.trim() || !manifest.sourceReview.locator.trim()) {
    issues.push({ code: 'MISSING_SOURCE_REVIEW', message: 'Source review title and locator are required.', severity: 'error' });
  }
  if (manifest.expectedStages.length === 0) {
    issues.push({ code: 'NO_EXPECTED_STAGES', message: 'At least one benchmarked stage is required.', severity: 'error' });
  }

  const artifactIds = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (artifactIds.has(artifact.id)) {
      issues.push({ code: 'DUPLICATE_ARTIFACT_ID', message: `Duplicate artifact id '${artifact.id}'.`, severity: 'error' });
    }
    artifactIds.add(artifact.id);
    if (!artifact.path.trim()) {
      issues.push({ code: 'MISSING_ARTIFACT_PATH', message: `Artifact '${artifact.id}' has no path.`, severity: 'error' });
    }
    if (artifact.checksum && !sha256Pattern.test(artifact.checksum)) {
      issues.push({ code: 'INVALID_CHECKSUM', message: `Artifact '${artifact.id}' checksum is not SHA-256.`, severity: 'error' });
    }
    if (manifest.mode === 'frozen-reproduction' && artifact.required && !artifact.checksum) {
      issues.push({ code: 'UNFROZEN_REQUIRED_ARTIFACT', message: `Required artifact '${artifact.id}' lacks a checksum.`, severity: 'error' });
    }
  }

  if (manifest.mode === 'frozen-reproduction' && !manifest.oracleSealed) {
    issues.push({ code: 'ORACLE_NOT_SEALED', message: 'Frozen reproduction requires a sealed oracle package.', severity: 'error' });
  }
  if (manifest.mode === 'independent-audit' && !manifest.oracleSealed) {
    issues.push({ code: 'AUDIT_ORACLE_VISIBLE', message: 'Independent audit requires the answer oracle to be sealed during execution.', severity: 'error' });
  }

  const roles = new Set(manifest.curators.map((curator) => curator.role));
  if (!roles.has('primary')) {
    issues.push({ code: 'NO_PRIMARY_CURATOR', message: 'A primary benchmark curator is required.', severity: 'error' });
  }
  if (!roles.has('independent-verifier')) {
    issues.push({ code: 'NO_INDEPENDENT_CURATOR', message: 'An independent benchmark verifier is required.', severity: 'error' });
  }

  if (!manifest.softwareEnvironment.packageLockChecksum && !manifest.softwareEnvironment.containerDigest) {
    issues.push({
      code: 'ENVIRONMENT_NOT_FROZEN',
      message: 'Provide a package-lock checksum or container digest for reproducible execution.',
      severity: manifest.mode === 'frozen-reproduction' ? 'error' : 'warning',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== 'error'),
    issues,
  };
}
