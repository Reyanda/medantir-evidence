import { scientificContentHash } from '../core/canonical-hash.js';

export const OSF_SOURCE_INVENTORY_SCHEMA_VERSION = 'medantir-osf-source-inventory/1' as const;

type Resource = {
  id?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  links?: Record<string, unknown>;
};
type Collection = { data?: unknown; links?: Record<string, unknown> };

export interface OsfSourceInventoryInput {
  nodeId: string;
  apiBase?: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
}

export interface OsfSourceInventoryEntry {
  path: string;
  fileId: string;
  currentRevision?: string;
  byteLength?: number;
  sha256?: string;
  mediaType?: string;
  versionsUrl: string;
  currentDownloadUrl?: string;
}

export interface OsfSourceInventory {
  schemaVersion: typeof OSF_SOURCE_INVENTORY_SCHEMA_VERSION;
  nodeId: string;
  provider: 'osfstorage';
  qualificationReady: false;
  entries: OsfSourceInventoryEntry[];
  inventoryHash: string;
}

function cleanPath(value: string): string {
  const path = value.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid OSF materialized path '${value}'.`);
  return path;
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

function kind(resource: Resource): string {
  return attrString(resource, 'kind')?.toLowerCase() ?? '';
}

function pathOf(resource: Resource, parent: string): string {
  const materialized = attrString(resource, 'materialized_path');
  if (materialized) return cleanPath(materialized);
  const name = attrString(resource, 'name');
  if (!name) throw new Error(`OSF resource '${String(resource.id ?? '')}' has no name/materialized_path.`);
  return cleanPath(parent ? `${parent}/${name}` : name);
}

function revision(resource: Resource): string | undefined {
  const value = resource.attributes?.current_version;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function size(resource: Resource): number | undefined {
  const value = resource.attributes?.size;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function sha256(resource: Resource): string | undefined {
  const extra = resource.attributes?.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const hashes = (extra as Record<string, unknown>).hashes;
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) return undefined;
  const value = (hashes as Record<string, unknown>).sha256;
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

class Client {
  constructor(private readonly fetchImpl: typeof fetch, private readonly bearerToken?: string) {}
  async all(url: string, label: string): Promise<Resource[]> {
    const output: Resource[] = [];
    const seen = new Set<string>();
    let next: string | undefined = url;
    while (next) {
      if (seen.has(next)) throw new Error(`${label} pagination loop detected.`);
      seen.add(next);
      const response = await this.fetchImpl(next, {
        headers: { accept: 'application/vnd.api+json', ...(this.bearerToken?.trim() ? { authorization: `Bearer ${this.bearerToken.trim()}` } : {}) },
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`OSF inventory request failed HTTP ${response.status} for ${next}: ${text.slice(0, 300)}`);
      let page: Collection;
      try { page = JSON.parse(text) as Collection; } catch { throw new Error(`OSF inventory endpoint returned non-JSON content for ${next}.`); }
      output.push(...resources(page, label));
      next = link(page.links?.next);
    }
    return output;
  }
}

export async function inventoryOsfSources(input: OsfSourceInventoryInput): Promise<OsfSourceInventory> {
  const nodeId = input.nodeId.trim();
  if (!/^[a-z0-9]+$/i.test(nodeId)) throw new Error('OSF inventory requires an alphanumeric node ID.');
  const apiBase = (input.apiBase ?? 'https://api.osf.io/v2').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(apiBase)) throw new Error('OSF API base must be HTTPS.');
  const client = new Client(input.fetchImpl ?? fetch, input.bearerToken);
  const providers = await client.all(`${apiBase}/nodes/${encodeURIComponent(nodeId)}/files/`, 'OSF storage providers');
  const provider = providers.find((item) => id(item, 'OSF storage provider').toLowerCase() === 'osfstorage');
  if (!provider) throw new Error(`OSF node '${nodeId}' has no osfstorage provider.`);
  const root = link(provider.links?.files) ?? link(provider.relationships?.files) ?? `${apiBase}/nodes/${encodeURIComponent(nodeId)}/files/osfstorage/`;

  const entries: OsfSourceInventoryEntry[] = [];
  const queue: Array<{ url: string; parent: string }> = [{ url: root, parent: '' }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);
    for (const resource of await client.all(current.url, `OSF files under '${current.parent || '/'}'`)) {
      const path = pathOf(resource, current.parent);
      if (kind(resource) === 'folder') {
        const children = link(resource.relationships?.files) ?? link(resource.relationships?.children) ?? link(resource.links?.files);
        if (!children) throw new Error(`OSF folder '${path}' has no child-files relationship.`);
        queue.push({ url: children, parent: path });
        continue;
      }
      if (kind(resource) !== 'file') continue;
      const fileId = id(resource, 'OSF file');
      const versionsUrl = link(resource.relationships?.versions) ?? `${apiBase}/files/${encodeURIComponent(fileId)}/versions/`;
      const currentRevision = revision(resource);
      const byteLength = size(resource);
      const digest = sha256(resource);
      const mediaType = (attrString(resource, 'content_type') ?? attrString(resource, 'contentType'))?.toLowerCase();
      const currentDownloadUrl = link(resource.links?.download);
      entries.push({
        path,
        fileId,
        ...(currentRevision ? { currentRevision } : {}),
        ...(byteLength !== undefined ? { byteLength } : {}),
        ...(digest ? { sha256: digest } : {}),
        ...(mediaType ? { mediaType } : {}),
        versionsUrl,
        ...(currentDownloadUrl ? { currentDownloadUrl } : {}),
      });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.fileId.localeCompare(b.fileId));
  const base = { schemaVersion: OSF_SOURCE_INVENTORY_SCHEMA_VERSION, nodeId, provider: 'osfstorage' as const, qualificationReady: false as const, entries };
  return { ...base, inventoryHash: scientificContentHash(base) };
}
