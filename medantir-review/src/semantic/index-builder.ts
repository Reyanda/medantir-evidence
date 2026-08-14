import { scientificContentHash } from '../core/canonical-hash.js';
import type { PipelineState } from '../core/types.js';
import { buildArtifactTokenisationManifest } from '../tokenisation/index.js';
import type { ImradRole } from '../tokenisation/types.js';
import { buildSemanticClusters } from './clustering.js';
import {
  SEMANTIC_EMBEDDING_SCHEMA_VERSION,
  SEMANTIC_INDEX_SCHEMA_VERSION,
  type ResolvedSemanticEmbeddingProfile,
  type SemanticEmbedding,
  type SemanticEmbeddingPort,
  type SemanticEmbeddingProfile,
  type SemanticIndexManifest,
  type SemanticIndexSnapshot,
  type SemanticUnitType,
} from './types.js';
import { projectSemanticUnits, SEMANTIC_UNIT_PROJECTION_VERSION, verifySemanticUnit } from './unit-projector.js';

export function semanticSourceStateHash(state: PipelineState): string {
  return scientificContentHash({ request: state.request, stages: state.stages, artifacts: state.artifacts, audit: state.audit });
}

export function semanticEmbeddingProfileHash(profile: { provider: string; model: string; modelVersion?: string; dimensions?: number; normalization: string; embeddingClass: string }): string {
  return scientificContentHash(profile);
}

export function requestedSemanticEmbeddingProfileMatches(
  requested: SemanticEmbeddingProfile,
  resolved: ResolvedSemanticEmbeddingProfile,
): boolean {
  if (requested.provider !== resolved.provider || requested.model !== resolved.model) return false;
  if (requested.modelVersion !== undefined && requested.modelVersion !== resolved.modelVersion) return false;
  if (requested.normalization !== resolved.normalization || requested.embeddingClass !== resolved.embeddingClass) return false;
  if (requested.dimensions !== undefined && requested.dimensions !== resolved.dimensions) return false;
  return true;
}

function resolvedProfileMatches(left: ResolvedSemanticEmbeddingProfile, right: ResolvedSemanticEmbeddingProfile): boolean {
  return semanticEmbeddingProfileHash(left) === semanticEmbeddingProfileHash(right);
}

function makeEmbedding(
  unitId: string,
  unitTextHash: string,
  vector: number[],
  profile: ResolvedSemanticEmbeddingProfile,
  generatedAt: string,
): SemanticEmbedding {
  if (vector.length !== profile.dimensions) throw new Error(`Semantic embedding for ${unitId} has ${vector.length} dimensions; expected ${profile.dimensions}.`);
  if (vector.some((value) => !Number.isFinite(value))) throw new Error(`Semantic embedding for ${unitId} contains a non-finite value.`);
  const vectorHash = scientificContentHash(vector);
  const identity = { semanticUnitId: unitId, unitTextHash, profile, vectorHash };
  return {
    schemaVersion: SEMANTIC_EMBEDDING_SCHEMA_VERSION,
    embeddingId: `semb-${scientificContentHash(identity)}`,
    semanticUnitId: unitId,
    unitTextHash,
    profile,
    vector,
    vectorHash,
    generatedAt,
  };
}

function counts(
  units: SemanticIndexSnapshot['units'],
  embeddings: SemanticEmbedding[],
  clusters: SemanticIndexSnapshot['clusters'],
): SemanticIndexManifest['counts'] {
  const unitsByType: Partial<Record<SemanticUnitType, number>> = {};
  const unitsByImradRole: Partial<Record<ImradRole, number>> = {};
  for (const unit of units) {
    unitsByType[unit.unitType] = (unitsByType[unit.unitType] ?? 0) + 1;
    unitsByImradRole[unit.imradRole] = (unitsByImradRole[unit.imradRole] ?? 0) + 1;
  }
  return { units: units.length, embeddings: embeddings.length, clusters: clusters.length, unitsByType, unitsByImradRole };
}

