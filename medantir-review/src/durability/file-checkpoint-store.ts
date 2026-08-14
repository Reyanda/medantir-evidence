import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { PipelineCheckpointPort } from '../core/ports.js';
import type { PipelineState, StageName } from '../core/types.js';

export interface DurableCheckpointEvent {
  version: 1;
  runId: string;
  sequence: number;
  stage: StageName;
  event: string;
  attempt: number;
  recordedAt: string;
  previousEventHash: string | null;
  stateHash: string;
  state: PipelineState;
  eventHash: string;
}

export interface DurableCheckpointSnapshot {
  version: 1;
  runId: string;
  sequence: number;
  stateHash: string;
  latestEventHash: string;
  recordedAt: string;
  state: PipelineState;
  snapshotHash: string;
}

export interface FileCheckpointStoreOptions {
  rootDir: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
}

function canonicalize(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/**
 * Checkpoint hashes must describe the representation that is actually written.
 * JSON omits undefined object fields, converts undefined array members and
 * non-finite numbers to null, and cannot encode bigint. Normalising first avoids
 * a journal that verifies in memory but fails immediately after deserialisation.
 */
function persistedClone<T>(value: T): T {
  const serialized = JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? `${item.toString()}n` : item);
  if (serialized === undefined) throw new Error('Checkpoint state is not JSON-serialisable.');
  return JSON.parse(serialized) as T;
}

function eventIdentity(event: Omit<DurableCheckpointEvent, 'eventHash'>): string { return hash(event); }
function snapshotIdentity(snapshot: Omit<DurableCheckpointSnapshot, 'snapshotHash'>): string { return hash(snapshot); }

function assertSafeRunId(runId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(runId)) throw new Error(`Unsafe run id: ${runId}`);
}

function sequenceName(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error(`Invalid checkpoint sequence ${sequence}`);
  return String(sequence).padStart(12, '0');
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

async function atomicWrite(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fsyncFile(temporary);
  await rename(temporary, path);
  await fsyncDirectory(directory);
}

async function sleep(ms: number): Promise<void> { await new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }

async function acquireLock(lockDir: string, input: { timeoutMs: number; retryMs: number; staleMs: number }): Promise<() => Promise<void>> {
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), { mode: 0o600 });
      return async () => { await rm(lockDir, { recursive: true, force: true }); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const lockStat = await stat(lockDir);
        if (Date.now() - lockStat.mtimeMs > input.staleMs) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= input.timeoutMs) throw new Error(`Timed out acquiring checkpoint lock ${lockDir}`);
      await sleep(input.retryMs);
    }
  }
}

export class FileCheckpointStore implements PipelineCheckpointPort {
  private readonly rootDir: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs: number;

  constructor(options: FileCheckpointStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.lockTimeoutMs = Math.max(100, options.lockTimeoutMs ?? 10_000);
    this.lockRetryMs = Math.max(5, options.lockRetryMs ?? 25);
    this.staleLockMs = Math.max(this.lockTimeoutMs, options.staleLockMs ?? 60_000);
  }

  private runDir(runId: string): string { assertSafeRunId(runId); return join(this.rootDir, 'runs', runId); }
  private journalDir(runId: string): string { return join(this.runDir(runId), 'journal'); }
  private snapshotPath(runId: string): string { return join(this.runDir(runId), 'snapshot.json'); }
  private eventPath(runId: string, sequence: number): string { return join(this.journalDir(runId), `${sequenceName(sequence)}.json`); }

  private async readEvent(path: string): Promise<DurableCheckpointEvent> {
    const event = JSON.parse(await readFile(path, 'utf8')) as DurableCheckpointEvent;
    const { eventHash, ...unsigned } = event;
    if (event.version !== 1 || eventHash !== eventIdentity(unsigned)) throw new Error(`Checkpoint event hash mismatch: ${path}`);
    if (event.stateHash !== hash(event.state)) throw new Error(`Checkpoint event state hash mismatch: ${path}`);
    return event;
  }

