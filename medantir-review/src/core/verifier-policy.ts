/**
 * Explicit verifier-safe artifact allowlist.
 *
 * Raw full-text bodies, parsed-document bodies, credential/session state and
 * arbitrary run-state artifacts are intentionally absent. Adding a new readable
 * artifact is a security/scientific review decision, not an automatic side
 * effect of producing a new pipeline artifact.
 */
export const VERIFIER_READABLE_ARTIFACTS = new Set([
  'normalisedQuestion',
  'reviewPlan',
  'protocolPackage',
  'searchStrategies',
  'searchTestReport',
  'searchProvenance',
  'searchResults',
  'deduplicationReport',
  'uniqueRecords',
  'tiabDecisions',
  'tiabScreeningQuality',
  'retrievalReport',
  'documentParseFailures',
  'documentParsingQuality',
  'fullTextDecisions',
  'fullTextScreeningQuality',
  'studyFamilyLinks',
  'studyFamilyEvidenceLedger',
  'studyFamilies',
  'studyFamilyQuality',
  'studyFamilySynthesisConflicts',
  'extractedStudies',
  'quantitativeExtractionLedger',
  'quantitativeExtractionQuality',
  'estimandLedger',
  'estimandIdentityQuality',
  'estimandSynthesisConflicts',
  'estimandVerificationDebt',
  'estimandHumanAdjudications',
  'riskOfBias',
  'synthesis',
  'synthesisOutcomeAnalyses',

  // Outcome-level certainty control/evidence. These objects contain policy
  // identity, hashes, evidence IDs, decisions and derived statistics only.
  'gradePolicySet',
  'gradePolicyAmendments',
  'gradeAutomaticEvidenceReceipts',
  'gradeOutcomeEvidence',
  'gradeOutcomeAssessments',
  'gradeEvidenceReviewPackage',
  'gradeQuality',
  'grade',

  // Publication-bias eligible-universe receipts. These are body-free scientific
  // ledgers, bibliographic records/provenance, source identities, hashes,
  // field-level decisions and completeness metrics.
  'publicationBiasUniversePolicy',
  'publicationBiasUniversePolicyAmendments',
  'publicationBiasUniversePolicyLateAmendment',
  'registrySearchSourceAmendments',
  'registeredStudyResultUniverse',
  'registryUniverseReviewPackage',
  'registryUniverseQuality',
  'registryUniverseAdjudications',
  'registryUniverseResolutionHistory',
  'registryResultReferenceReceipts',
  'registryResultReferenceQuality',
  'registryPublicationDiscoveryRecords',
  'registryPublicationDiscoveryReceipts',
  'registryPublicationDiscoveryProvenance',
  'registryPublicationDiscoveryQuality',
  'registryPublicationLinkReceipts',
  'registryPublicationLinkageQuality',
  'registryResidualDebtQuality',
  'contributingRegistryDebtQuality',
  'publicationBiasUniverseAudits',
  'publicationBiasEvidenceCatalog',

  'draftReport',
  'finalReport',
  'humanOverrides',

  // Historical-review receipts/ledgers. These objects are deliberately
  // body-free or evidence-row bounded. Raw archive objects remain forbidden.
  'historicalReplayCapsule',
  'historicalReplayCertificate',
  'historicalReviewEnvelope',
  'historicalAppraisalLedger',
  'historicalScreeningLedger',
  'historicalManualSearchLedger',
  'historicalExecutionEnvironment',
  'historicalBundleManifest',
  'historicalPublicationCapture',
  'historicalPublicationTableManifest',
  'historicalOutcomeRowLedger',
  'historicalParserCheckpoints',
  'historicalResultComparison',
]);

export const VERIFIER_FORBIDDEN_RAW_ARTIFACTS = new Set([
  'fullTexts',
  'parsedDocuments',
  'researcherIdentity',
  'historicalObjectStore',
  'historicalArchiveObjects',
  'historicalFullTextBodies',
  'historicalParsedDocuments',
  'historicalRawPublicationXml',
]);

export function verifierArtifactReadable(key: string): boolean {
  return VERIFIER_READABLE_ARTIFACTS.has(key);
}