function embeddingUsage(receipts: SemanticIndexSnapshot['embeddingReceipts']): SemanticIndexManifest['embeddingUsage'] {
  return receipts.reduce<SemanticIndexManifest['embeddingUsage']>((aggregate, receipt) => ({
    requests: aggregate.requests + 1,
    inputTokens: aggregate.inputTokens + (receipt.inputTokens ?? 0),
    pricedRequests: aggregate.pricedRequests + (receipt.costUsd === undefined ? 0 : 1),
    costUsd: aggregate.costUsd + (receipt.costUsd ?? 0),
    latencyMs: aggregate.latencyMs + (receipt.latencyMs ?? 0),
  }), { requests: 0, inputTokens: 0, pricedRequests: 0, costUsd: 0, latencyMs: 0 });
}

function indexIdentity(snapshot: Omit<SemanticIndexSnapshot, 'indexHash' | 'manifest'>): unknown {
  return {
    schemaVersion: snapshot.schemaVersion,
    runId: snapshot.runId,
    sourceStateHash: snapshot.sourceStateHash,
    tokenisationManifestHash: snapshot.tokenisationManifestHash,
    unitProjectionVersion: snapshot.unitProjectionVersion,
    unitIds: snapshot.units.map((unit) => unit.unitId),
    embeddingIds: snapshot.embeddings.map((embedding) => embedding.embeddingId),
    clusterIds: snapshot.clusters.map((cluster) => cluster.clusterId),
  };
}

