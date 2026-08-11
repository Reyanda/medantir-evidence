import { scientificContentHash } from '../core/canonical-hash.js';

export const SR_QUALIFICATION_CORPUS_SCHEMA_VERSION = 'medantir-sr-qualification-corpus/1' as const;
export const SR_QUALIFICATION_CANDIDATE_VERIFICATION_SCHEMA_VERSION = 'medantir-sr-qualification-candidate-verification/1' as const;

export type SrQualificationComponent =
  | 'protocol'
  | 'search-strategy'
  | 'search-corpus'
  | 'dedup-truth'
  | 'tiab-truth'
  | 'fulltext-truth'
  | 'included-report-corpus'
  | 'extraction-truth'
  | 'appraisal-truth'
  | 'analysis-runtime'
  | 'synthesis-targets'
  | 'report-source';

export const SR_QUALIFICATION_COMPONENTS: SrQualificationComponent[] = [
  'protocol',
  'search-strategy',
  'search-corpus',
  'dedup-truth',
  'tiab-truth',
  'fulltext-truth',
  'included-report-corpus',
  'extraction-truth',
  'appraisal-truth',
  'analysis-runtime',
  'synthesis-targets',
  'report-source',
];

export type SrQualificationAssetStatus =
  | 'missing'
  | 'identified'
  | 'available-unfrozen'
  | 'frozen-unverified'
  | 'frozen-verified';

export type SrQualificationEvidenceBasis =
  | 'original-artifact'
  | 'source-reconstructed'
  | 'published-aggregate'
  | 'not-available';

export type SrQualificationReadiness =
  | 'discovered'
  | 'assets-partial'
  | 'gold-buildable'
  | 'validation-ready';

export type SrQualificationCandidateVerificationBasis =
  | 'independent-reproduction'
  | 'dual-independent-audit';

export interface SrQualificationAsset {
  status: SrQualificationAssetStatus;
  basis: SrQualificationEvidenceBasis;
  references?: string[];
  receiptHash?: string;
  notes?: string[];
}

export interface SrQualificationCandidateVerificationReceipt {
  schemaVersion: typeof SR_QUALIFICATION_CANDIDATE_VERIFICATION_SCHEMA_VERSION;
  candidateId: string;
  targetCandidateHash: string;
  componentReceiptHashes: Record<SrQualificationComponent, string>;
  verificationBasis: SrQualificationCandidateVerificationBasis;
  verifierId: string;
  verifiedAt: string;
  receiptHash: string;
}

export interface SrQualificationCandidateInput {
  candidateId: string;
  title: string;
  domain: string;
  methodologicalClass: string;
  publication: {
    doi?: string;
    pmid?: string;
    pmcid?: string;
    year: number;
  };
  registration?: string[];
  repositories?: string[];
  assets: Record<SrQualificationComponent, SrQualificationAsset>;
  independentVerification?: SrQualificationCandidateVerificationReceipt;
  notes?: string[];
}

export interface SrQualificationCandidate extends SrQualificationCandidateInput {
  readiness: SrQualificationReadiness;
  completeComponents: number;
  buildableComponents: number;
  missingOrWeakComponents: SrQualificationComponent[];
  promotionEligible: boolean;
  preVerificationCandidateHash: string;
  candidateHash: string;
}

export interface SrQualificationCorpus {
  schemaVersion: typeof SR_QUALIFICATION_CORPUS_SCHEMA_VERSION;
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidate[];
  validationReadyCandidates: string[];
  validationReadyDomains: string[];
  validationReadyMethodologicalClasses: string[];
  corpusHash: string;
}

