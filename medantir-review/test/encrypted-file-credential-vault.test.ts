import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EncryptedFileCredentialVault } from '../src/security/encrypted-file-credential-vault.js';

test('encrypted file vault persists secrets without writing plaintext or references', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'medantir-vault-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  const vault = new EncryptedFileCredentialVault({ rootDir: root, masterKey: key });
  const reference = 'orcid:account-123';
  const secret = 'very-sensitive-oauth-token';

  assert.equal(await vault.get(reference), null);
  await vault.put(reference, secret);
  assert.equal(await vault.get(reference), secret);

  const files = await readdir(root);
  assert.equal(files.length, 1);
  assert.doesNotMatch(files[0] ?? '', /orcid|account/i);
  const stored = await readFile(join(root, files[0]!), 'utf8');
  assert.equal(stored.includes(secret), false);
  assert.equal(stored.includes(reference), false);

  const wrongKeyVault = new EncryptedFileCredentialVault({ rootDir: root, masterKey: randomBytes(32) });
  await assert.rejects(() => wrongKeyVault.get(reference), /authentication failed/);

  await vault.delete(reference);
  assert.equal(await vault.get(reference), null);
});

test('encrypted file vault binds a ciphertext to its exact credential reference', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'medantir-vault-aad-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vault = new EncryptedFileCredentialVault({ rootDir: root, masterKey: randomBytes(32) });
  await vault.put('github:one', 'token-one');
  assert.equal(await vault.get('github:one'), 'token-one');
  assert.equal(await vault.get('github:two'), null);
});