export async function buildSemanticIndex(
  state: PipelineState,
  embeddingPort: SemanticEmbeddingPort,
  generatedAt = new Date().toISOString(),
  previousSnapshot?: SemanticIndexSnapshot,
): Promise<SemanticIndexSnapshot> {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Semantic index generatedAt must be a valid timestamp.');
  const units = projectSemanticUnits(state, generatedAt);
  units.forEach(verifySemanticUnit);
  if (units.length === 0) throw new Error('Semantic index cannot be built without semantic units.');

  const previousCompatible = previousSnapshot
    && requestedSemanticEmbeddingProfileMatches(embeddingPort.profile, previousSnapshot.manifest.embedding)
    ? previousSnapshot
    : undefined;
  const previousByTextHash = new Map<string, SemanticEmbedding>();
  for (const embedding of previousCompatible?.embeddings ?? []) {
    if (!previousByTextHash.has(embedding.unitTextHash)) previousByTextHash.set(embedding.unitTextHash, embedding);
  }
  const reusable = new Map<string, SemanticEmbedding>();
  const missingUnits = [] as typeof units;
  for (const unit of units) {
    const previous = previousByTextHash.get(unit.textHash);
    if (previous) reusable.set(unit.unitId, previous);
    else missingUnits.push(unit);
  }

  let profile = previousCompatible?.manifest.embedding;
  let freshVectors: number[][] = [];
  let receipts = previousCompatible ? [...previousCompatible.embeddingReceipts] : [];
  if (missingUnits.length) {
    const batch = await embeddingPort.embed(missingUnits.map((unit) => unit.text));
    receipts = [...receipts, ...batch.receipts];
    if (profile && !resolvedProfileMatches(profile, batch.profile)) {
      const full = await embeddingPort.embed(units.map((unit) => unit.text));
      if (full.vectors.length !== units.length) throw new Error('Semantic embedding count does not match semantic unit count.');
      profile = full.profile;
      freshVectors = full.vectors;
      receipts = [...receipts, ...full.receipts];
      reusable.clear();
      missingUnits.splice(0, missingUnits.length, ...units);
    } else {
      profile = batch.profile;
      freshVectors = batch.vectors;
    }
  }
  if (!profile) {
    const batch = await embeddingPort.embed(units.map((unit) => unit.text));
    if (batch.vectors.length !== units.length) throw new Error('Semantic embedding count does not match semantic unit count.');
    profile = batch.profile;
    freshVectors = batch.vectors;
    receipts = [...receipts, ...batch.receipts];
    missingUnits.splice(0, missingUnits.length, ...units);
  }
  if (freshVectors.length !== missingUnits.length) throw new Error('Semantic embedding count does not match the number of new semantic units.');

  const freshByUnit = new Map<string, number[]>();
  missingUnits.forEach((unit, index) => {
    const vector = freshVectors[index];
    if (!vector) throw new Error(`Semantic embedding provider omitted vector ${index}.`);
    freshByUnit.set(unit.unitId, vector);
  });
  const embeddings = units.map((unit) => {
    const previous = reusable.get(unit.unitId);
    const vector = previous?.vector ?? freshByUnit.get(unit.unitId);
    if (!vector) throw new Error(`Semantic index cannot resolve the vector for ${unit.unitId}.`);
    return makeEmbedding(unit.unitId, unit.textHash, vector, profile, generatedAt);
  });
  const clusters = buildSemanticClusters(units, embeddings, generatedAt);
  const tokenisationManifestHash = buildArtifactTokenisationManifest(state, generatedAt).manifestHash;
  const baseSnapshot = {
    schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
    runId: state.runId,
    sourceStateHash: semanticSourceStateHash(state),
    tokenisationManifestHash,
    unitProjectionVersion: SEMANTIC_UNIT_PROJECTION_VERSION,
    generatedAt,
    units,
    embeddings,
    embeddingReceipts: receipts,
    clusters,
  };
  const indexHash = scientificContentHash(indexIdentity(baseSnapshot));
  const warnings = [
    ...(profile.embeddingClass === 'deterministic-lexical-dense'
      ? ['The active local embedding is deterministic and useful for lexical-dense retrieval, but it is not a substitute for a validated provider semantic embedding model.']
      : []),
    ...(clusters.some((cluster) => cluster.labelStatus === 'machine-proposed')
      ? ['Semantic cluster labels are machine-proposed navigation aids and are not scientific classifications until human adjudication.']
      : []),
  ];
  const manifestContent = {
    schemaVersion: 'medantir-semantic-index-manifest/1' as const,
    runId: state.runId,
    sourceStateHash: baseSnapshot.sourceStateHash,
    tokenisationManifestHash,
    unitProjectionVersion: SEMANTIC_UNIT_PROJECTION_VERSION,
    embedding: profile,
    generatedAt,
    indexHash,
    counts: counts(units, embeddings, clusters),
    embeddingReuse: { reused: reusable.size, generated: missingUnits.length },
    embeddingUsage: embeddingUsage(receipts),
    warnings,
  };
  const manifest: SemanticIndexManifest = {
    ...manifestContent,
    manifestHash: scientificContentHash({ ...manifestContent, generatedAt: undefined }),
  };
  const snapshot: SemanticIndexSnapshot = { ...baseSnapshot, indexHash, manifest };
  verifySemanticIndexSnapshot(snapshot);
  return snapshot;
}