function isSha(value: string | undefined): boolean {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

function sha(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 digest.`);
  return normalized;
}

function cleanArray(values?: string[]): string[] | undefined {
  if (!values) return undefined;
  const clean = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  return clean.length > 0 ? clean : undefined;
}

function validVerificationBasis(value: string): value is SrQualificationCandidateVerificationBasis {
  return value === 'independent-reproduction' || value === 'dual-independent-audit';
}

function assetBuildable(asset: SrQualificationAsset): boolean {
  return asset.status === 'available-unfrozen'
    || asset.status === 'frozen-unverified'
    || asset.status === 'frozen-verified';
}

function assetScientificallyComplete(asset: SrQualificationAsset): boolean {
  return asset.status === 'frozen-verified'
    && (asset.basis === 'original-artifact' || asset.basis === 'source-reconstructed')
    && isSha(asset.receiptHash);
}

function validateAsset(component: SrQualificationComponent, asset: SrQualificationAsset): SrQualificationAsset {
  if (asset.status === 'missing' && asset.basis !== 'not-available') {
    throw new Error(`Qualification component '${component}' marked missing must use basis 'not-available'.`);
  }
  if (asset.status !== 'missing' && asset.basis === 'not-available') {
    throw new Error(`Qualification component '${component}' cannot use basis 'not-available' when an asset is present.`);
  }
  if (asset.status === 'frozen-verified' && !isSha(asset.receiptHash)) {
    throw new Error(`Qualification component '${component}' is frozen-verified but has no valid SHA-256 receiptHash.`);
  }
  if (asset.status === 'frozen-verified' && asset.basis === 'published-aggregate') {
    throw new Error(`Qualification component '${component}' cannot be frozen-verified from published aggregate evidence alone; construct row-level/source-reconstructed gold first.`);
  }
  if (asset.receiptHash && !isSha(asset.receiptHash)) throw new Error(`Qualification component '${component}' has an invalid receiptHash.`);
  const references = cleanArray(asset.references);
  const notes = cleanArray(asset.notes);
  return {
    status: asset.status,
    basis: asset.basis,
    ...(references ? { references } : {}),
    ...(asset.receiptHash ? { receiptHash: asset.receiptHash.toLowerCase() } : {}),
    ...(notes ? { notes } : {}),
  };
}

function deriveUnverifiedReadiness(assets: Record<SrQualificationComponent, SrQualificationAsset>): Exclude<SrQualificationReadiness, 'validation-ready'> {
  const values = SR_QUALIFICATION_COMPONENTS.map((component) => assets[component]);
  if (values.every((asset) => asset.status === 'missing' || asset.status === 'identified')) return 'discovered';
  if (values.every(assetBuildable)) return 'gold-buildable';
  return 'assets-partial';
}

function normalizedCandidateCore(input: SrQualificationCandidateInput): Omit<SrQualificationCandidateInput, 'independentVerification'> {
  if (!input.candidateId.trim() || !input.title.trim() || !input.domain.trim() || !input.methodologicalClass.trim()) {
    throw new Error('SR qualification candidate requires stable ID, title, domain and methodological class.');
  }
  if (!Number.isInteger(input.publication.year) || input.publication.year < 1900 || input.publication.year > 3000) {
    throw new Error(`SR qualification candidate '${input.candidateId}' has an invalid publication year.`);
  }
  const keys = Object.keys(input.assets).sort();
  const requiredKeys = [...SR_QUALIFICATION_COMPONENTS].sort();
  if (keys.length !== requiredKeys.length || keys.some((key, index) => key !== requiredKeys[index])) {
    throw new Error(`SR qualification candidate '${input.candidateId}' must declare every qualification component exactly once.`);
  }
  const assets = Object.fromEntries(SR_QUALIFICATION_COMPONENTS.map((component) => [
    component,
    validateAsset(component, input.assets[component]),
  ])) as Record<SrQualificationComponent, SrQualificationAsset>;
  const registration = cleanArray(input.registration);
  const repositories = cleanArray(input.repositories);
  const notes = cleanArray(input.notes);
  const doi = input.publication.doi?.trim().toLowerCase();
  const pmid = input.publication.pmid?.trim();
  const pmcid = input.publication.pmcid?.trim().toUpperCase();
  return {
    candidateId: input.candidateId.trim(),
    title: input.title.trim(),
    domain: input.domain.trim(),
    methodologicalClass: input.methodologicalClass.trim(),
    publication: {
      year: input.publication.year,
      ...(doi ? { doi } : {}),
      ...(pmid ? { pmid } : {}),
      ...(pmcid ? { pmcid } : {}),
    },
    ...(registration ? { registration } : {}),
    ...(repositories ? { repositories } : {}),
    assets,
    ...(notes ? { notes } : {}),
  };
}

function componentReceiptHashes(assets: Record<SrQualificationComponent, SrQualificationAsset>): Record<SrQualificationComponent, string> {
  return Object.fromEntries(SR_QUALIFICATION_COMPONENTS.map((component) => {
    const receiptHash = assets[component].receiptHash;
    if (!receiptHash || !isSha(receiptHash)) throw new Error(`Qualification component '${component}' has no verified receipt hash.`);
    return [component, receiptHash.toLowerCase()];
  })) as Record<SrQualificationComponent, string>;
}

function unverifiedCandidateState(core: Omit<SrQualificationCandidateInput, 'independentVerification'>) {
  const completeComponents = SR_QUALIFICATION_COMPONENTS.filter((component) => assetScientificallyComplete(core.assets[component])).length;
  const buildableComponents = SR_QUALIFICATION_COMPONENTS.filter((component) => assetBuildable(core.assets[component])).length;
  const missingOrWeakComponents = SR_QUALIFICATION_COMPONENTS.filter((component) => !assetScientificallyComplete(core.assets[component]));
  const readiness = deriveUnverifiedReadiness(core.assets);
  const base = {
    ...core,
    readiness,
    completeComponents,
    buildableComponents,
    missingOrWeakComponents,
    promotionEligible: false,
  };
  return { ...base, candidateHash: scientificContentHash(base) };
}

function normalizedVerificationReceipt(receipt: SrQualificationCandidateVerificationReceipt): SrQualificationCandidateVerificationReceipt {
  if (receipt.schemaVersion !== SR_QUALIFICATION_CANDIDATE_VERIFICATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported qualification candidate verification schema '${receipt.schemaVersion}'.`);
  }
  if (!receipt.candidateId.trim() || !receipt.verifierId.trim()) throw new Error('Qualification candidate verification requires candidate and verifier identity.');
  if (!validVerificationBasis(receipt.verificationBasis)) throw new Error(`Unsupported qualification candidate verification basis '${receipt.verificationBasis}'.`);
  if (Number.isNaN(Date.parse(receipt.verifiedAt))) throw new Error('Qualification candidate verification verifiedAt must be a valid date-time.');
  const keys = Object.keys(receipt.componentReceiptHashes).sort();
  const requiredKeys = [...SR_QUALIFICATION_COMPONENTS].sort();
  if (keys.length !== requiredKeys.length || keys.some((key, index) => key !== requiredKeys[index])) {
    throw new Error('Qualification candidate verification must bind all component receipt hashes exactly once.');
  }
  const hashes = Object.fromEntries(SR_QUALIFICATION_COMPONENTS.map((component) => [
    component,
    sha(receipt.componentReceiptHashes[component], `Qualification verification ${component} receiptHash`),
  ])) as Record<SrQualificationComponent, string>;
  const base = {
    schemaVersion: SR_QUALIFICATION_CANDIDATE_VERIFICATION_SCHEMA_VERSION,
    candidateId: receipt.candidateId.trim(),
    targetCandidateHash: sha(receipt.targetCandidateHash, 'Qualification verification targetCandidateHash'),
    componentReceiptHashes: hashes,
    verificationBasis: receipt.verificationBasis,
    verifierId: receipt.verifierId.trim(),
    verifiedAt: receipt.verifiedAt,
  };
  const expected = scientificContentHash(base);
  if (receipt.receiptHash !== expected) throw new Error('Qualification candidate verification receipt hash mismatch.');
  return { ...base, receiptHash: expected };
}

