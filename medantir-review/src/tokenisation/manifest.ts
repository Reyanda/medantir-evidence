import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
import { findExtractedStudies, validateExtractedStudyImrad } from './extraction-validator.js';
import { tokeniseArtifact } from './tokeniser.js';
import {
  ARTIFACT_TOKENISATION_MANIFEST_SCHEMA,
  type ArtifactTokenisationManifest,
  type ArtifactTokenisationManifestEntry,
} from './types.js';

export function tokenisableArtifacts(state: PipelineState): Array<{ artifactKey: string; source: ArtifactTokenisationManifestEntry['source']; value: unknown }> {
  return [
    { artifactKey: '@request', source: 'request', value: state.request },
    { artifactKey: '@stages', source: 'stages', value: state.stages },
    { artifactKey: '@audit', source: 'audit', value: state.audit },
    ...Object.keys(state.artifacts).sort().map((artifactKey) => ({ artifactKey, source: 'artifact' as const, value: state.artifacts[artifactKey] })),
  ];
}

export function artifactValueForKey(state: PipelineState, artifactKey: string): unknown {
  if (artifactKey === '@request') return state.request;
  if (artifactKey === '@stages') return state.stages;
  if (artifactKey === '@audit') return state.audit;
  if (Object.prototype.hasOwnProperty.call(state.artifacts, artifactKey)) return state.artifacts[artifactKey];
  throw new Error(`Unknown tokenisable artifact ${artifactKey}.`);
}

export function buildArtifactTokenisationManifest(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
): ArtifactTokenisationManifest {
  const entries = tokenisableArtifacts(state).map(({ artifactKey, source, value }) => {
    const document = tokeniseArtifact(artifactKey, value, generatedAt);
    const validations = findExtractedStudies(value).map((study) => validateExtractedStudyImrad(study));
    return {
      artifactKey,
      source,
      artifactHash: document.artifactHash,
      documentHash: document.documentHash,
      totalTokens: document.counts.total,
      lexicalTokens: document.counts.lexical,
      estimatedModelTokens: document.modelBudget.estimatedTokens,
      countsByImradRole: document.counts.byImradRole,
      extractedStudyCount: validations.length,
      extractionContractErrors: validations.flatMap((entry) => entry.issues).filter((entry) => entry.severity === 'error').length,
      extractionContractWarnings: validations.flatMap((entry) => entry.issues).filter((entry) => entry.severity === 'warning').length,
    } satisfies ArtifactTokenisationManifestEntry;
  });
  const totals = entries.reduce<ArtifactTokenisationManifest['totals']>((aggregate, entry) => ({
    artifacts: aggregate.artifacts + 1,
    tokens: aggregate.tokens + entry.totalTokens,
    lexicalTokens: aggregate.lexicalTokens + entry.lexicalTokens,
    estimatedModelTokens: aggregate.estimatedModelTokens + entry.estimatedModelTokens,
    extractedStudies: aggregate.extractedStudies + entry.extractedStudyCount,
    extractionContractErrors: aggregate.extractionContractErrors + entry.extractionContractErrors,
    extractionContractWarnings: aggregate.extractionContractWarnings + entry.extractionContractWarnings,
  }), { artifacts: 0, tokens: 0, lexicalTokens: 0, estimatedModelTokens: 0, extractedStudies: 0, extractionContractErrors: 0, extractionContractWarnings: 0 });
  const content = {
    schemaVersion: ARTIFACT_TOKENISATION_MANIFEST_SCHEMA,
    runId: state.runId,
    generatedAt,
    entries,
    totals,
  };
  return { ...content, manifestHash: scientificContentHash({ ...content, generatedAt: undefined }) };
}