export function verifySemanticIndexSnapshot(snapshot: SemanticIndexSnapshot): void {
  if (snapshot.schemaVersion !== SEMANTIC_INDEX_SCHEMA_VERSION) throw new Error('Unsupported semantic index schema.');
  if (!Number.isFinite(Date.parse(snapshot.generatedAt))) throw new Error('Semantic index generatedAt is invalid.');
  const unitIds = new Set<string>();
  for (const unit of snapshot.units) {
    verifySemanticUnit(unit);
    if (unitIds.has(unit.unitId)) throw new Error(`Semantic index duplicates unit ${unit.unitId}.`);
    unitIds.add(unit.unitId);
  }
  if (snapshot.embeddings.length !== snapshot.units.length) throw new Error('Semantic index requires exactly one embedding per semantic unit.');
  const embeddingIds = new Set<string>();
  const embeddedUnits = new Set<string>();
  for (const embedding of snapshot.embeddings) {
    if (embedding.schemaVersion !== SEMANTIC_EMBEDDING_SCHEMA_VERSION) throw new Error('Unsupported semantic embedding schema.');
    if (!unitIds.has(embedding.semanticUnitId)) throw new Error(`Semantic embedding ${embedding.embeddingId} references a missing unit.`);
    if (embeddedUnits.has(embedding.semanticUnitId)) throw new Error(`Semantic unit ${embedding.semanticUnitId} has multiple embeddings.`);
    if (embedding.vector.length !== embedding.profile.dimensions || embedding.vector.some((value) => !Number.isFinite(value))) throw new Error(`Semantic embedding ${embedding.embeddingId} has an invalid vector.`);
    if (scientificContentHash(embedding.vector) !== embedding.vectorHash) throw new Error(`Semantic embedding ${embedding.embeddingId} vector hash mismatch.`);
    const identity = { semanticUnitId: embedding.semanticUnitId, unitTextHash: embedding.unitTextHash, profile: embedding.profile, vectorHash: embedding.vectorHash };
    if (embedding.embeddingId !== `semb-${scientificContentHash(identity)}`) throw new Error(`Semantic embedding ${embedding.embeddingId} identity mismatch.`);
    if (!resolvedProfileMatches(embedding.profile, snapshot.manifest.embedding)) throw new Error(`Semantic embedding ${embedding.embeddingId} profile differs from the index manifest.`);
    embeddingIds.add(embedding.embeddingId);
    embeddedUnits.add(embedding.semanticUnitId);
  }
  for (const cluster of snapshot.clusters) {
    if (cluster.memberSemanticUnitIds.length === 0) throw new Error(`Semantic cluster ${cluster.clusterId} is empty.`);
    if (cluster.memberSemanticUnitIds.some((unitId) => !unitIds.has(unitId))) throw new Error(`Semantic cluster ${cluster.clusterId} references a missing unit.`);
    if (cluster.centroid.length !== snapshot.manifest.embedding.dimensions || cluster.centroid.some((value) => !Number.isFinite(value))) throw new Error(`Semantic cluster ${cluster.clusterId} has an invalid centroid.`);
    if (scientificContentHash(cluster.centroid) !== cluster.centroidHash) throw new Error(`Semantic cluster ${cluster.clusterId} centroid hash mismatch.`);
  }
  const baseSnapshot = {
    schemaVersion: snapshot.schemaVersion,
    runId: snapshot.runId,
    sourceStateHash: snapshot.sourceStateHash,
    tokenisationManifestHash: snapshot.tokenisationManifestHash,
    unitProjectionVersion: snapshot.unitProjectionVersion,
    generatedAt: snapshot.generatedAt,
    units: snapshot.units,
    embeddings: snapshot.embeddings,
    embeddingReceipts: snapshot.embeddingReceipts,
    clusters: snapshot.clusters,
  };
  if (scientificContentHash(indexIdentity(baseSnapshot)) !== snapshot.indexHash) throw new Error('Semantic index hash mismatch.');
  if (snapshot.manifest.indexHash !== snapshot.indexHash) throw new Error('Semantic index manifest points to a different index hash.');
  if (snapshot.manifest.sourceStateHash !== snapshot.sourceStateHash || snapshot.manifest.tokenisationManifestHash !== snapshot.tokenisationManifestHash) throw new Error('Semantic index manifest source binding mismatch.');
  const { manifestHash, ...manifestContent } = snapshot.manifest;
  if (scientificContentHash({ ...manifestContent, generatedAt: undefined }) !== manifestHash) throw new Error('Semantic index manifest hash mismatch.');
  if (snapshot.manifest.embeddingReuse.reused + snapshot.manifest.embeddingReuse.generated !== snapshot.units.length) throw new Error('Semantic index embedding reuse counts do not reconcile.');
  const expectedCounts = counts(snapshot.units, snapshot.embeddings, snapshot.clusters);
  if (scientificContentHash(expectedCounts) !== scientificContentHash(snapshot.manifest.counts)) throw new Error('Semantic index manifest counts do not reconcile.');
}
