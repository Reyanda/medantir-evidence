import { scientificContentHash } from '../core/canonical-hash.js';
import {
  SEMANTIC_CLUSTER_SCHEMA_VERSION,
  type SemanticCluster,
  type SemanticEmbedding,
  type SemanticUnit,
  type SemanticUnitType,
} from './types.js';

const CLUSTERABLE_TYPES = new Set<SemanticUnitType>(['study', 'outcome', 'mechanism', 'claim', 'passage', 'section']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
  'study', 'studies', 'result', 'results', 'method', 'methods', 'effect', 'effects', 'outcome', 'outcomes', 'reported', 'using', 'among',
]);

function terms(text: string): string[] {
  return (text.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu) ?? [])
    .filter((term) => term.length > 2 && !STOPWORDS.has(term) && !/^\d+(?:\.\d+)?$/.test(term));
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) throw new Error('Semantic vectors have incompatible dimensions.');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? [...vector] : vector.map((value) => value / norm);
}

function mean(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('Cannot calculate an empty semantic centroid.');
  const dimensions = vectors[0]?.length ?? 0;
  const output = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    if (vector.length !== dimensions) throw new Error('Semantic cluster vectors have incompatible dimensions.');
    for (let index = 0; index < dimensions; index += 1) output[index] = (output[index] ?? 0) + (vector[index] ?? 0);
  }
  return normalize(output.map((value) => value / vectors.length));
}

function initialCentroids(items: Array<{ unit: SemanticUnit; vector: number[] }>, k: number): number[][] {
  const sorted = [...items].sort((left, right) => left.unit.unitId.localeCompare(right.unit.unitId));
  const first = sorted[0];
  if (!first) return [];
  const selected = [first];
  while (selected.length < k) {
    let best: typeof first | undefined;
    let bestDistance = Number.NEGATIVE_INFINITY;
    for (const candidate of sorted) {
      if (selected.some((entry) => entry.unit.unitId === candidate.unit.unitId)) continue;
      const distance = Math.min(...selected.map((entry) => 1 - cosineSimilarity(candidate.vector, entry.vector)));
      if (distance > bestDistance || (distance === bestDistance && candidate.unit.unitId.localeCompare(best?.unit.unitId ?? '') < 0)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    if (!best) break;
    selected.push(best);
  }
  return selected.map((entry) => [...entry.vector]);
}

function assign(items: Array<{ unit: SemanticUnit; vector: number[] }>, centroids: number[][]): number[] {
  return items.map((item) => {
    let bestIndex = 0;
    let bestSimilarity = Number.NEGATIVE_INFINITY;
    centroids.forEach((centroid, index) => {
      const similarity = cosineSimilarity(item.vector, centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    });
    return bestIndex;
  });
}

function kmeans(items: Array<{ unit: SemanticUnit; vector: number[] }>, k: number): { assignments: number[]; centroids: number[][] } {
  let centroids = initialCentroids(items, k);
  let assignments = assign(items, centroids);
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const nextCentroids = centroids.map((centroid, clusterIndex) => {
      const vectors = items.filter((_, index) => assignments[index] === clusterIndex).map((item) => item.vector);
      return vectors.length ? mean(vectors) : centroid;
    });
    const nextAssignments = assign(items, nextCentroids);
    const stable = nextAssignments.every((value, index) => value === assignments[index]);
    centroids = nextCentroids;
    assignments = nextAssignments;
    if (stable) break;
  }
  return { assignments, centroids };
}

function topTerms(members: SemanticUnit[], limit = 5): string[] {
  const documentFrequency = new Map<string, number>();
  const frequencies = new Map<string, number>();
  for (const member of members) {
    const memberTerms = terms(member.text);
    for (const term of memberTerms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    for (const term of new Set(memberTerms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const documents = Math.max(1, members.length);
  return [...frequencies.entries()]
    .map(([term, frequency]) => ({ term, score: frequency * Math.log(1 + documents / (documentFrequency.get(term) ?? 1)) }))
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term))
    .slice(0, limit)
    .map((entry) => entry.term);
}

function requestedK(size: number): number {
  if (size < 4) return 1;
  return Math.min(12, Math.max(2, Math.round(Math.sqrt(size / 2))));
}

export function buildSemanticClusters(
  units: SemanticUnit[],
  embeddings: SemanticEmbedding[],
  generatedAt = new Date().toISOString(),
): SemanticCluster[] {
  const vectorByUnit = new Map(embeddings.map((entry) => [entry.semanticUnitId, entry.vector] as const));
  const groups = new Map<SemanticUnitType, Array<{ unit: SemanticUnit; vector: number[] }>>();
  for (const unit of units) {
    if (!CLUSTERABLE_TYPES.has(unit.unitType)) continue;
    const vector = vectorByUnit.get(unit.unitId);
    if (!vector) continue;
    const group = groups.get(unit.unitType) ?? [];
    group.push({ unit, vector });
    groups.set(unit.unitType, group);
  }
  const clusterRunContent = {
    unitIds: units.map((unit) => unit.unitId).sort(),
    embeddingIds: embeddings.map((embedding) => embedding.embeddingId).sort(),
    algorithm: 'deterministic-spherical-kmeans-farthest-first/1',
  };
  const clusterRunId = `semcr-${scientificContentHash(clusterRunContent)}`;
  const clusters: SemanticCluster[] = [];
  for (const [unitType, rawItems] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const items = [...rawItems].sort((left, right) => left.unit.unitId.localeCompare(right.unit.unitId));
    if (items.length === 0) continue;
    const { assignments, centroids } = kmeans(items, requestedK(items.length));
    centroids.forEach((centroid, clusterIndex) => {
      const members = items.filter((_, index) => assignments[index] === clusterIndex);
      if (members.length === 0) return;
      const memberUnits = members.map((entry) => entry.unit);
      const memberSemanticUnitIds = memberUnits.map((unit) => unit.unitId).sort();
      const selectedTerms = topTerms(memberUnits);
      const stability = members.reduce((sum, member) => sum + Math.max(0, cosineSimilarity(member.vector, centroid)), 0) / members.length;
      const centroidHash = scientificContentHash(centroid);
      const identity = { clusterRunId, unitType, memberSemanticUnitIds, centroidHash };
      clusters.push({
        schemaVersion: SEMANTIC_CLUSTER_SCHEMA_VERSION,
        clusterId: `semc-${scientificContentHash(identity)}`,
        clusterRunId,
        unitType,
        memberSemanticUnitIds,
        centroid,
        centroidHash,
        topTerms: selectedTerms,
        machineLabel: selectedTerms.slice(0, 3).join(' · ') || `${unitType} cluster`,
        labelStatus: 'machine-proposed',
        stability: Number(stability.toFixed(6)),
        generatedAt,
      });
    });
  }
  return clusters.sort((left, right) => `${left.unitType}\u0000${left.clusterId}`.localeCompare(`${right.unitType}\u0000${right.clusterId}`));
}