export function createSrQualificationCandidateVerificationReceipt(input: {
  candidate: SrQualificationCandidate;
  verificationBasis: SrQualificationCandidateVerificationBasis;
  verifierId: string;
  verifiedAt: string;
}): SrQualificationCandidateVerificationReceipt {
  if (input.candidate.readiness !== 'gold-buildable'
    || input.candidate.completeComponents !== SR_QUALIFICATION_COMPONENTS.length
    || input.candidate.missingOrWeakComponents.length !== 0
    || input.candidate.independentVerification) {
    throw new Error('Qualification candidate verification can be issued only for a complete gold-buildable candidate before independent verification.');
  }
  if (!validVerificationBasis(input.verificationBasis)) throw new Error(`Unsupported qualification candidate verification basis '${input.verificationBasis}'.`);
  if (!input.verifierId.trim()) throw new Error('Qualification candidate verification requires verifier identity.');
  if (Number.isNaN(Date.parse(input.verifiedAt))) throw new Error('Qualification candidate verification verifiedAt must be a valid date-time.');
  const base = {
    schemaVersion: SR_QUALIFICATION_CANDIDATE_VERIFICATION_SCHEMA_VERSION,
    candidateId: input.candidate.candidateId,
    targetCandidateHash: input.candidate.preVerificationCandidateHash,
    componentReceiptHashes: componentReceiptHashes(input.candidate.assets),
    verificationBasis: input.verificationBasis,
    verifierId: input.verifierId.trim(),
    verifiedAt: input.verifiedAt,
  };
  return { ...base, receiptHash: scientificContentHash(base) };
}

