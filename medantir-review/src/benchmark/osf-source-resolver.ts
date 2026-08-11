import { createHash } from 'node:crypto';
import { scientificContentHash } from '../core/canonical-hash.js';
import {
  verifyHistoricalArchiveBytes,
  type HistoricalArchiveAccessClass,
  type HistoricalArchiveObjectReceipt,
  type HistoricalArchiveRole,
  type HistoricalObjectStorePort,
} from '../historical/object-archive.js';
import {
  createSrQualificationSourceCapture,
  type SrQualificationSourceCapture,
  type SrQualificationSourceRole,
  type SrQualificationUse,
} from './sr-qualification-source-capture.js';
import type { SrQualificationComponent } from './sr-qualification-corpus.js';

export const OSF_SOURCE_RESOLUTION_SCHEMA_VERSION = 'medantir-osf-source-resolution/2' as const;
export const OSF_SOURCE_FIXTURE_SCHEMA_VERSION = 'medantir-osf-source-fixture/1' as const;

type Resource = {
  id?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, unknown>;
};
type Collection = { data?: unknown; links?: Record<string, unknown> };

export interface OsfSourceTarget {
  path: string;
  revision: string;
  expectedSha256?: string;
  expectedByteLength?: number;
}

export interface OsfArchiveMetadata {
  role: HistoricalArchiveRole;
  accessClass: HistoricalArchiveAccessClass;
  legalAccessRoute?: string;
}

export interface OsfSourceResolutionInput {
  nodeId: string;
  candidateId: string;
  component: SrQualificationComponent;
  sourceRole: SrQualificationSourceRole;
  qualificationUse: SrQualificationUse;
  targets: OsfSourceTarget[];
  capturedAt: string;
  apiBase?: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
  /** Required for benchmark-gold OSF byte sources. The store must persist and replay the exact downloaded bytes. */
  archiveStore?: HistoricalObjectStorePort;
  /** Required whenever archiveStore is supplied so archival role/access semantics are explicit rather than guessed. */
  archiveMetadata?: OsfArchiveMetadata;
}

export interface OsfResolvedObject {
  path: string;
  fileId: string;
  revision: string;
  downloadUrl: string;
  versionHtmlUrl?: string;
  objectId: string;
  sha256: string;
  byteLength: number;
  mediaType?: string;
}

export interface OsfSourceResolution {
  schemaVersion: typeof OSF_SOURCE_RESOLUTION_SCHEMA_VERSION;
  nodeId: string;
  provider: 'osfstorage';
  resolvedObjects: OsfResolvedObject[];
  archivePersistence: 'verified' | 'not-requested';
  archiveReceipts: HistoricalArchiveObjectReceipt[];
  sourceCapture: SrQualificationSourceCapture;
  resolutionHash: string;
}

export interface OsfSourceFixture {
  schemaVersion: typeof OSF_SOURCE_FIXTURE_SCHEMA_VERSION;
  routes: Record<string, {
    status?: number;
    headers?: Record<string, string>;
    json?: unknown;
    text?: string;
    bytesBase64?: string;
  }>;
}

interface ResolvedDownload {
  object: OsfResolvedObject;
  bytes: Uint8Array;
}

function cleanPath(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid OSF target path '${value}'.`);
  return path;
}

function cleanRevision(value: string): string {
  const revision = value.trim();
  if (!revision || !/^[A-Za-z0-9._-]+$/.test(revision)) throw new Error(`Invalid OSF file revision '${value}'.`);
  return revision;
}

function link(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.href === 'string' && /^https?:\/\//i.test(record.href)) return record.href;
  return link(record.related) ?? link(record.self) ?? link(record.links);
}

function resources(payload: Collection, label: string): Resource[] {
  if (!Array.isArray(payload.data) || payload.data.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${label} returned malformed JSON-API data.`);
  }
  return payload.data as Resource[];
}

function id(resource: Resource, label: string): string {
  if (typeof resource.id !== 'string' || !resource.id.trim()) throw new Error(`${label} has no stable ID.`);
  return resource.id.trim();
}

