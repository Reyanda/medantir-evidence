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
  const contentHash = scientificContentHash({ kind: input.kind, payload, provenance });
  const objectId = `evo-${scientificContentHash({
    kind: input.kind,
    logicalId,
    version: input.version,
    contentHash,
    supersedes,
  })}`;
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
  return deepFreeze(object) as EvidenceObject<T>;
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
  const edgeId = `eve-${scientificContentHash({
    fromObjectId,
    toObjectId,
    relation: input.relation,
    evidenceObjectIds,
    metadata,
  })}`;
  return deepFreeze({
    edgeId,
    fromObjectId,
    toObjectId,
    relation: input.relation,
    evidenceObjectIds,
    metadata,
  }) as EvidenceGraphEdge;
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
  ) {
    validIso(generatedAt, 'Evidence graph generatedAt');
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
    const contentHash = scientificContentHash({ kind: input.kind, payload: safePayload, provenance: normalizedProvenance });
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
    const graphHash = scientificContentHash({
      reviewType: this.reviewType,
      rootObjectIds,
      objectIds: objects.map((object) => object.objectId),
      edgeIds: edges.map((edge) => edge.edgeId),
      metadata,
    });
    return deepFreeze({
      schemaVersion: EVIDENCE_GRAPH_SCHEMA_VERSION,
      reviewType: this.reviewType,
      graphHash,
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
      metadata: structuredClone(canonicalScientificValue(metadata)) as Record<string, unknown>,
    }) as EvidenceGraphSnapshot;
  }
}
