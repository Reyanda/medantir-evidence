import {
  canonicalScientificValue,
  containsRawSecretField,
  scientificContentHash,
} from '../core/canonical-hash.js';
import type {
  EvidenceEdgeRelation,
  EvidenceGraphEdge,
  EvidenceGraphSnapshot,
  EvidenceObject,
  EvidenceObjectKind,
  EvidenceProvenance,
} from './types.js';
import {
  EVIDENCE_GRAPH_SCHEMA_VERSION,
  EVIDENCE_OBJECT_SCHEMA_VERSION,
} from './types.js';
import type { ReviewType, StageName } from '../core/types.js';

function validIso(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid ISO timestamp.`);
  return value;
}

function cleanId(value: string, label: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${label} cannot be empty.`);
  if (clean.length > 512) throw new Error(`${label} is too long.`);
  return clean;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeProvenance(items: EvidenceProvenance[]): EvidenceProvenance[] {
  return items.map((item) => ({
    sourceClass: item.sourceClass,
    sourceIds: uniqueSorted(item.sourceIds),
    locators: item.locators.map((locator) => ({ ...locator })),
    ...(item.actorId ? { actorId: item.actorId.trim() } : {}),
    ...(item.method ? { method: item.method.trim() } : {}),
    ...(item.software ? { software: item.software.trim() } : {}),
    ...(item.model ? { model: item.model.trim() } : {}),
    ...(item.provider ? { provider: item.provider.trim() } : {}),
    ...(item.requestHash ? { requestHash: item.requestHash.trim() } : {}),
    ...(item.outputHash ? { outputHash: item.outputHash.trim() } : {}),
  }));
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (!value || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function evidenceObjectContentHash(input: {
  kind: EvidenceObjectKind;
  payload: unknown;
  provenance: EvidenceProvenance[];
}): string {
  return scientificContentHash({
    kind: input.kind,
    payload: canonicalScientificValue(input.payload),
    provenance: normalizeProvenance(input.provenance),
  });
}

export function evidenceObjectId(input: {
  kind: EvidenceObjectKind;
  logicalId: string;
  version: number;
  contentHash: string;
  supersedes: string[];
}): string {
  return `evo-${scientificContentHash({
    kind: input.kind,
    logicalId: cleanId(input.logicalId, 'Evidence object logicalId'),
    version: input.version,
    contentHash: input.contentHash,
    supersedes: uniqueSorted(input.supersedes),
  })}`;
}

export function verifyEvidenceObject(object: EvidenceObject): void {
  if (object.schemaVersion !== EVIDENCE_OBJECT_SCHEMA_VERSION) throw new Error(`Unsupported evidence object schema ${object.schemaVersion}.`);
  if (!Number.isInteger(object.version) || object.version < 1) throw new Error(`Evidence object ${object.objectId} has an invalid version.`);
  validIso(object.createdAt, `Evidence object ${object.objectId} createdAt`);
  if (object.immutable !== true) throw new Error(`Evidence object ${object.objectId} is not marked immutable.`);
  if (containsRawSecretField(object.payload)) throw new Error(`Evidence object ${object.objectId} contains a raw secret field.`);
  const contentHash = evidenceObjectContentHash({ kind: object.kind, payload: object.payload, provenance: object.provenance });
  if (object.contentHash !== contentHash) throw new Error(`Evidence object ${object.objectId} content hash mismatch.`);
  const expectedId = evidenceObjectId({
    kind: object.kind,
    logicalId: object.logicalId,
    version: object.version,
    contentHash,
    supersedes: object.supersedes,
  });
  if (object.objectId !== expectedId) throw new Error(`Evidence object identity mismatch for ${object.objectId}.`);
}

export function createEvidenceObject<T>(input: {
  kind: EvidenceObjectKind;
  logicalId: string;
  version: number;
  createdAt: string;
  payload: T;
  provenance?: EvidenceProvenance[];
  sourceStage?: StageName;
  supersedes?: string[];
}): EvidenceObject<T> {
  const logicalId = cleanId(input.logicalId, 'Evidence object logicalId');
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Evidence object version must be a positive integer.');
  const createdAt = validIso(input.createdAt, 'Evidence object createdAt');
  const payload = structuredClone(canonicalScientificValue(input.payload)) as T;
  if (containsRawSecretField(payload)) throw new Error('Evidence objects cannot contain raw secret fields.');
  const provenance = normalizeProvenance(input.provenance ?? []);
  const supersedes = uniqueSorted(input.supersedes ?? []);
  const contentHash = evidenceObjectContentHash({ kind: input.kind, payload, provenance });
  const objectId = evidenceObjectId({
    kind: input.kind,
    logicalId,
    version: input.version,
    contentHash,
    supersedes,
  });
  const object: EvidenceObject<T> = {
    schemaVersion: EVIDENCE_OBJECT_SCHEMA_VERSION,
    objectId,
    logicalId,
    kind: input.kind,
    version: input.version,
    contentHash,
    createdAt,
    payload,
    provenance,
    supersedes,
    immutable: true,
    ...(input.sourceStage ? { sourceStage: input.sourceStage } : {}),
  };
  verifyEvidenceObject(object);
  return deepFreeze(object) as EvidenceObject<T>;
}

export function evidenceGraphEdgeId(input: {
  fromObjectId: string;
  toObjectId: string;
  relation: EvidenceEdgeRelation;
  evidenceObjectIds: string[];
  metadata: Record<string, unknown>;
}): string {
  return `eve-${scientificContentHash({
    fromObjectId: cleanId(input.fromObjectId, 'Evidence edge fromObjectId'),
    toObjectId: cleanId(input.toObjectId, 'Evidence edge toObjectId'),
    relation: input.relation,
    evidenceObjectIds: uniqueSorted(input.evidenceObjectIds),
    metadata: canonicalScientificValue(input.metadata),
  })}`;
}

export function verifyEvidenceGraphEdge(edge: EvidenceGraphEdge): void {
  const expected = evidenceGraphEdgeId(edge);
  if (edge.edgeId !== expected) throw new Error(`Evidence graph edge identity mismatch for ${edge.edgeId}.`);
  if (edge.fromObjectId === edge.toObjectId) throw new Error(`Evidence graph edge ${edge.edgeId} is a self-edge.`);
}

export function createEvidenceGraphEdge(input: {
  fromObjectId: string;
  toObjectId: string;
  relation: EvidenceEdgeRelation;
  evidenceObjectIds?: string[];
  metadata?: Record<string, unknown>;
}): EvidenceGraphEdge {
  const fromObjectId = cleanId(input.fromObjectId, 'Evidence edge fromObjectId');
  const toObjectId = cleanId(input.toObjectId, 'Evidence edge toObjectId');
  if (fromObjectId === toObjectId) throw new Error('Evidence graph self-edges are not permitted.');
  const evidenceObjectIds = uniqueSorted(input.evidenceObjectIds ?? []);
  const metadata = structuredClone(canonicalScientificValue(input.metadata ?? {})) as Record<string, unknown>;
  const edge: EvidenceGraphEdge = {
    edgeId: evidenceGraphEdgeId({ fromObjectId, toObjectId, relation: input.relation, evidenceObjectIds, metadata }),
    fromObjectId,
    toObjectId,
    relation: input.relation,
    evidenceObjectIds,
    metadata,
  };
  verifyEvidenceGraphEdge(edge);
  return deepFreeze(edge) as EvidenceGraphEdge;
}

export function evidenceGraphHash(input: {
  reviewType: ReviewType;
  rootObjectIds: string[];
  objects: EvidenceObject[];
  edges: EvidenceGraphEdge[];
  metadata: Record<string, unknown>;
}): string {
  return scientificContentHash({
    reviewType: input.reviewType,
    rootObjectIds: uniqueSorted(input.rootObjectIds),
    objectIds: input.objects.map((object) => object.objectId).sort(),
    edgeIds: input.edges.map((edge) => edge.edgeId).sort(),
    metadata: canonicalScientificValue(input.metadata),
  });
}

export function verifyEvidenceGraphSnapshot(graph: EvidenceGraphSnapshot): void {
  if (graph.schemaVersion !== EVIDENCE_GRAPH_SCHEMA_VERSION) throw new Error(`Unsupported evidence graph schema ${graph.schemaVersion}.`);
  validIso(graph.generatedAt, 'Evidence graph generatedAt');
  const objectIds = new Set<string>();
  for (const object of graph.objects) {
    verifyEvidenceObject(object);
    if (objectIds.has(object.objectId)) throw new Error(`Evidence graph duplicates object ${object.objectId}.`);
    objectIds.add(object.objectId);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    verifyEvidenceGraphEdge(edge);
    if (edgeIds.has(edge.edgeId)) throw new Error(`Evidence graph duplicates edge ${edge.edgeId}.`);
    edgeIds.add(edge.edgeId);
    if (!objectIds.has(edge.fromObjectId) || !objectIds.has(edge.toObjectId)) throw new Error(`Evidence graph edge ${edge.edgeId} references a missing endpoint.`);
    for (const cited of edge.evidenceObjectIds) if (!objectIds.has(cited)) throw new Error(`Evidence graph edge ${edge.edgeId} cites missing object ${cited}.`);
  }
  for (const root of graph.rootObjectIds) if (!objectIds.has(root)) throw new Error(`Evidence graph root ${root} is missing.`);
  const expectedHash = evidenceGraphHash(graph);
  if (graph.graphHash !== expectedHash) throw new Error(`Evidence graph hash mismatch for ${graph.graphHash}.`);
  if (graph.summary.objectCount !== graph.objects.length || graph.summary.edgeCount !== graph.edges.length) {
    throw new Error(`Evidence graph summary count mismatch for ${graph.graphHash}.`);
  }
}

interface LatestObject {
  object: EvidenceObject;
  contentHash: string;
}

export class ImmutableEvidenceGraphBuilder {
  private readonly objectsById = new Map<string, EvidenceObject>();
  private readonly latestByLogical = new Map<string, LatestObject>();
  private readonly edgesById = new Map<string, EvidenceGraphEdge>();
  private readonly roots = new Set<string>();

  constructor(
    private readonly reviewType: ReviewType,
    private readonly generatedAt: string,
    previous?: EvidenceGraphSnapshot,
  ) {
    validIso(generatedAt, 'Evidence graph generatedAt');
    if (!previous) return;
    verifyEvidenceGraphSnapshot(previous);
    if (previous.reviewType !== reviewType) throw new Error('Previous evidence graph review type does not match the new projection.');
    for (const object of previous.objects) {
      this.objectsById.set(object.objectId, object);
      const key = `${object.kind}\u0000${object.logicalId}`;
      const latest = this.latestByLogical.get(key)?.object;
      if (latest && latest.version === object.version && latest.objectId !== object.objectId) {
        throw new Error(`Previous evidence graph has conflicting version ${object.version} for ${object.kind}:${object.logicalId}.`);
      }
      if (!latest || object.version > latest.version) this.latestByLogical.set(key, { object, contentHash: object.contentHash });
    }
    for (const edge of previous.edges) this.edgesById.set(edge.edgeId, edge);
  }

  add<T>(input: {
    kind: EvidenceObjectKind;
    logicalId: string;
    payload: T;
    provenance?: EvidenceProvenance[];
    sourceStage?: StageName;
    root?: boolean;
    createdAt?: string;
  }): EvidenceObject<T> {
    const logicalKey = `${input.kind}\u0000${cleanId(input.logicalId, 'Evidence object logicalId')}`;
    const safePayload = structuredClone(canonicalScientificValue(input.payload)) as T;
    const normalizedProvenance = normalizeProvenance(input.provenance ?? []);
    const contentHash = evidenceObjectContentHash({ kind: input.kind, payload: safePayload, provenance: normalizedProvenance });
    const latest = this.latestByLogical.get(logicalKey);
    if (latest?.contentHash === contentHash) {
      if (input.root) this.roots.add(latest.object.objectId);
      return latest.object as EvidenceObject<T>;
    }
    const object = createEvidenceObject({
      kind: input.kind,
      logicalId: input.logicalId,
      version: (latest?.object.version ?? 0) + 1,
      createdAt: input.createdAt ?? this.generatedAt,
      payload: safePayload,
      provenance: normalizedProvenance,
      ...(input.sourceStage ? { sourceStage: input.sourceStage } : {}),
      ...(latest ? { supersedes: [latest.object.objectId] } : {}),
    });
    this.objectsById.set(object.objectId, object);
    this.latestByLogical.set(logicalKey, { object, contentHash });
    if (latest) this.roots.delete(latest.object.objectId);
    if (input.root) this.roots.add(object.objectId);
    if (latest) {
      this.link({
        fromObjectId: object.objectId,
        toObjectId: latest.object.objectId,
        relation: 'supersedes',
      });
    }
    return object;
  }

  link(input: Parameters<typeof createEvidenceGraphEdge>[0]): EvidenceGraphEdge {
    if (!this.objectsById.has(input.fromObjectId)) throw new Error(`Evidence graph edge references missing source object ${input.fromObjectId}.`);
    if (!this.objectsById.has(input.toObjectId)) throw new Error(`Evidence graph edge references missing target object ${input.toObjectId}.`);
    for (const evidenceObjectId of input.evidenceObjectIds ?? []) {
      if (!this.objectsById.has(evidenceObjectId)) throw new Error(`Evidence graph edge cites missing evidence object ${evidenceObjectId}.`);
    }
    const edge = createEvidenceGraphEdge(input);
    this.edgesById.set(edge.edgeId, edge);
    return edge;
  }

  latest(kind: EvidenceObjectKind, logicalId: string): EvidenceObject | undefined {
    return this.latestByLogical.get(`${kind}\u0000${logicalId.trim()}`)?.object;
  }

  get(objectId: string): EvidenceObject | undefined {
    return this.objectsById.get(objectId);
  }

  snapshot(metadata: Record<string, unknown> = {}): EvidenceGraphSnapshot {
    const objects = [...this.objectsById.values()].sort((a, b) => a.objectId.localeCompare(b.objectId));
    const edges = [...this.edgesById.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    const rootObjectIds = [...this.roots].sort();
    const objectCountsByKind: EvidenceGraphSnapshot['summary']['objectCountsByKind'] = {};
    let sourceBoundObjectCount = 0;
    let humanAdjudicatedObjectCount = 0;
    let modelProposedObjectCount = 0;
    for (const object of objects) {
      objectCountsByKind[object.kind] = (objectCountsByKind[object.kind] ?? 0) + 1;
      if (object.provenance.some((item) => item.locators.length > 0 || item.sourceIds.length > 0)) sourceBoundObjectCount += 1;
      if (object.provenance.some((item) => item.sourceClass === 'human-adjudicated')) humanAdjudicatedObjectCount += 1;
      if (object.provenance.some((item) => item.sourceClass === 'model-proposed')) modelProposedObjectCount += 1;
    }
    const canonicalMetadata = structuredClone(canonicalScientificValue(metadata)) as Record<string, unknown>;
    const graph: EvidenceGraphSnapshot = {
      schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
      reviewType: this.reviewType,
      graphHash: evidenceGraphHash({ reviewType: this.reviewType, rootObjectIds, objects, edges, metadata: canonicalMetadata }),
      generatedAt: this.generatedAt,
      rootObjectIds,
      objects,
      edges,
      summary: {
        objectCount: objects.length,
        edgeCount: edges.length,
        objectCountsByKind,
        sourceBoundObjectCount,
        humanAdjudicatedObjectCount,
        modelProposedObjectCount,
      },
      metadata: canonicalMetadata,
    };
    verifyEvidenceGraphSnapshot(graph);
    return deepFreeze(graph) as EvidenceGraphSnapshot;
  }
}