  private async readSnapshot(runId: string): Promise<DurableCheckpointSnapshot | null> {
    try {
      const snapshot = JSON.parse(await readFile(this.snapshotPath(runId), 'utf8')) as DurableCheckpointSnapshot;
      const { snapshotHash, ...unsigned } = snapshot;
      if (snapshot.version !== 1 || snapshotHash !== snapshotIdentity(unsigned)) throw new Error('Checkpoint snapshot hash mismatch');
      if (snapshot.runId !== runId || snapshot.stateHash !== hash(snapshot.state)) throw new Error('Checkpoint snapshot state mismatch');
      return snapshot;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async listEvents(runId: string): Promise<DurableCheckpointEvent[]> {
    let files: string[];
    try { files = (await readdir(this.journalDir(runId))).filter((name) => /^\d{12}\.json$/.test(name)).sort(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const events: DurableCheckpointEvent[] = [];
    let previous: string | null = null;
    for (const name of files) {
      const event = await this.readEvent(join(this.journalDir(runId), name));
      if (event.sequence !== events.length + 1) throw new Error(`Checkpoint journal sequence gap for ${runId}`);
      if (event.previousEventHash !== previous) throw new Error(`Checkpoint journal hash-chain mismatch at sequence ${event.sequence}`);
      previous = event.eventHash;
      events.push(event);
    }
    return events;
  }

  async recover(runId: string): Promise<PipelineState | null> {
    const events = await this.listEvents(runId);
    if (!events.length) return null;
    const latest = events.at(-1)!;
    try {
      const snapshot = await this.readSnapshot(runId);
      if (snapshot && snapshot.sequence === latest.sequence && snapshot.latestEventHash === latest.eventHash && snapshot.stateHash === latest.stateHash) return structuredClone(snapshot.state);
    } catch {
      // The append-only journal remains authoritative when the convenience snapshot is damaged.
    }
    return structuredClone(latest.state);
  }

  async checkpoint(input: { state: PipelineState; stage: StageName; event: string; attempt: number; recordedAt: string }): Promise<void> {
    assertSafeRunId(input.state.runId);
    const runDir = this.runDir(input.state.runId);
    await mkdir(this.journalDir(input.state.runId), { recursive: true, mode: 0o700 });
    const release = await acquireLock(join(runDir, '.lock'), { timeoutMs: this.lockTimeoutMs, retryMs: this.lockRetryMs, staleMs: this.staleLockMs });
    try {
      const events = await this.listEvents(input.state.runId);
      const latest = events.at(-1);
      const state = persistedClone(input.state);
      const stateHash = hash(state);
      const identity = { runId: state.runId, stage: input.stage, event: input.event, attempt: input.attempt, stateHash };
      if (latest && hash(identity) === hash({ runId: latest.runId, stage: latest.stage, event: latest.event, attempt: latest.attempt, stateHash: latest.stateHash })) return;

      const sequence = (latest?.sequence ?? 0) + 1;
      const unsignedEvent: Omit<DurableCheckpointEvent, 'eventHash'> = {
        version: 1,
        runId: state.runId,
        sequence,
        stage: input.stage,
        event: input.event,
        attempt: input.attempt,
        recordedAt: input.recordedAt,
        previousEventHash: latest?.eventHash ?? null,
        stateHash,
        state,
      };
      const event: DurableCheckpointEvent = { ...unsignedEvent, eventHash: eventIdentity(unsignedEvent) };
      await atomicWrite(this.eventPath(state.runId, sequence), `${JSON.stringify(event)}\n`);

      const unsignedSnapshot: Omit<DurableCheckpointSnapshot, 'snapshotHash'> = {
        version: 1, runId: state.runId, sequence, stateHash, latestEventHash: event.eventHash, recordedAt: input.recordedAt, state,
      };
      await atomicWrite(this.snapshotPath(state.runId), `${JSON.stringify({ ...unsignedSnapshot, snapshotHash: snapshotIdentity(unsignedSnapshot) })}\n`);
    } finally {
      await release();
    }
  }

  async deleteSnapshotForRecoveryTest(runId: string): Promise<void> {
    try { await unlink(this.snapshotPath(runId)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
