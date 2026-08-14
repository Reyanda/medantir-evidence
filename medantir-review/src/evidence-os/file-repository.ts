import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { scientificHash } from '../core/canonical-hash.js';
import type { StageName } from '../core/types.js';
import {
  verifyEvidenceGraphSnapshot,
  verifyEvidenceObject,
} from './object-store.js';
import type { EvidenceObjectRepositoryPort } from './ports.js';
import type { EvidenceGraphSnapshot, EvidenceObject } from './types.js';

export interface EvidenceGraphCheckpointReceipt {
  schemaVersion: 'medantir-evidence-graph-checkpoint/1';
  runId: string;
  sequence: number;
  stage: StageName;
  event: string;
  attempt: number;
  recordedAt: string;
  eventHash: string;
  stateHash: string;
  graphHash: string;
  previousGraphHash: string | null;
  receiptHash: string;
}

interface EvidenceGraphLatestPointer {
  schemaVersion: 'medantir-evidence-graph-latest/1';
  runId: string;
  sequence: number;
  graphHash: string;
  receiptHash: string;
  updatedAt: string;
  pointerHash: string;
}

export interface FileEvidenceGraphRepositoryOptions {
  rootDir: string;
}

type ExistingContentVerifier = (existing: string) => boolean;

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(runId)) throw new Error(`Unsafe evidence graph run id: ${runId}`);
}

function assertObjectId(objectId: string): void {
  if (!/^evo-[a-f0-9]{64}$/.test(objectId)) throw new Error(`Invalid evidence object id ${objectId}.`);
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
}

function assertSequence(sequence: number): void {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error(`Invalid evidence graph checkpoint sequence ${sequence}.`);
}

function sequenceName(sequence: number): string {
  assertSequence(sequence);
  return String(sequence).padStart(12, '0');
}

