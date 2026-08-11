import { scientificContentHash } from '../core/canonical-hash.js';
import {
  createSrQualificationCandidate,
  type SrQualificationCandidateInput,
  type SrQualificationComponent,
  type SrQualificationEvidenceBasis,
} from './sr-qualification-corpus.js';

export const SR_QUALIFICATION_ASSET_RECEIPT_SCHEMA_VERSION = 'medantir-sr-qualification-asset-receipt/1' as const;

export type SrQualificationVerificationMethod =
  | 'independent-reproduction'
  | 'dual-human-adjudication'
  | 'deterministic-contract-validation';

export type SrQualificationSourceIdentity =
  | {
      kind: 'sha256-object';
      objectId: string;
      sha256: string;
      byteLength: number;
      mediaType?: string;
    }
  | {
      kind: 'git-commit';
      repository: string;
      commit: string;
      tree?: string;
    };

export interface SrQualificationAnalysisPreflightBinding {
  reportHash: string;
  exactReproductionReady: boolean;
}

export interface SrQualificationAssetReceipt {
  schemaVersion: typeof SR_QUALIFICATION_ASSET_RECEIPT_SCHEMA_VERSION;
  candidateId: string;
  component: SrQualificationComponent;
  basis: Exclude<SrQualificationEvidenceBasis, 'published-aggregate' | 'not-available'>;
  sourceIdentities: SrQualificationSourceIdentity[];
  /** Immutable qualification-source capture hashes whose provenance/use declarations justify these source identities. */
  sourceCaptureHashes?: string[];
  componentArtifactHash: string;
  verificationMethod: SrQualificationVerificationMethod;
  verificationReceiptHash: string;
  verifierId: string;
  verifiedAt: string;
  analysisPreflight?: SrQualificationAnalysisPreflightBinding;
  notes?: string[];
  receiptHash: string;
}

/**
 * Construction accepts the full evidence-basis vocabulary so external JSON can be validated at runtime.
 * The returned receipt narrows to scientifically certifiable bases only. This avoids unsafe test/application casts.
 */
export type SrQualificationAssetReceiptInput = Omit<
  SrQualificationAssetReceipt,
  'schemaVersion' | 'receiptHash' | 'basis'