function verifyIndependentReceipt(input: {
  receipt: SrQualificationCandidateVerificationReceipt;
  candidateId: string;
  preVerificationCandidateHash: string;
  assets: Record<SrQualificationComponent, SrQualificationAsset>;
}): SrQualificationCandidateVerificationReceipt {
  const receipt = normalizedVerificationReceipt(input.receipt);
  if (receipt.candidateId !== input.candidateId) throw new Error('Qualification candidate verification is bound to a different candidate ID.');
  if (receipt.targetCandidateHash !== input.preVerificationCandidateHash) {
    throw new Error('Qualification candidate verification target hash does not match the current pre-verification candidate state.');
  }
  const expectedComponents = componentReceiptHashes(input.assets);
  if (scientificContentHash(receipt.componentReceiptHashes) !== scientificContentHash(expectedComponents)) {
    throw new Error('Qualification candidate verification component receipt set does not match the current candidate assets.');
  }
  return receipt;
}

export function createSrQualificationCandidate(input: SrQualificationCandidateInput): SrQualificationCandidate {
  const core = normalizedCandidateCore(input);
  const unverified = unverifiedCandidateState(core);
  const preVerificationCandidateHash = unverified.candidateHash;
  let independentVerification: SrQualificationCandidateVerificationReceipt | undefined;
  if (input.independentVerification) {
    independentVerification = verifyIndependentReceipt({
      receipt: input.independentVerification,
      candidateId: core.candidateId,
      preVerificationCandidateHash,
      assets: core.assets,
    });
  }
  const validationReady = Boolean(independentVerification)
    && unverified.readiness === 'gold-buildable'
    && unverified.completeComponents === SR_QUALIFICATION_COMPONENTS.length
    && unverified.missingOrWeakComponents.length === 0;
  const base = {
    ...core,
    ...(independentVerification ? { independentVerification } : {}),
    readiness: validationReady ? 'validation-ready' as const : unverified.readiness,
    completeComponents: unverified.completeComponents,
    buildableComponents: unverified.buildableComponents,
    missingOrWeakComponents: unverified.missingOrWeakComponents,
    promotionEligible: validationReady,
    preVerificationCandidateHash,
  };
  return { ...base, candidateHash: scientificContentHash(base) };
}

export function createSrQualificationCorpus(input: {
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}): SrQualificationCorpus {
  if (!input.corpusId.trim() || !input.corpusVersion.trim()) throw new Error('SR qualification corpus requires stable ID/version.');
  const candidates = input.candidates.map(createSrQualificationCandidate).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const duplicateId = candidates.find((candidate, index) => candidates.findIndex((item) => item.candidateId === candidate.candidateId) !== index);
  if (duplicateId) throw new Error(`SR qualification corpus duplicates candidate ID '${duplicateId.candidateId}'.`);
  const duplicatePublication = candidates.find((candidate, index) => {
    const identity = candidate.publication.doi ?? candidate.publication.pmid ?? candidate.publication.pmcid;
    if (!identity) return false;
    return candidates.findIndex((item) => (item.publication.doi ?? item.publication.pmid ?? item.publication.pmcid) === identity) !== index;
  });
  if (duplicatePublication) throw new Error(`SR qualification corpus duplicates publication identity for '${duplicatePublication.candidateId}'.`);
  const ready = candidates.filter((candidate) => candidate.promotionEligible);
  const base = {
    schemaVersion: SR_QUALIFICATION_CORPUS_SCHEMA_VERSION,
    corpusId: input.corpusId.trim(),
    corpusVersion: input.corpusVersion.trim(),
    candidates,
    validationReadyCandidates: ready.map((candidate) => candidate.candidateId),
    validationReadyDomains: [...new Set(ready.map((candidate) => candidate.domain))].sort(),
    validationReadyMethodologicalClasses: [...new Set(ready.map((candidate) => candidate.methodologicalClass))].sort(),
  };
  return { ...base, corpusHash: scientificContentHash(base) };
}
