import { createHash } from 'node:crypto';

export const HISTORICAL_ARCHIVE_SCHEMA_VERSION = 'medantir-historical-object-archive/1' as const;

export type HistoricalArchiveRole =
  | 'database-export'
  | 'fulltext-source'
  | 'supplementary-file'
  | 'registry-snapshot'
  | 'manual-search-ledger'
  | 'parser-input'
  | 'parser-output'
  | 'extraction-source'
  | 'analysis-input'
  | 'analysis-output';

export type HistoricalArchiveAccessClass =
  | 'public'
  | 'restricted-source'
  | 'verifier-receipt-only';

export interface HistoricalArchiveObjectMetadata {
  role: HistoricalArchiveRole;
  mediaType: string;
  recordId?: string;
  sourceUri?: string;
  legalAccessRoute?: string;
  accessClass: HistoricalArchiveAccessClass;
  capturedAt?: string;
}

export interface HistoricalArchiveObjectReceipt extends HistoricalArchiveObjectMetadata {
  schemaVersion: typeof HISTORICAL_ARCHIVE_SCHEMA_VERSION;
  objectId: string;
  sha256: string;
  byteLength: number;
  storageReference: string;
}

export interface HistoricalObjectStorePort {
  put(bytes: Uint8Array, metadata: HistoricalArchiveObjectMetadata): Promise<HistoricalArchiveObjectReceipt>;
  get(receipt: HistoricalArchiveObjectReceipt): Promise<Uint8Array>;
}

export function rawHistoricalObjectHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyHistoricalArchiveBytes(
  receipt: HistoricalArchiveObjectReceipt,
  bytes: Uint8Array,
): boolean {
  return receipt.schemaVersion === HISTORICAL_ARCHIVE_SCHEMA_VERSION
    && bytes.byteLength === receipt.byteLength
    && rawHistoricalObjectHash(bytes) === receipt.sha256
    && receipt.objectId === `HOBJ-${receipt.sha256}`;
}

/**
 * Deterministic test/reference store. Production archives can implement the
 * same port using encrypted object storage, immutable release assets, WORM
 * storage or institutional repositories without changing scientific identity.
 */
export class InMemoryHistoricalObjectStore implements HistoricalObjectStorePort {
  private readonly objects = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array, metadata: HistoricalArchiveObjectMetadata): Promise<HistoricalArchiveObjectReceipt> {
    const copy = new Uint8Array(bytes);
    const sha256 = rawHistoricalObjectHash(copy);
    const objectId = `HOBJ-${sha256}`;
    this.objects.set(objectId, copy);
    return {
      schemaVersion: HISTORICAL_ARCHIVE_SCHEMA_VERSION,
      objectId,
      sha256,
      byteLength: copy.byteLength,
      storageReference: `memory://${objectId}`,
      ...metadata,
    };
  }

  async get(receipt: HistoricalArchiveObjectReceipt): Promise<Uint8Array> {
    const bytes = this.objects.get(receipt.objectId);
    if (!bytes) throw new Error(`Historical archive object '${receipt.objectId}' is unavailable.`);
    const copy = new Uint8Array(bytes);
    if (!verifyHistoricalArchiveBytes(receipt, copy)) {
      throw new Error(`Historical archive object '${receipt.objectId}' failed byte-level integrity verification.`);
    }
    return copy;
  }

  /** Test-only mutation hook used to falsify integrity checks. */
  corruptForTest(objectId: string, bytes: Uint8Array): void {
    this.objects.set(objectId, new Uint8Array(bytes));
  }
}

export async function archiveUtf8HistoricalObject(
  store: HistoricalObjectStorePort,
  text: string,
  metadata: HistoricalArchiveObjectMetadata,
): Promise<HistoricalArchiveObjectReceipt> {
  return store.put(new TextEncoder().encode(text), metadata);
}

export async function readUtf8HistoricalObject(
  store: HistoricalObjectStorePort,
  receipt: HistoricalArchiveObjectReceipt,
): Promise<string> {
  const bytes = await store.get(receipt);
  if (!verifyHistoricalArchiveBytes(receipt, bytes)) {
    throw new Error(`Historical archive object '${receipt.objectId}' failed byte-level integrity verification.`);
  }
  return new TextDecoder().decode(bytes);
}
