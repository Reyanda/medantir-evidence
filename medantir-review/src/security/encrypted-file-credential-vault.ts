import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { CredentialStorePort } from '../core/ports.js';

interface EncryptedCredentialEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  referenceHash: string;
  iv: string;
  authenticationTag: string;
  ciphertext: string;
  writtenAt: string;
}

export interface EncryptedFileCredentialVaultOptions {
  rootDir: string;
  masterKey: Buffer | string;
}

function decodeKey(value: Buffer | string): Buffer {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) throw new Error('Credential master key must be exactly 32 bytes.');
    return Buffer.from(value);
  }
  const trimmed = value.trim();
  const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) throw new Error('Credential master key must decode to exactly 32 bytes.');
  return decoded;
}

function referenceHash(reference: string): string {
  const cleaned = reference.trim();
  if (!cleaned || cleaned.length > 512) throw new Error('Credential reference must be between 1 and 512 characters.');
  return createHash('sha256').update(cleaned, 'utf8').digest('hex');
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

/**
 * Persistent credential vault for a single MEDANTIR review-service deployment.
 *
 * Secrets are encrypted with AES-256-GCM, authenticated against the opaque
 * credential reference, and written atomically with private permissions. File
 * names are one-way hashes, so references and secret values are not disclosed by
 * directory listings. The master key must live outside the vault directory or in
 * a separately protected bootstrap file under the persistent data volume.
 */
export class EncryptedFileCredentialVault implements CredentialStorePort {
  private readonly rootDir: string;
  private readonly key: Buffer;

  constructor(options: EncryptedFileCredentialVaultOptions) {
    this.rootDir = resolve(options.rootDir);
    this.key = decodeKey(options.masterKey);
  }

  private path(reference: string): string {
    return join(this.rootDir, `${referenceHash(reference)}.json`);
  }

  async put(reference: string, value: string): Promise<void> {
    if (typeof value !== 'string' || value.length === 0) throw new Error('Credential value must be a non-empty string.');
    const cleanedReference = reference.trim();
    const digest = referenceHash(cleanedReference);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(cleanedReference, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const envelope: EncryptedCredentialEnvelope = {
      version: 1,
      algorithm: 'aes-256-gcm',
      referenceHash: digest,
      iv: iv.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      writtenAt: new Date().toISOString(),
    };
    await atomicWrite(this.path(cleanedReference), `${JSON.stringify(envelope)}\n`);
  }

  async get(reference: string): Promise<string | null> {
    const cleanedReference = reference.trim();
    const expectedDigest = referenceHash(cleanedReference);
    let raw: string;
    try {
      raw = await readFile(this.path(cleanedReference), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    let envelope: EncryptedCredentialEnvelope;
    try {
      envelope = JSON.parse(raw) as EncryptedCredentialEnvelope;
    } catch {
      throw new Error('Credential envelope is not valid JSON.');
    }
    if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
      throw new Error('Credential envelope version or algorithm is unsupported.');
    }
    const actualDigest = Buffer.from(String(envelope.referenceHash), 'hex');
    const expectedDigestBuffer = Buffer.from(expectedDigest, 'hex');
    if (actualDigest.length !== expectedDigestBuffer.length || !timingSafeEqual(actualDigest, expectedDigestBuffer)) {
      throw new Error('Credential envelope reference binding is invalid.');
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(cleanedReference, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Credential envelope authentication failed.');
    }
  }

  async delete(reference: string): Promise<void> {
    await rm(this.path(reference.trim()), { force: true });
  }
}
