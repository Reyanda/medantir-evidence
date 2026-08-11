import { link, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  HISTORICAL_ARCHIVE_SCHEMA_VERSION,
  rawHistoricalObjectHash,
  verifyHistoricalArchiveBytes,
  type HistoricalArchiveObjectMetadata,
  type HistoricalArchiveObjectReceipt,
  type HistoricalObjectStorePort,
} from './object-archive.js';

/**
 * Content-addressed immutable archive suitable for mounted WORM/encrypted
 * storage. User/source filenames never participate in paths; object paths are
 * derived only from validated SHA-256 content digests.
 */
export class FilesystemHistoricalObjectStore implements HistoricalObjectStorePort {
  private readonly root: string;

  constructor(root: string) {
    if (!root.trim()) throw new Error('Historical object-store root is required.');
    this.root = resolve(root);
  }

  private objectPath(sha256: string): string {
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('Historical object SHA-256 is invalid.');
    return join(this.root, 'objects', sha256.slice(0, 2), sha256.toLowerCase());
  }

  private async verifyExisting(target: string, sha256: string, byteLength: number): Promise<void> {
    const existing = new Uint8Array(await readFile(target));
    if (rawHistoricalObjectHash(existing) !== sha256 || existing.byteLength !== byteLength) {
      throw new Error(`Historical object path '${target}' exists with content inconsistent with its digest.`);
    }
  }

  async put(bytes: Uint8Array, metadata: HistoricalArchiveObjectMetadata): Promise<HistoricalArchiveObjectReceipt> {
    const copy = new Uint8Array(bytes);
    const sha256 = rawHistoricalObjectHash(copy);
    const objectId = `HOBJ-${sha256}`;
    const target = this.objectPath(sha256);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });

    try {
      await this.verifyExisting(target, sha256, copy.byteLength);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(copy);
          await handle.sync();
        } finally {
          await handle.close();
        }

        // Publish by hard-link creation, not rename. link() is exclusive: it
        // fails with EEXIST if another writer has already published this digest,
        // so an immutable target can never be replaced by a racing process.
        try {
          await link(temporary, target);
        } catch (publishError) {
          const publishCode = (publishError as NodeJS.ErrnoException).code;
          if (publishCode !== 'EEXIST') throw publishError;
          await this.verifyExisting(target, sha256, copy.byteLength);
        } finally {
          await rm(temporary, { force: true });
        }
      } catch (writeError) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw writeError;
      }
    }

    const info = await stat(target);
    if (info.size !== copy.byteLength) throw new Error(`Historical object '${objectId}' size changed after archival.`);
    return {
      schemaVersion: HISTORICAL_ARCHIVE_SCHEMA_VERSION,
      objectId,
      sha256,
      byteLength: copy.byteLength,
      storageReference: `file://${target}`,
      ...metadata,
    };
  }

  async get(receipt: HistoricalArchiveObjectReceipt): Promise<Uint8Array> {
    if (receipt.objectId !== `HOBJ-${receipt.sha256}`) {
      throw new Error(`Historical object receipt '${receipt.objectId}' is inconsistent with SHA-256 ${receipt.sha256}.`);
    }
    const target = this.objectPath(receipt.sha256);
    const bytes = new Uint8Array(await readFile(target));
    if (!verifyHistoricalArchiveBytes(receipt, bytes)) {
      throw new Error(`Historical object '${receipt.objectId}' failed immutable byte verification.`);
    }
    return bytes;
  }
}
