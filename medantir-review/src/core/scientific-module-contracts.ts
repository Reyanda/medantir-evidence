import type { ReviewModule, ReviewType, StageName } from './types.js';
import { getReviewTypeProfile } from '../protocols/methodology.js';
import { scientificHash } from './canonical-hash.js';

export type ScientificModuleId = ReviewModule
  | 'document-intelligence'
  | 'quantitative-provenance'
  | 'estimand-identity'
  | 'dependence-control'
  | 'model-inference-benchmark';

export type ScientificAuthority = 'deterministic' | 'human-adjudicated' | 'non-authoritative-model';

export interface ScientificModuleContract {
  id: ScientificModuleId;
  version: string;
  stages: StageName[];
  inputs: string[];
  outputs: string[];
  invariants: string[];
  authority: ScientificAuthority;
}

const CONTRACTS: Record<ScientificModuleId, ScientificModuleContract> = {
  'existing-review-surveillance': {
    id: 'existing-review-surveillance', version: '1', stages: ['review-landscape'], inputs: ['reviewPlan'], outputs: ['reviewCommissionDecision'], authority: 'deterministic',
    invariants: ['Reuse/update/de-novo status must be explicit before definitive review execution.'],
  },
  'primary-study-search': {
    id: 'primary-study-search', version: '1', stages: ['search-build', 'search-test', 'search-execute'], inputs: ['reviewPlan', 'searchStrategies'], outputs: ['searchStrategies', 'searchTestReport', 'searchResults', 'searchProvenance'], authority: 'deterministic',
    invariants: ['Every requested source must expose its executed query and reconciliation receipt.', 'Recall-first intervention search must not silently require outcome terms.'],
  },
  'citation-chaining': {
    id: 'citation-chaining', version: '1', stages: ['search-execute'], inputs: ['searchStrategies'], outputs: ['searchResults', 'searchProvenance'], authority: 'deterministic',
    invariants: ['Any chained record must retain its discovery route and source provenance.'],
  },
  deduplication: {
    id: 'deduplication', version: '1', stages: ['deduplicate'], inputs: ['searchResults'], outputs: ['uniqueRecords', 'deduplicationReport'], authority: 'deterministic',
    invariants: ['Imported records must reconcile to unique records plus removed duplicates.', 'Merged records retain contributing database provenance.'],
  },
  screening: {
    id: 'screening', version: '1', stages: ['tiab-screen', 'fulltext-screen'], inputs: ['uniqueRecords', 'parsedDocuments', 'reviewPlan'], outputs: ['tiabDecisions', 'fullTextDecisions', 'includedDocuments'], authority: 'deterministic',
    invariants: ['Unproven eligibility becomes uncertainty/verification debt rather than fabricated inclusion or exclusion.', 'Full-text inclusion must satisfy the shared protocol eligibility predicate.'],
  },
  'full-text-retrieval': {
    id: 'full-text-retrieval', version: '1', stages: ['fulltext-retrieve'], inputs: ['tiabIncluded'], outputs: ['fullTexts', 'retrievalReport'], authority: 'deterministic',
    invariants: ['Lawful access route is retained.', 'Missing full text remains explicit retrieval debt.'],
  },
  'section-aware-extraction': {
    id: 'section-aware-extraction', version: '1', stages: ['pdf-to-text', 'fulltext-screen', 'extract'], inputs: ['fullTexts', 'parsedDocuments', 'includedDocuments'], outputs: ['parsedDocuments', 'extractedStudies'], authority: 'deterministic',
    invariants: ['Document sections remain evidence-addressable.', 'Extraction cannot rescue a document that failed full-text eligibility.'],
  },
  'study-family-linkage': {
    id: 'study-family-linkage', version: '2', stages: ['fulltext-screen', 'extract', 'synthesise', 'human-verify', 'report'], inputs: ['uniqueRecords', 'parsedDocuments', 'fullTextDecisions'], outputs: ['studyFamilyLinks', 'studyFamilies', 'studyFamilyEvidenceLedger', 'studyFamilySynthesisConflicts'], authority: 'human-adjudicated',
    invariants: ['Report identity and participant-study identity remain distinct.', 'Automatic linkage requires high-specificity identity evidence.', 'Same-family numerical reports cannot be treated as independent without adjudication.'],
  },
  'risk-of-bias': {
    id: 'risk-of-bias', version: '1', stages: ['risk-of-bias'], inputs: ['extractedStudies', 'reviewPlan'], outputs: ['riskOfBias'], authority: 'human-adjudicated',
    invariants: ['Appraisal remains linked to the exact report/study/estimand evidence object.'],
  },
  'quantitative-synthesis': {
    id: 'quantitative-synthesis', version: '2', stages: ['synthesise'], inputs: ['extractedStudies', 'reviewPlan'], outputs: ['synthesis', 'synthesisOutcomeAnalyses'], authority: 'deterministic',
    invariants: ['No cross-outcome or cross-analysis-scale pooling.', 'Only provenance-eligible numerical estimates may enter quantitative synthesis.'],
  },
  'qualitative-synthesis': {
    id: 'qualitative-synthesis', version: '1', stages: ['synthesise'], inputs: ['extractedStudies', 'reviewPlan'], outputs: ['synthesis'], authority: 'human-adjudicated',
    invariants: ['Qualitative synthesis must preserve source excerpts and declared synthesis method.'],
  },
  'certainty-assessment': {
    id: 'certainty-assessment', version: '1', stages: ['grade'], inputs: ['synthesis', 'riskOfBias'], outputs: ['grade'], authority: 'human-adjudicated',
    invariants: ['Certainty judgments must remain outcome/estimand specific and evidence linked.'],
  },
  'economic-synthesis': {
    id: 'economic-synthesis', version: '1', stages: ['synthesise', 'report'], inputs: ['extractedStudies'], outputs: ['synthesis'], authority: 'human-adjudicated',
    invariants: ['Currency, price year, perspective and time horizon must be explicit before economic comparison.'],
  },
  'equity-analysis': {
    id: 'equity-analysis', version: '1', stages: ['synthesise', 'report'], inputs: ['extractedStudies'], outputs: [], authority: 'human-adjudicated',
    invariants: ['Equity dimensions and subgroup definitions must remain explicit rather than inferred from averages.'],
  },
  'living-surveillance': {
    id: 'living-surveillance', version: '1', stages: ['search-execute', 'report'], inputs: ['searchStrategies'], outputs: ['searchProvenance'], authority: 'deterministic',
    invariants: ['Update trigger, surveillance interval and version boundary must be explicit.'],
  },
  'human-verification': {
    id: 'human-verification', version: '2', stages: ['human-verify'], inputs: ['draftReport'], outputs: ['verificationPackage', 'verificationOutcome', 'finalReport', 'humanOverrides'], authority: 'human-adjudicated',
    invariants: ['Human amendments replay from their scientific source stage.', 'Accepted propositions are bound to the exact evidence/proposal reviewed.'],
  },
  'document-intelligence': {
    id: 'document-intelligence', version: '2', stages: ['pdf-to-text'], inputs: ['fullTexts'], outputs: ['parsedDocuments', 'documentParseFailures', 'documentParsingQuality'], authority: 'deterministic',
    invariants: ['LiteParse structured/spatial evidence is attempted first for PDFs.', 'Downgrades are explicit and low-quality parses are quarantined rather than silently promoted.'],
  },
  'quantitative-provenance': {
    id: 'quantitative-provenance', version: '2', stages: ['extract', 'synthesise', 'report'], inputs: ['includedDocuments', 'extractedStudies'], outputs: ['quantitativeExtractionLedger', 'quantitativeExtractionQuality'], authority: 'deterministic',
    invariants: ['A pooled numerical estimate must be reconstructable from row label, effect-measure header, page and verbatim LiteParse evidence.', 'Spatial coordinates are mandatory when valid coordinate evidence is available.', 'Ratio measures are analysed on log scale.'],
  },
  'estimand-identity': {
    id: 'estimand-identity', version: '2', stages: ['extract', 'synthesise', 'human-verify', 'report'], inputs: ['quantitativeExtractionLedger', 'extractedStudies'], outputs: ['estimandLedger', 'estimandIdentityQuality', 'estimandSynthesisConflicts', 'estimandVerificationDebt', 'estimandHumanAdjudications'], authority: 'human-adjudicated',
    invariants: ['Report, study-family and estimand identity are distinct.', 'Unknown estimand dimensions are never imputed.', 'Population and explicit subgroup label participate in estimand identity.', 'Human estimand amendments preserve the source numerical cell and regenerate the estimand ID.'],
  },
  'dependence-control': {
    id: 'dependence-control', version: '1', stages: ['synthesise'], inputs: ['extractedStudies', 'estimandLedger'], outputs: ['estimandDependenceConflicts', 'studyFamilySynthesisConflicts'], authority: 'deterministic',
    invariants: ['Estimand distinctness never implies statistical independence.', 'Multiple estimands from one participant cohort require explicit dependence modelling or one-estimand selection before ordinary pooling.'],
  },
  'model-inference-benchmark': {
    id: 'model-inference-benchmark', version: '1', stages: ['tiab-screen', 'extract'], inputs: [], outputs: ['modelScreeningSuggestions', 'modelScreeningQuality'], authority: 'non-authoritative-model',
    invariants: ['Benchmark/shadow model output cannot mutate authoritative scientific decisions.', 'Actual routed model/provider and prompt/output hashes must be receipted when inference is used.'],
  },
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function scientificModuleContractsFor(reviewType: ReviewType): ScientificModuleContract[] {
  const profile = getReviewTypeProfile(reviewType);
  const ids: ScientificModuleId[] = [...profile.requiredModules];

  if (profile.requiredModules.includes('full-text-retrieval') || profile.requiredModules.includes('section-aware-extraction')) {
    ids.push('document-intelligence');
  }
  if (profile.requiredModules.includes('quantitative-synthesis')) {
    ids.push('quantitative-provenance', 'estimand-identity', 'dependence-control');
  }

  return unique(ids).map((id) => CONTRACTS[id]).filter(Boolean);
}

export function scientificModuleIdsForStage(reviewType: ReviewType, stage: StageName): ScientificModuleId[] {
  return scientificModuleContractsFor(reviewType)
    .filter((contract) => contract.stages.includes(stage))
    .map((contract) => contract.id)
    .sort();
}

export function scientificModuleContractHash(contract: ScientificModuleContract): string {
  return scientificHash({
    id: contract.id,
    version: contract.version,
    stages: contract.stages,
    inputs: contract.inputs,
    outputs: contract.outputs,
    invariants: contract.invariants,
    authority: contract.authority,
  });
}
