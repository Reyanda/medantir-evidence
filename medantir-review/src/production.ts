import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { type ApiServerOptions, type IdentityProvider, type RequestIdentity } from './server.js';
import { startEvidenceOsServer } from './evidence-os-server.js';
import { OrcidOAuthSessionManager } from './registration/orcid-session.js';
import { EncryptedFileCredentialVault } from './security/encrypted-file-credential-vault.js';

interface ProductionConfiguration {
  dataRoot: string;
  runsFile: string;
  durabilityRoot: string;
  credentialRoot: string;
  port: number;
  userPoolId: string;
  clientId: string;
  corsOrigin: string;
  orcid?: { clientId: string; clientSecret: string; redirectUri: string; sandbox: boolean };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in production.`);
  return value;
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8788);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  return port;
}

function productionConfiguration(): ProductionConfiguration {
  if (process.env.REVIEW_LIVE !== '1') throw new Error('Production entrypoint requires REVIEW_LIVE=1.');
  const corsOrigin = required('CORS_ORIGINS');
  if (corsOrigin === '*' || corsOrigin.includes(',')) {
    throw new Error('CORS_ORIGINS must be one explicit trusted origin; wildcard and comma-separated values are rejected.');
  }
  const parsedOrigin = new URL(corsOrigin);
  if (!['https:', 'http:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== corsOrigin) {
    throw new Error('CORS_ORIGINS must be one HTTP(S) origin without a path, query, fragment, or trailing slash.');
  }

  const dataRoot = resolve(process.env.REVIEW_DATA_ROOT ?? '/data');
  const orcidValues = [process.env.ORCID_CLIENT_ID, process.env.ORCID_CLIENT_SECRET, process.env.ORCID_REDIRECT_URI]
    .map((value) => value?.trim() || '');
  if (orcidValues.some(Boolean) && !orcidValues.every(Boolean)) {
    throw new Error('ORCID_CLIENT_ID, ORCID_CLIENT_SECRET, and ORCID_REDIRECT_URI must be configured together.');
  }

  return {
    dataRoot,
    runsFile: resolve(process.env.RUNS_FILE ?? join(dataRoot, 'control', 'runs.json')),
    durabilityRoot: resolve(process.env.REVIEW_DURABILITY_ROOT ?? join(dataRoot, 'durability')),
    credentialRoot: resolve(process.env.REVIEW_CREDENTIAL_ROOT ?? join(dataRoot, 'credentials')),
    port: parsePort(process.env.PORT),
    userPoolId: required('COGNITO_USER_POOL_ID'),
    clientId: required('COGNITO_CLIENT_ID'),
    corsOrigin,
    ...(orcidValues.every(Boolean)
      ? {
          orcid: {
            clientId: orcidValues[0]!,
            clientSecret: orcidValues[1]!,
            redirectUri: orcidValues[2]!,
            sandbox: process.env.ORCID_SANDBOX === '1',
          },
        }
      : {}),
  };
}

async function atomicPrivateWrite(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const handle = await open(temporary, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function credentialMasterKey(dataRoot: string): Promise<Buffer> {
  const configured = process.env.REVIEW_CREDENTIAL_MASTER_KEY?.trim();
  if (configured) {
    const decoded = /^[0-9a-f]{64}$/i.test(configured)
      ? Buffer.from(configured, 'hex')
      : Buffer.from(configured, 'base64');
    if (decoded.length !== 32) throw new Error('REVIEW_CREDENTIAL_MASTER_KEY must decode to exactly 32 bytes.');
    return decoded;
  }

  const keyPath = resolve(process.env.REVIEW_CREDENTIAL_KEY_FILE ?? join(dataRoot, 'secrets', 'credential-master.key'));
  try {
    const stored = (await readFile(keyPath, 'utf8')).trim();
    const decoded = Buffer.from(stored, 'base64');
    if (decoded.length !== 32) throw new Error(`Credential key file ${keyPath} is malformed.`);
    await chmod(keyPath, 0o600);
    return decoded;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (process.env.REVIEW_ALLOW_BOOTSTRAP_KEY !== '1') {
    throw new Error('No credential master key is configured. Set REVIEW_CREDENTIAL_MASTER_KEY or provision REVIEW_CREDENTIAL_KEY_FILE.');
  }
  const generated = randomBytes(32);
  await atomicPrivateWrite(keyPath, `${generated.toString('base64')}\n`);
  return generated;
}

function identityProvider(config: ProductionConfiguration): IdentityProvider {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'access',
    clientId: config.clientId,
  });
  return {
    async authenticate(req: IncomingMessage): Promise<RequestIdentity> {
      const authorization = req.headers.authorization ?? '';
      const projectId = String(req.headers['x-actiora-project'] ?? '').trim();
      if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Bearer token required'), { status: 401 });
      if (!/^[A-Za-z0-9._:-]{1,160}$/.test(projectId)) throw Object.assign(new Error('Valid X-Actiora-Project required'), { status: 400 });
      try {
        const token = authorization.slice(7);
        const claims = await verifier.verify(token);
        return { sub: claims.sub, projectId, token };
      } catch {
        throw Object.assign(new Error('Invalid or expired access token'), { status: 401 });
      }
    },
  };
}

async function assertWritable(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
}

export async function startProductionServer(): Promise<{ port: number; close(): Promise<void> }> {
  const config = productionConfiguration();
  await Promise.all([
    assertWritable(config.dataRoot),
    assertWritable(dirname(config.runsFile)),
    assertWritable(config.durabilityRoot),
    assertWritable(config.credentialRoot),
  ]);
  const vault = new EncryptedFileCredentialVault({
    rootDir: config.credentialRoot,
    masterKey: await credentialMasterKey(config.dataRoot),
  });
  const options: ApiServerOptions = {
    identityProvider: identityProvider(config),
    runsFile: config.runsFile,
    durabilityRoot: config.durabilityRoot,
    credentialVault: vault,
    ...(config.orcid
      ? {
          orcidSessionManager: new OrcidOAuthSessionManager({
            config: config.orcid,
            credentialStore: vault,
          }),
        }
      : {}),
  };
  return startEvidenceOsServer(config.port, options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const running = await startProductionServer();
  console.log(JSON.stringify({
    event: 'review-service-started',
    port: running.port,
    mode: 'live',
    persistence: 'enabled',
    credentialStorage: 'aes-256-gcm',
    evidenceOs: 'enabled',
  }));

  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ event: 'review-service-stopping', signal }));
    await running.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void close('SIGTERM'); });
  process.once('SIGINT', () => { void close('SIGINT'); });
  process.on('unhandledRejection', (error) => {
    console.error(JSON.stringify({ event: 'unhandled-rejection', error: error instanceof Error ? error.message : String(error) }));
  });
  process.on('uncaughtException', (error) => {
    console.error(JSON.stringify({ event: 'uncaught-exception', error: error.message }));
    void close('uncaughtException');
  });
}
