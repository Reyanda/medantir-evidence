import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scientificContentHash } from '../core/canonical-hash.js';
import { verifySemanticIndexSnapshot } from './index-builder.js';
import type { SemanticIndexRepository, SemanticIndexSnapshot } from './types.js';

async function createPrivateFile(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o600);
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const handle = await open(temporary, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function notFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export class FileSemanticIndexRepository implements SemanticIndexRepository {
  private readonly rootDir: string;

  constructor(options: { rootDir: string }) {
    if (!options.rootDir.trim()) throw new Error('Semantic index repository rootDir is required.');
    this.rootDir = join(options.rootDir, 'semantic-index');
  }

  private runDirectory(runId: string): string {
    return join(this.rootDir, 'runs', `run-${scientificContentHash(runId)}`);
  }

  async put(snapshot: SemanticIndexSnapshot): Promise<void> {
    verifySemanticIndexSnapshot(snapshot);
    const directory = this.runDirectory(snapshot.runId);
    const snapshots = join(directory, 'snapshots');
    await mkdir(snapshots, { recursive: true, mode: 0o700 });
    const snapshotPath = join(snapshots, `${snapshot.indexHash}.json`);
    let persisted = snapshot;

    try {
      await createPrivateFile(snapshotPath, `${JSON.stringify(snapshot)}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = JSON.parse(await readFile(snapshotPath, 'utf8')) as SemanticIndexSnapshot;
      verifySemanticIndexSnapshot(existing);
      if (existing.indexHash !== snapshot.indexHash) throw new Error('Semantic index snapshot collision.');
      persisted = existing;
    }

    const pointer = {
      schemaVersion: 'medantir-semantic-index-pointer/1',
      runId: persisted.runId,
      indexHash: persisted.indexHash,
      sourceStateHash: persisted.sourceStateHash,
      manifestHash: persisted.manifest.manifestHash,
      updatedAt: persisted.generatedAt,
    };
    await atomicPrivateWrite(join(directory, 'latest.json'), `${JSON.stringify(pointer)}\n`);
  }

  async getLatest(runId: string): Promise<SemanticIndexSnapshot | null> {
    const directory = this.runDirectory(runId);
    let pointer: { runId?: unknown; indexHash?: unknown; manifestHash?: unknown };

    try {
      pointer = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')) as typeof pointer;
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }

    if (
      pointer.runId !== runId
      || typeof pointer.indexHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(pointer.indexHash)
    ) {
      throw new Error('Semantic index latest pointer is malformed.');
    }

    let snapshot: SemanticIndexSnapshot;
    try {
      const snapshotPath = join(directory, 'snapshots', `${pointer.indexHash}.json`);
      snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as SemanticIndexSnapshot;
    } catch (error) {
      if (notFound(error)) throw new Error('Semantic index latest pointer references a missing snapshot.');
      throw error;
    }

    verifySemanticIndexSnapshot(snapshot);
    if (
      snapshot.runId !== runId
      || snapshot.indexHash !== pointer.indexHash
      || snapshot.manifest.manifestHash !== pointer.manifestHash
    ) {
      throw new Error('Semantic index latest pointer does not reconcile to its snapshot.');
    }
    return snapshot;
  }
}

export class MemorySemanticIndexRepository implements SemanticIndexRepository {
  private readonly snapshots = new Map<string, SemanticIndexSnapshot>();

  async put(snapshot: SemanticIndexSnapshot): Promise<void> {
    verifySemanticIndexSnapshot(snapshot);
    const existing = this.snapshots.get(snapshot.runId);
    if (existing?.indexHash === snapshot.indexHash) return;
    this.snapshots.set(snapshot.runId, structuredClone(snapshot));
  }

  async getLatest(runId: string): Promise<SemanticIndexSnapshot | null> {
    const snapshot = this.snapshots.get(runId);
    if (!snapshot) return null;
    const copy = structuredClone(snapshot);
    verifySemanticIndexSnapshot(copy);
    return copy;
  }
}
