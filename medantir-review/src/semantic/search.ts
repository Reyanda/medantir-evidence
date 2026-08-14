import { scientificContentHash } from '../core/canonical-hash.js';
import { cosineSimilarity } from './clustering.js';
import { normalizeSemanticText } from './unit-projector.js';
import type {
  SemanticEmbeddingPort,
  SemanticIndexSnapshot,
  SemanticSearchFilters,
  SemanticSearchRequest,
  SemanticSearchResponse,
  SemanticUnit,
} from './types.js';
import { semanticEmbeddingProfileHash } from './index-builder.js';

function terms(text: string): string[] {
  return normalizeSemanticText(text).match(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
}

function frequencies(values: string[]): Map<string, number> {
  const output = new Map<string, number>();
  for (const value of values) output.set(value, (output.get(value) ?? 0) + 1);
  return output;
}

function selected(unit: SemanticUnit, filters: SemanticSearchFilters | undefined, clustersByUnit: Map<string, string[]>): boolean {
  if (!filters) return true;
  if (filters.unitTypes?.length && !filters.unitTypes.includes(unit.unitType)) return false;
  if (filters.imradRoles?.length && !filters.imradRoles.includes(unit.imradRole)) return false;
  if (filters.artifactKeys?.length && !filters.artifactKeys.includes(unit.artifactKey)) return false;
  if (filters.semanticRoles?.length && !filters.semanticRoles.some((role) => unit.semanticRoles.includes(role))) return false;
  if (filters.studyIds?.length) {
    const studyId = unit.metadata.studyId;
    if (typeof studyId !== 'string' || !filters.studyIds.includes(studyId)) return false;
  }
  if (filters.clusterIds?.length && !filters.clusterIds.some((clusterId) => (clustersByUnit.get(unit.unitId) ?? []).includes(clusterId))) return false;
  return true;
}

function finiteWeight(value: number | undefined, fallback: number): number {
  const selectedValue = value ?? fallback;
  if (!Number.isFinite(selectedValue) || selectedValue < 0 || selectedValue > 1) throw new Error('Semantic search weights must be finite values between 0 and 1.');
  return selectedValue;
}

function requestedTopK(value: number | undefined): number {
  const selectedValue = value ?? 20;
  if (!Number.isSafeInteger(selectedValue) || selectedValue < 1 || selectedValue > 100) throw new Error('Semantic search topK must be an integer between 1 and 100.');
  return selectedValue;
}

export async function searchSemanticIndex(
  snapshot: SemanticIndexSnapshot,
  embeddingPort: SemanticEmbeddingPort,
  request: SemanticSearchRequest,
): Promise<SemanticSearchResponse> {
  const query = request.query.trim();
  if (!query) throw new Error('Semantic search query cannot be empty.');
  if (query.length > 10_000) throw new Error('Semantic search query exceeds 10000 characters.');
  const denseWeight = finiteWeight(request.denseWeight, 0.55);
  const lexicalWeight = finiteWeight(request.lexicalWeight, 0.35);
  const exactPhraseWeight = finiteWeight(request.exactPhraseWeight, 0.10);
  const totalWeight = denseWeight + lexicalWeight + exactPhraseWeight;
  if (totalWeight <= 0) throw new Error('At least one semantic search weight must be greater than zero.');
  const weights = {
    dense: denseWeight / totalWeight,
    lexical: lexicalWeight / totalWeight,
    phrase: exactPhraseWeight / totalWeight,
  };

  const queryBatch = await embeddingPort.embed([query]);
  const queryVector = queryBatch.vectors[0];
  if (!queryVector) throw new Error('Semantic embedding provider omitted the query vector.');
  if (semanticEmbeddingProfileHash(queryBatch.profile) !== semanticEmbeddingProfileHash(snapshot.manifest.embedding)) {
    throw new Error('Semantic embedding profile drifted from the persisted index; rebuild is required.');
  }

  const embeddingByUnit = new Map(snapshot.embeddings.map((embedding) => [embedding.semanticUnitId, embedding] as const));
  const clustersByUnit = new Map<string, string[]>();
  for (const cluster of snapshot.clusters) {
    for (const unitId of cluster.memberSemanticUnitIds) {
      const values = clustersByUnit.get(unitId) ?? [];
      values.push(cluster.clusterId);
      clustersByUnit.set(unitId, values);
    }
  }
  const candidates = snapshot.units.filter((unit) => selected(unit, request.filters, clustersByUnit));
  const queryTerms = terms(query);
  const queryTermFrequency = frequencies(queryTerms);
  const termFrequencyByUnit = new Map<string, Map<string, number>>();
  const lengthByUnit = new Map<string, number>();
  const documentFrequency = new Map<string, number>();
  for (const unit of candidates) {
    const unitTerms = terms(unit.text);
    const unitFrequencies = frequencies(unitTerms);
    termFrequencyByUnit.set(unit.unitId, unitFrequencies);
    lengthByUnit.set(unit.unitId, unitTerms.length);
    for (const term of new Set(unitTerms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const averageLength = candidates.length
    ? [...lengthByUnit.values()].reduce((sum, value) => sum + value, 0) / candidates.length
    : 0;
  const k1 = 1.2;
  const b = 0.75;
  const raw = candidates.map((unit) => {
    const embedding = embeddingByUnit.get(unit.unitId);
    if (!embedding) throw new Error(`Semantic index is missing the embedding for ${unit.unitId}.`);
    const denseScore = Math.max(0, cosineSimilarity(queryVector, embedding.vector));
    const unitFrequencies = termFrequencyByUnit.get(unit.unitId) ?? new Map<string, number>();
    const documentLength = lengthByUnit.get(unit.unitId) ?? 0;
    let lexicalScore = 0;
    for (const [term, queryFrequency] of queryTermFrequency) {
      const termFrequency = unitFrequencies.get(term) ?? 0;
      if (termFrequency === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (candidates.length - df + 0.5) / (df + 0.5));
      const denominator = termFrequency + k1 * (1 - b + b * (averageLength > 0 ? documentLength / averageLength : 0));
      lexicalScore += queryFrequency * idf * ((termFrequency * (k1 + 1)) / denominator);
    }
    const exactPhraseScore = unit.normalizedText.includes(normalizeSemanticText(query)) ? 1 : 0;
    return { unit, denseScore, lexicalScore, exactPhraseScore, clusterIds: [...(clustersByUnit.get(unit.unitId) ?? [])].sort() };
  });
  const maxLexical = Math.max(0, ...raw.map((entry) => entry.lexicalScore));
  const ranked = raw
    .map((entry) => ({
      ...entry,
      lexicalScore: maxLexical > 0 ? entry.lexicalScore / maxLexical : 0,
    }))
    .map((entry) => ({
      ...entry,
      score: weights.dense * entry.denseScore + weights.lexical * entry.lexicalScore + weights.phrase * entry.exactPhraseScore,
    }))
    .sort((left, right) => right.score - left.score || right.denseScore - left.denseScore || left.unit.unitId.localeCompare(right.unit.unitId))
    .slice(0, requestedTopK(request.topK))
    .map((entry, index) => ({
      rank: index + 1,
      unit: entry.unit,
      clusterIds: entry.clusterIds,
      score: Number(entry.score.toFixed(8)),
      denseScore: Number(entry.denseScore.toFixed(8)),
      lexicalScore: Number(entry.lexicalScore.toFixed(8)),
      exactPhraseScore: entry.exactPhraseScore,
    }));
  const queryHash = scientificContentHash({ query: normalizeSemanticText(query), filters: request.filters ?? null, weights, topK: requestedTopK(request.topK) });
  const warnings = [
    ...snapshot.manifest.warnings,
    ...(candidates.length === 0 ? ['No semantic units matched the requested metadata filters.'] : []),
  ];
  const content = {
    schemaVersion: 'medantir-semantic-search-response/1' as const,
    query,
    queryHash,
    indexHash: snapshot.indexHash,
    embedding: snapshot.manifest.embedding,
    results: ranked,
    warnings,
  };
  return { ...content, searchHash: scientificContentHash(content) };
}