function validIso(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid timestamp.`);
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function fsyncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(code ?? '')) throw error;
  }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsyncFile(temporary);
  await rename(temporary, path);
  await fsyncDirectory(directory);
}

function equivalentContent(existing: string, content: string, verifier?: ExistingContentVerifier): boolean {
  if (existing === content) return true;
  return verifier?.(existing) === true;
}

async function immutableWrite(
  path: string,
  content: string,
  verifyExisting?: ExistingContentVerifier,
): Promise<boolean> {
  try {
    const existing = await readFile(path, 'utf8');
    if (!equivalentContent(existing, content, verifyExisting)) throw new Error(`Immutable evidence object conflict at ${path}.`);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsyncFile(temporary);
  try {
    await link(temporary, path);
    await fsyncDirectory(directory);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(path, 'utf8');
    if (!equivalentContent(existing, content, verifyExisting)) throw new Error(`Immutable evidence object conflict at ${path}.`);
    return false;
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

function receiptIdentity(receipt: Omit<EvidenceGraphCheckpointReceipt, 'receiptHash'>): string {
  return scientificHash(receipt);
}

function pointerIdentity(pointer: Omit<EvidenceGraphLatestPointer, 'pointerHash'>): string {
  return scientificHash(pointer);
}

function unsignedReceipt(receipt: EvidenceGraphCheckpointReceipt): Omit<EvidenceGraphCheckpointReceipt, 'receiptHash'> {
  const { receiptHash: _receiptHash, ...unsigned } = receipt;
  return unsigned;
}

function verifyReceipt(receipt: EvidenceGraphCheckpointReceipt): void {
  if (receipt.schemaVersion !== 'medantir-evidence-graph-checkpoint/1') throw new Error('Unsupported evidence graph checkpoint receipt schema.');
  assertSafeRunId(receipt.runId);
  assertSequence(receipt.sequence);
  assertHash(receipt.eventHash, 'Evidence graph eventHash');
  assertHash(receipt.stateHash, 'Evidence graph stateHash');
  assertHash(receipt.graphHash, 'Evidence graph graphHash');
  if (receipt.previousGraphHash !== null) assertHash(receipt.previousGraphHash, 'Evidence graph previousGraphHash');
  validIso(receipt.recordedAt, 'Evidence graph checkpoint recordedAt');
  if (receipt.receiptHash !== receiptIdentity(unsignedReceipt(receipt))) {
    throw new Error(`Evidence graph checkpoint receipt hash mismatch at sequence ${receipt.sequence}.`);
  }
}

function verifyPointer(pointer: EvidenceGraphLatestPointer): void {
  if (pointer.schemaVersion !== 'medantir-evidence-graph-latest/1') throw new Error('Unsupported evidence graph latest pointer schema.');
  assertSafeRunId(pointer.runId);
  assertSequence(pointer.sequence);
  assertHash(pointer.graphHash, 'Evidence graph latest graphHash');
  assertHash(pointer.receiptHash, 'Evidence graph latest receiptHash');
  validIso(pointer.updatedAt, 'Evidence graph latest updatedAt');
  const { pointerHash: _pointerHash, ...unsigned } = pointer;
  if (pointer.pointerHash !== pointerIdentity(unsigned)) throw new Error('Evidence graph latest pointer hash mismatch.');
}

export class FileEvidenceGraphRepository implements EvidenceObjectRepositoryPort {
  private readonly rootDir: string;

  constructor(options: FileEvidenceGraphRepositoryOptions) {
    this.rootDir = resolve(options.rootDir);
  }

  private objectPath(objectId: string): string {
    assertObjectId(objectId);
    return join(this.rootDir, 'evidence-os', 'objects', `${objectId}.json`);
  }

  private runDir(runId: string): string {
    assertSafeRunId(runId);
    return join(this.rootDir, 'runs', runId, 'evidence-os');
  }

  private graphPath(runId: string, graphHash: string): string {
    assertHash(graphHash, 'Evidence graph hash');
    return join(this.runDir(runId), 'graphs', `${graphHash}.json`);
  }

  private receiptPath(runId: string, sequence: number): string {
    return join(this.runDir(runId), 'checkpoints', `${sequenceName(sequence)}.json`);
  }

  private latestPath(runId: string): string {
    return join(this.runDir(runId), 'latest.json');
  }

  async putObject(object: EvidenceObject): Promise<{ stored: boolean; objectId: string }> {
    verifyEvidenceObject(object);
    const stored = await immutableWrite(
      this.objectPath(object.objectId),
      `${JSON.stringify(object)}\n`,
      (existing) => {
        const prior = JSON.parse(existing) as EvidenceObject;
        verifyEvidenceObject(prior);
        return prior.objectId === object.objectId && prior.contentHash === object.contentHash;
      },
    );
    return { stored, objectId: object.objectId };
  }

  async getObject(objectId: string): Promise<EvidenceObject | null> {
    try {
      const object = JSON.parse(await readFile(this.objectPath(objectId), 'utf8')) as EvidenceObject;
      verifyEvidenceObject(object);
      if (object.objectId !== objectId) throw new Error(`Evidence object file identity mismatch for ${objectId}.`);
      return object;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async putGraph(runId: string, graph: EvidenceGraphSnapshot): Promise<{ stored: boolean; graphHash: string }> {
    assertSafeRunId(runId);
    verifyEvidenceGraphSnapshot(graph);
    if (typeof graph.metadata.runId === 'string' && graph.metadata.runId !== runId) {
      throw new Error(`Evidence graph ${graph.graphHash} belongs to a different run.`);
    }
    for (const object of graph.objects) await this.putObject(object);
    const stored = await immutableWrite(
      this.graphPath(runId, graph.graphHash),
      `${JSON.stringify(graph)}\n`,
      (existing) => {
        const prior = JSON.parse(existing) as EvidenceGraphSnapshot;
        verifyEvidenceGraphSnapshot(prior);
        return prior.graphHash === graph.graphHash;
      },
    );
    return { stored, graphHash: graph.graphHash };
  }

  async getGraph(runId: string, graphHash?: string): Promise<EvidenceGraphSnapshot | null> {
    assertSafeRunId(runId);
    const selectedHash = graphHash ?? (await this.latestReceipt(runId))?.graphHash;
    if (!selectedHash) return null;
    try {
      const graph = JSON.parse(await readFile(this.graphPath(runId, selectedHash), 'utf8')) as EvidenceGraphSnapshot;
      verifyEvidenceGraphSnapshot(graph);
      if (graph.graphHash !== selectedHash) throw new Error(`Evidence graph file identity mismatch for ${selectedHash}.`);
      if (typeof graph.metadata.runId === 'string' && graph.metadata.runId !== runId) throw new Error(`Evidence graph ${selectedHash} belongs to another run.`);
      return graph;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getCheckpointReceipt(runId: string, sequence: number): Promise<EvidenceGraphCheckpointReceipt | null> {
    try {
      const receipt = JSON.parse(await readFile(this.receiptPath(runId, sequence), 'utf8')) as EvidenceGraphCheckpointReceipt;
      verifyReceipt(receipt);
      if (receipt.runId !== runId || receipt.sequence !== sequence) throw new Error(`Evidence graph checkpoint receipt identity mismatch at sequence ${sequence}.`);
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async listCheckpointReceipts(runId: string): Promise<EvidenceGraphCheckpointReceipt[]> {
    let names: string[];
    try {
      names = (await readdir(join(this.runDir(runId), 'checkpoints')))
        .filter((name) => /^\d{12}\.json$/.test(name))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const receipts: EvidenceGraphCheckpointReceipt[] = [];
    let previousGraphHash: string | null = null;
    for (const name of names) {
      const sequence = Number(name.slice(0, 12));
      const receipt = await this.getCheckpointReceipt(runId, sequence);
      if (!receipt) throw new Error(`Evidence graph checkpoint ${sequence} disappeared during verification.`);
      if (receipt.sequence !== receipts.length + 1) throw new Error(`Evidence graph checkpoint sequence gap for ${runId}.`);
      if (receipt.previousGraphHash !== previousGraphHash) throw new Error(`Evidence graph checkpoint chain mismatch at sequence ${receipt.sequence}.`);
      previousGraphHash = receipt.graphHash;
      receipts.push(receipt);
    }
    return receipts;
  }

  async latestReceipt(runId: string): Promise<EvidenceGraphCheckpointReceipt | null> {
    try {
      const pointer = JSON.parse(await readFile(this.latestPath(runId), 'utf8')) as EvidenceGraphLatestPointer;
      verifyPointer(pointer);
      if (pointer.runId !== runId) throw new Error('Evidence graph latest pointer belongs to another run.');
      const receipt = await this.getCheckpointReceipt(runId, pointer.sequence);
      if (!receipt || receipt.receiptHash !== pointer.receiptHash || receipt.graphHash !== pointer.graphHash) {
        throw new Error('Evidence graph latest pointer does not reconcile to its checkpoint receipt.');
      }
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // The immutable checkpoint ledger below remains authoritative if the convenience pointer is damaged.
      }
    }
    const receipts = await this.listCheckpointReceipts(runId);
    return receipts.at(-1) ?? null;
  }

  async recordCheckpoint(input: {
    runId: string;
    sequence: number;
    stage: StageName;
    event: string;
    attempt: number;
    recordedAt: string;
    eventHash: string;
    stateHash: string;
    graph: EvidenceGraphSnapshot;
  }): Promise<EvidenceGraphCheckpointReceipt> {
    assertSafeRunId(input.runId);
    assertSequence(input.sequence);
    assertHash(input.eventHash, 'Evidence graph checkpoint eventHash');
    assertHash(input.stateHash, 'Evidence graph checkpoint stateHash');
    validIso(input.recordedAt, 'Evidence graph checkpoint recordedAt');
    await this.putGraph(input.runId, input.graph);

    const receipts = await this.listCheckpointReceipts(input.runId);
    const previous = receipts.at(-1);
    const existing = receipts.find((receipt) => receipt.sequence === input.sequence);
    if (existing) {
      const proposed: Omit<EvidenceGraphCheckpointReceipt, 'receiptHash'> = {
        ...unsignedReceipt(existing),
        stage: input.stage,
        event: input.event,
        attempt: input.attempt,
        recordedAt: input.recordedAt,
        eventHash: input.eventHash,
        stateHash: input.stateHash,
        graphHash: input.graph.graphHash,
      };
      if (receiptIdentity(proposed) !== existing.receiptHash) throw new Error(`Conflicting evidence graph checkpoint at sequence ${input.sequence}.`);
      if (previous?.sequence === existing.sequence) await this.writeLatest(existing);
      return existing;
    }
    if (input.sequence !== (previous?.sequence ?? 0) + 1) throw new Error(`Evidence graph checkpoint sequence gap at ${input.sequence}.`);

    const unsigned: Omit<EvidenceGraphCheckpointReceipt, 'receiptHash'> = {
      schemaVersion: 'medantir-evidence-graph-checkpoint/1',
      runId: input.runId,
      sequence: input.sequence,
      stage: input.stage,
      event: input.event,
      attempt: input.attempt,
      recordedAt: input.recordedAt,
      eventHash: input.eventHash,
      stateHash: input.stateHash,
      graphHash: input.graph.graphHash,
      previousGraphHash: previous?.graphHash ?? null,
    };
    const receipt: EvidenceGraphCheckpointReceipt = { ...unsigned, receiptHash: receiptIdentity(unsigned) };
    verifyReceipt(receipt);
    await immutableWrite(this.receiptPath(input.runId, input.sequence), `${JSON.stringify(receipt)}\n`);
    await this.writeLatest(receipt);
    return receipt;
  }

  private async writeLatest(receipt: EvidenceGraphCheckpointReceipt): Promise<void> {
    const unsigned: Omit<EvidenceGraphLatestPointer, 'pointerHash'> = {
      schemaVersion: 'medantir-evidence-graph-latest/1',
      runId: receipt.runId,
      sequence: receipt.sequence,
      graphHash: receipt.graphHash,
      receiptHash: receipt.receiptHash,
      updatedAt: receipt.recordedAt,
    };
    const pointer: EvidenceGraphLatestPointer = { ...unsigned, pointerHash: pointerIdentity(unsigned) };
    await atomicReplace(this.latestPath(receipt.runId), `${JSON.stringify(pointer)}\n`);
  }

  async deleteLatestPointerForRecoveryTest(runId: string): Promise<void> {
    await rm(this.latestPath(runId), { force: true });
  }
}
