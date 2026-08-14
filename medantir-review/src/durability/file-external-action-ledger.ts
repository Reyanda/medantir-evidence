import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  ExternalActionLedgerPort,
  ExternalActionRecord,
} from './external-action-coordinator.js';

export interface FileExternalActionLedgerOptions {
  rootDir: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
}

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (typeof value === 'bigint') return JSON.stringify(`${value.toString()}n`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
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
    if (process.platform === 'win32' && ['EACCES', 'EPERM', 'EINVAL'].includes(code ?? '')) return;
    throw error;
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function acquireLock(lockDir: string, timeoutMs: number, retryMs: number, staleMs: number): Promise<() => Promise<void>> {
  // mkdir without recursive creation cannot create an action lock when the
  // shared .locks namespace does not yet exist. Initialising only the parent
  // preserves the atomic EEXIST semantics of the action-specific lock itself.
  await mkdir(dirname(lockDir), { recursive: true, mode: 0o700 });
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { mode: 0o700 });
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), { mode: 0o600 });
      return async () => { await rm(lockDir, { recursive: true, force: true }); };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const info = await stat(lockDir);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out acquiring external-action lock ${lockDir}`);
      await sleep(retryMs);
    }
  }
}

type StoredExternalActionRecord = ExternalActionRecord & { recordHash: string };

function validateActionId(actionId: string): void {
  if (!/^ext-[a-f0-9]{40}$/.test(actionId)) throw new Error(`Invalid external action id ${actionId}`);
}

export class FileExternalActionLedger implements ExternalActionLedgerPort {
  private readonly rootDir: string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs: number;

  constructor(options: FileExternalActionLedgerOptions) {
    this.rootDir = resolve(options.rootDir);
    this.lockTimeoutMs = Math.max(100, options.lockTimeoutMs ?? 10_000);
    this.lockRetryMs = Math.max(5, options.lockRetryMs ?? 25);
    this.staleLockMs = Math.max(this.lockTimeoutMs, options.staleLockMs ?? 60_000);
  }

  private path(actionId: string): string {
    validateActionId(actionId);
    return join(this.rootDir, 'external-actions', `${actionId}.json`);
  }

  private lockDir(actionId: string): string {
    validateActionId(actionId);
    return join(this.rootDir, 'external-actions', '.locks', actionId);
  }

  private async read<T = unknown>(actionId: string): Promise<ExternalActionRecord<T> | null> {
    try {
      const stored = JSON.parse(await readFile(this.path(actionId), 'utf8')) as StoredExternalActionRecord;
      const { recordHash, ...record } = stored;
      if (recordHash !== digest(record)) throw new Error(`External action record hash mismatch for ${actionId}`);
      if (record.actionId !== actionId) throw new Error(`External action record id mismatch for ${actionId}`);
      if (record.responseHash !== undefined && record.responseHash !== digest(record.response)) {
        throw new Error(`External action response hash mismatch for ${actionId}`);
      }
      return structuredClone(record as ExternalActionRecord<T>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async get<T = unknown>(actionId: string): Promise<ExternalActionRecord<T> | null> {
    return this.read<T>(actionId);
  }

  private async write(record: ExternalActionRecord): Promise<ExternalActionRecord> {
    const stored: StoredExternalActionRecord = {
      ...structuredClone(record),
      recordHash: digest(record),
    };
    await atomicWrite(this.path(record.actionId), `${JSON.stringify(stored)}\n`);
    return structuredClone(record);
  }

  async prepare(record: ExternalActionRecord): Promise<ExternalActionRecord> {
    const release = await acquireLock(this.lockDir(record.actionId), this.lockTimeoutMs, this.lockRetryMs, this.staleLockMs);
    try {
      const existing = await this.read(record.actionId);
      if (existing) {
        const identity = (value: ExternalActionRecord) => digest({
          actionId: value.actionId,
          runId: value.runId,
          stage: value.stage,
          kind: value.kind,
          operationKey: value.operationKey,
          requestHash: value.requestHash,
          replayPolicy: value.replayPolicy,
        });
        if (identity(existing) !== identity(record)) throw new Error(`External action identity conflict for ${record.actionId}`);
        return existing;
      }
      return this.write(record);
    } finally {
      await release();
    }
  }

  private async transition<T>(
    actionId: string,
    update: (record: ExternalActionRecord) => ExternalActionRecord<T>,
  ): Promise<ExternalActionRecord<T>> {
    const release = await acquireLock(this.lockDir(actionId), this.lockTimeoutMs, this.lockRetryMs, this.staleLockMs);
    try {
      const existing = await this.read(actionId);
      if (!existing) throw new Error(`External action ${actionId} was not prepared`);
      const next = update(existing);
      await this.write(next);
      return structuredClone(next);
    } finally {
      await release();
    }
  }

  async succeed<T>(actionId: string, response: T, updatedAt: string): Promise<ExternalActionRecord<T>> {
    return this.transition<T>(actionId, (record) => {
      const { error: _error, ...withoutError } = record;
      return {
        ...withoutError,
        status: 'succeeded',
        response: structuredClone(response),
        responseHash: digest(response),
        updatedAt,
      };
    });
  }

  async fail(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    return this.transition(actionId, (record) => ({
      ...record,
      status: 'failed',
      error,
      updatedAt,
    }));
  }

  async markUncertain(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord> {
    return this.transition(actionId, (record) => ({
      ...record,
      status: 'uncertain',
      error,
      updatedAt,
    }));
  }
}