function attrString(resource: Resource, key: string): string | undefined {
  const value = resource.attributes?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function filePath(resource: Resource, parent: string): string {
  const materialized = attrString(resource, 'materialized_path');
  if (materialized) return cleanPath(materialized);
  const name = attrString(resource, 'name');
  if (!name) throw new Error(`OSF file '${String(resource.id ?? '')}' has no name/materialized_path.`);
  return cleanPath(parent ? `${parent}/${name}` : name);
}

function kind(resource: Resource): string {
  return attrString(resource, 'kind')?.toLowerCase() ?? '';
}

function currentRevision(resource: Resource): string | undefined {
  const value = resource.attributes?.current_version;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function size(resource: Resource): number | undefined {
  const value = resource.attributes?.size;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function mediaType(resource: Resource): string | undefined {
  return (attrString(resource, 'content_type') ?? attrString(resource, 'contentType'))?.toLowerCase();
}

function currentSha(resource: Resource): string | undefined {
  const extra = resource.attributes?.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const hashes = (extra as Record<string, unknown>).hashes;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) return undefined;
  const sha = (hashes as Record<string, unknown>).sha256;
  return typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha.trim()) ? sha.trim().toLowerCase() : undefined;
}

class Client {
  constructor(private readonly fetchImpl: typeof fetch, private readonly bearerToken?: string) {}
  private headers(): Record<string, string> {
    return { accept: 'application/vnd.api+json', ...(this.bearerToken?.trim() ? { authorization: `Bearer ${this.bearerToken.trim()}` } : {}) };
  }
  async json(url: string): Promise<Collection> {
    const response = await this.fetchImpl(url, { headers: this.headers() });
    const text = await response.text();
    if (!response.ok) throw new Error(`OSF request failed HTTP ${response.status} for ${url}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text) as Collection; } catch { throw new Error(`OSF endpoint returned non-JSON content for ${url}.`); }
  }
  async all(url: string, label: string): Promise<Resource[]> {
    const output: Resource[] = [];
    const seen = new Set<string>();
    let next: string | undefined = url;
    while (next) {
      if (seen.has(next)) throw new Error(`${label} pagination loop detected.`);
      seen.add(next);
      const page = await this.json(next);
      output.push(...resources(page, label));
      next = link(page.links?.next);
    }
    return output;
  }
  async bytes(url: string): Promise<{ bytes: Uint8Array; mediaType?: string }> {
    const response = await this.fetchImpl(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`OSF download failed HTTP ${response.status} for ${url}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    return { bytes, ...(type ? { mediaType: type } : {}) };
  }
}

async function listFiles(client: Client, apiBase: string, nodeId: string): Promise<Array<{ resource: Resource; path: string }>> {
  const providers = await client.all(`${apiBase}/nodes/${encodeURIComponent(nodeId)}/files/`, 'OSF storage providers');
  const provider = providers.find((item) => id(item, 'OSF storage provider').toLowerCase() === 'osfstorage');
  if (!provider) throw new Error(`OSF node '${nodeId}' has no osfstorage provider.`);
  const root = link(provider.links?.files) ?? link(provider.relationships?.files) ?? `${apiBase}/nodes/${encodeURIComponent(nodeId)}/files/osfstorage/`;
  const queue: Array<{ url: string; parent: string }> = [{ url: root, parent: '' }];
  const visited = new Set<string>();
  const files: Array<{ resource: Resource; path: string }> = [];
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    for (const resource of await client.all(current.url, `OSF files under '${current.parent || '/'}'`)) {
      const path = filePath(resource, current.parent);
      if (kind(resource) === 'folder') {
        const children = link(resource.relationships?.files) ?? link(resource.relationships?.children) ?? link(resource.links?.files);
        if (!children) throw new Error(`OSF folder '${path}' has no child-files relationship.`);
        queue.push({ url: children, parent: path });
      } else if (kind(resource) === 'file') files.push({ resource, path });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function select(files: Array<{ resource: Resource; path: string }>, requested: string) {
  const path = cleanPath(requested);
  const exact = files.filter((item) => item.path === path);
  if (exact.length === 1) return exact[0]!;
  if (path.includes('/')) throw new Error(`OSF target path '${path}' was not found.`);
  const byName = files.filter((item) => item.path.split('/').at(-1) === path);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new Error(`OSF target basename '${path}' is ambiguous; use an exact materialized path.`);
  throw new Error(`OSF target '${path}' was not found.`);
}

async function resolveTarget(client: Client, apiBase: string, file: { resource: Resource; path: string }, target: OsfSourceTarget): Promise<ResolvedDownload> {
  const fileId = id(file.resource, 'OSF file');
  const revision = cleanRevision(target.revision);
  const versionsUrl = link(file.resource.relationships?.versions) ?? `${apiBase}/files/${encodeURIComponent(fileId)}/versions/`;
  const version = (await client.all(versionsUrl, `OSF versions for '${file.path}'`)).find((item) => id(item, 'OSF file version') === revision);
  if (!version) throw new Error(`OSF file '${file.path}' has no revision '${revision}'.`);
  const downloadUrl = link(version.links?.download) ?? (currentRevision(file.resource) === revision ? link(file.resource.links?.download) : undefined);
  if (!downloadUrl) throw new Error(`OSF revision '${revision}' for '${file.path}' has no version-specific download link and is not the current downloadable revision.`);
  const downloaded = await client.bytes(downloadUrl);
  const byteLength = downloaded.bytes.byteLength;
  if (size(version) !== undefined && size(version) !== byteLength) throw new Error(`OSF revision '${revision}' for '${file.path}' reported ${size(version)} bytes but downloaded ${byteLength}.`);
  if (target.expectedByteLength !== undefined && target.expectedByteLength !== byteLength) throw new Error(`OSF target '${file.path}' expected ${target.expectedByteLength} bytes but downloaded ${byteLength}.`);
  const sha256 = createHash('sha256').update(downloaded.bytes).digest('hex');
  if (target.expectedSha256 && target.expectedSha256.trim().toLowerCase() !== sha256) throw new Error(`OSF target '${file.path}' SHA-256 mismatch.`);
  if (currentRevision(file.resource) === revision && currentSha(file.resource) && currentSha(file.resource) !== sha256) throw new Error(`OSF current-file SHA-256 disagrees with downloaded bytes for '${file.path}'.`);
  const type = mediaType(version) ?? downloaded.mediaType ?? mediaType(file.resource);
  const html = link(version.links?.html);
  const object: OsfResolvedObject = {
    path: file.path,
    fileId,
    revision,
    downloadUrl,
    ...(html ? { versionHtmlUrl: html } : {}),
    objectId: `HOBJ-${sha256}`,
    sha256,
    byteLength,
    ...(type ? { mediaType: type } : {}),
  };
  return { object, bytes: downloaded.bytes };
}

async function persistResolvedObjects(input: {
  downloads: ResolvedDownload[];
  store: HistoricalObjectStorePort;
  metadata: OsfArchiveMetadata;
  capturedAt: string;
}): Promise<HistoricalArchiveObjectReceipt[]> {
  const receipts: HistoricalArchiveObjectReceipt[] = [];
  for (const download of input.downloads) {
    const receipt = await input.store.put(download.bytes, {
      role: input.metadata.role,
      mediaType: download.object.mediaType ?? 'application/octet-stream',
      sourceUri: download.object.downloadUrl,
      ...(input.metadata.legalAccessRoute?.trim() ? { legalAccessRoute: input.metadata.legalAccessRoute.trim() } : {}),
      accessClass: input.metadata.accessClass,
      capturedAt: input.capturedAt,
    });
    const replayed = await input.store.get(receipt);
    if (!verifyHistoricalArchiveBytes(receipt, download.bytes)
      || !verifyHistoricalArchiveBytes(receipt, replayed)
      || receipt.objectId !== download.object.objectId
      || receipt.sha256 !== download.object.sha256
      || receipt.byteLength !== download.object.byteLength) {
      throw new Error(`Immutable archive write/read verification failed for OSF object '${download.object.path}' revision '${download.object.revision}'.`);
    }
    receipts.push(receipt);
  }
  return receipts.sort((a, b) => a.objectId.localeCompare(b.objectId));
}

function portableArchiveReceipt(receipt: HistoricalArchiveObjectReceipt): Omit<HistoricalArchiveObjectReceipt, 'storageReference'> {
  const { storageReference: _storageReference, ...portable } = receipt;
  return portable;
}

export async function resolveOsfSources(input: OsfSourceResolutionInput): Promise<OsfSourceResolution> {
  const nodeId = input.nodeId.trim();
  if (!/^[a-z0-9]+$/i.test(nodeId)) throw new Error('OSF resolver requires an alphanumeric node ID.');
  if (!input.candidateId.trim() || input.targets.length === 0) throw new Error('OSF resolver requires candidateId and target files.');
  if (Number.isNaN(Date.parse(input.capturedAt))) throw new Error('OSF resolver capturedAt must be a valid date-time.');
  if (Boolean(input.archiveStore) !== Boolean(input.archiveMetadata)) {
    throw new Error('OSF immutable archival requires both archiveStore and explicit archiveMetadata.');
  }
  if (input.qualificationUse === 'benchmark-gold' && !input.archiveStore) {
    throw new Error('Benchmark-gold OSF sources must be persisted in an immutable content-addressed object store; hash-only download verification is insufficient.');
  }
  const pairs = input.targets.map((target) => `${cleanPath(target.path)}@${cleanRevision(target.revision)}`);
  if (new Set(pairs).size !== pairs.length) throw new Error('OSF resolver target path/revision pairs must be unique.');
  const apiBase = (input.apiBase ?? 'https://api.osf.io/v2').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(apiBase)) throw new Error('OSF API base must be HTTPS.');
  const client = new Client(input.fetchImpl ?? fetch, input.bearerToken);
  const files = await listFiles(client, apiBase, nodeId);
  const downloads: ResolvedDownload[] = [];
  for (const target of input.targets) downloads.push(await resolveTarget(client, apiBase, select(files, target.path), target));
  downloads.sort((a, b) => a.object.path.localeCompare(b.object.path) || a.object.revision.localeCompare(b.object.revision));
  const resolvedObjects = downloads.map((item) => item.object);
  const archiveReceipts = input.archiveStore && input.archiveMetadata
    ? await persistResolvedObjects({ downloads, store: input.archiveStore, metadata: input.archiveMetadata, capturedAt: input.capturedAt })
    : [];
  const archivePersistence = archiveReceipts.length === resolvedObjects.length && archiveReceipts.length > 0
    ? 'verified' as const
    : 'not-requested' as const;
  const sourceCapture = createSrQualificationSourceCapture({
    candidateId: input.candidateId.trim(),
    component: input.component,
    sourceIdentities: resolvedObjects.map((item) => ({
      kind: 'sha256-object' as const,
      objectId: item.objectId,
      sha256: item.sha256,
      byteLength: item.byteLength,
      ...(item.mediaType ? { mediaType: item.mediaType } : {}),
    })),
    selectedPaths: resolvedObjects.map((item) => `${item.path}?revision=${item.revision}`),
    sourceRole: input.sourceRole,
    qualificationUse: input.qualificationUse,
    capturedAt: input.capturedAt,
    captureMethod: archivePersistence === 'verified' ? 'content-addressed-archive' : 'content-hash-verification',
  });
  const base = {
    schemaVersion: OSF_SOURCE_RESOLUTION_SCHEMA_VERSION,
    nodeId,
    provider: 'osfstorage' as const,
    resolvedObjects,
    archivePersistence,
    archiveReceipts,
    sourceCapture,
  };
  const portableHashBase = {
    ...base,
    archiveReceipts: archiveReceipts.map(portableArchiveReceipt),
  };
  return { ...base, resolutionHash: scientificContentHash(portableHashBase) };
}

export function createOsfFixtureFetch(fixture: OsfSourceFixture): typeof fetch {
  if (fixture.schemaVersion !== OSF_SOURCE_FIXTURE_SCHEMA_VERSION) throw new Error(`Unsupported OSF fixture schema '${fixture.schemaVersion}'.`);
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const route = fixture.routes[url];
    if (!route) return new Response(`No fixture route for ${url}`, { status: 599 });
    const headers = new Headers(route.headers ?? {});
    const status = route.status ?? 200;
    if (route.json !== undefined) return new Response(JSON.stringify(route.json), { status, headers });
    if (route.bytesBase64 !== undefined) return new Response(Buffer.from(route.bytesBase64, 'base64'), { status, headers });
    return new Response(route.text ?? '', { status, headers });
  }) as typeof fetch;
}