> & {
  basis: SrQualificationEvidenceBasis;
};

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function normalizeSource(identity: SrQualificationSourceIdentity): SrQualificationSourceIdentity {
  if (identity.kind === 'sha256-object') {
    const digest = sha(identity.sha256, 'Qualification source sha256');
    if (identity.objectId !== `HOBJ-${digest}`) throw new Error('Qualification content objectId must equal HOBJ-<sha256>.');
    if (!Number.isInteger(identity.byteLength) || identity.byteLength < 0) throw new Error('Qualification source byteLength must be a non-negative integer.');
    return {
      ...identity,
      sha256: digest,
      ...(identity.mediaType?.trim() ? { mediaType: identity.mediaType.trim().toLowerCase() } : {}),
    };
  }
  const repository = identity.repository.trim();
  const commit = identity.commit.trim().toLowerCase();
  if (!repository || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Qualification git source requires repository and full 40-character commit SHA.');
  if (identity.tree && !/^[a-f0-9]{40}$/i.test(identity.tree.trim())) throw new Error('Qualification git tree must be a full 40-character SHA when supplied.');
  return {
    kind: 'git-commit',
    repository,
    commit,
    ...(identity.tree ? { tree: identity.tree.trim().toLowerCase() } : {}),
  };
}

function normalizeNotes(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const result = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return result.length > 0 ? result : undefined;
}

function normalizeCaptureHashes(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const result = [...new Set(values.map((value) => sha(value, 'Qualification sourceCaptureHash')))].sort();
  return result.length > 0 ? result : undefined;
}

export function createSrQualificationAssetReceipt(input: SrQualificationAssetReceiptInput): SrQualificationAssetReceipt {
  if (!input.candidateId.trim() || !input.component) throw new Error('Qualification asset receipt requires candidate and component identity.');
  if (input.basis !== 'original-artifact' && input.basis !== 'source-reconstructed') {
    throw new Error('Qualification asset receipts cannot certify published aggregates or unavailable evidence as complete scientific gold.');
  }
  if (input.sourceIdentities.length === 0) throw new Error('Qualification asset receipt requires at least one immutable source identity.');
  const sourceIdentities = input.sourceIdentities.map(normalizeSource)
    .sort((a, b) => scientificContentHash(a).localeCompare(scientificContentHash(b)));
  const sourceCaptureHashes = normalizeCaptureHashes(input.sourceCaptureHashes);
  const componentArtifactHash = sha(input.componentArtifactHash, 'Qualification componentArtifactHash');
  const verificationReceiptHash = sha(input.verificationReceiptHash, 'Qualification verificationReceiptHash');
  let analysisPreflight: SrQualificationAnalysisPreflightBinding | undefined;
  if (input.component === 'analysis-runtime') {
    if (!input.analysisPreflight) throw new Error('Analysis-runtime qualification requires a bound reproduction preflight report.');
    analysisPreflight = {
      reportHash: sha(input.analysisPreflight.reportHash, 'Analysis preflight reportHash'),
      exactReproductionReady: input.analysisPreflight.exactReproductionReady,
    };
    if (!analysisPreflight.exactReproductionReady) {
      throw new Error('Analysis-runtime qualification cannot be certified while its reproduction preflight is not exactReproductionReady.');
    }
  } else if (input.analysisPreflight) {
    throw new Error(`Analysis preflight binding is only valid for the analysis-runtime qualification component, not '${input.component}'.`);
  }
  if (!input.verifierId.trim()) throw new Error('Qualification asset receipt requires verifier identity.');
  if (Number.isNaN(Date.parse(input.verifiedAt))) throw new Error('Qualification asset receipt verifiedAt must be a valid date-time.');
  const notes = normalizeNotes(input.notes);
  const base = {
    schemaVersion: SR_QUALIFICATION_ASSET_RECEIPT_SCHEMA_VERSION,
    candidateId: input.candidateId.trim(),
    component: input.component,
    basis: input.basis,
    sourceIdentities,
    ...(sourceCaptureHashes ? { sourceCaptureHashes } : {}),
    componentArtifactHash,
    verificationMethod: input.verificationMethod,
    verificationReceiptHash,
    verifierId: input.verifierId.trim(),
    verifiedAt: input.verifiedAt,
    ...(analysisPreflight ? { analysisPreflight } : {}),
    ...(notes ? { notes } : {}),
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}

export function verifySrQualificationAssetReceipt(receipt: SrQualificationAssetReceipt): string[] {
  const errors: string[] = [];
  try {
    const { schemaVersion: _schemaVersion, receiptHash: _receiptHash, ...input } = receipt;
    if (receipt.schemaVersion !== SR_QUALIFICATION_ASSET_RECEIPT_SCHEMA_VERSION) errors.push('Unsupported qualification asset receipt schema.');
    const rebuilt = createSrQualificationAssetReceipt(input);
    if (rebuilt.receiptHash !== receipt.receiptHash) errors.push('Qualification asset receipt hash mismatch.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return errors;
}

export function applySrQualificationAssetReceipt(input: {
  candidate: SrQualificationCandidateInput;
  receipt: SrQualificationAssetReceipt;
}): SrQualificationCandidateInput {
  const errors = verifySrQualificationAssetReceipt(input.receipt);
  if (errors.length > 0) throw new Error(`Invalid qualification asset receipt: ${errors.join(' ')}`);
  if (input.receipt.candidateId !== input.candidate.candidateId) throw new Error('Qualification asset receipt is bound to a different candidate.');
  const current = input.candidate.assets[input.receipt.component];
  if (!current) throw new Error(`Qualification candidate has no component '${input.receipt.component}'.`);
  if (current.basis !== input.receipt.basis && current.basis !== 'published-aggregate' && current.basis !== 'not-available') {
    throw new Error(`Qualification receipt basis '${input.receipt.basis}' conflicts with current component basis '${current.basis}'.`);
  }
  const references = [...new Set([
    ...(current.references ?? []),
    ...input.receipt.sourceIdentities.map((identity) => identity.kind === 'git-commit'
      ? `${identity.repository}@${identity.commit}`
      : identity.objectId),
    ...(input.receipt.sourceCaptureHashes ?? []).map((captureHash) => `capture:${captureHash}`),
  ])].sort();
  const updated: SrQualificationCandidateInput = structuredClone(input.candidate);
  updated.assets[input.receipt.component] = {
    status: 'frozen-verified',
    basis: input.receipt.basis,
    references,
    receiptHash: input.receipt.receiptHash,
    notes: [...new Set([...(current.notes ?? []), `Verified by ${input.receipt.verifierId} via ${input.receipt.verificationMethod}.`])].sort(),
  };
  createSrQualificationCandidate(updated);
  return updated;
}
