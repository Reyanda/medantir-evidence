import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startEvidenceOsServer } from '../medantir-review/dist/src/evidence-os-server.js';
import { fixtureRequest } from '../medantir-review/dist/src/fixtures.js';
import { DeterministicScientificEmbeddingPort } from '../medantir-review/dist/src/semantic/embedding.js';
import { FileSemanticIndexRepository } from '../medantir-review/dist/src/semantic/repository.js';
import { SemanticIndexService } from '../medantir-review/dist/src/semantic/service.js';

const PORT = Number(process.env.E2E_REVIEW_PORT || 8790);
const PROJECT_ID = 'e2e-project';
const OWNER_ID = 'e2e-owner';
const stateRoot = resolve(process.env.E2E_STATE_ROOT || join(process.cwd(), 'e2e', '.semantic-state'));
const readyFile = resolve(process.env.E2E_READY_FILE || join(process.cwd(), 'e2e', '.semantic-run.json'));
const runsFile = join(stateRoot, 'control', 'runs.json');
const durabilityRoot = join(stateRoot, 'durability');
const semanticRoot = join(stateRoot, 'semantic');

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const headers = (json = false) => ({
  'x-test-user': OWNER_ID,
  'x-actiora-project': PROJECT_ID,
  ...(json ? { 'content-type': 'application/json' } : {}),
});

async function responseJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1200)}`);
  }
  return payload;
}

async function pollForVerification(base, runId) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const state = await responseJson(await fetch(`${base}/runs/${encodeURIComponent(runId)}`, { headers: headers() }));
    const failed = Object.entries(state.stages || {}).find(([, stage]) => stage?.status === 'failed');
    if (failed) throw new Error(`Review failed at ${failed[0]}: ${(failed[1].errors || []).join('; ')}`);
    if (state.stages?.['human-verify']?.status === 'awaiting-human') return state;
    await delay(100);
  }
  throw new Error('Review did not reach independent verification within 60 seconds.');
}

async function bootstrap() {
  delete process.env.REVIEW_LIVE;
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS || 'http://127.0.0.1:4173';
  await rm(stateRoot, { recursive: true, force: true });
  await rm(readyFile, { force: true });
  await mkdir(join(stateRoot, 'control'), { recursive: true, mode: 0o700 });

  const server = await startEvidenceOsServer(PORT, {
    runsFile,
    durabilityRoot,
    semanticIndexService: new SemanticIndexService({
      repository: new FileSemanticIndexRepository({ rootDir: semanticRoot }),
      embeddingPort: new DeterministicScientificEmbeddingPort(),
    }),
    identityProvider: {
      authenticate: async () => ({ sub: OWNER_ID, projectId: PROJECT_ID }),
    },
  });

  const base = `http://127.0.0.1:${server.port}`;
  const health = await fetch(`${base}/health`);
  if (!health.ok) throw new Error(`Fixture server health check failed with HTTP ${health.status}.`);

  const accepted = await responseJson(await fetch(`${base}/runs`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({
      ...fixtureRequest,
      humanVerification: { enabled: true, mode: 'blinded', requireAllItems: true },
    }),
  }));

  const pending = await pollForVerification(base, accepted.runId);
  const verification = await responseJson(await fetch(`${base}/runs/${encodeURIComponent(pending.runId)}/verification`, {
    headers: headers(),
  }));
  if (!Array.isArray(verification.items) || verification.items.length === 0) {
    throw new Error('Fixture review produced no independent-verification items.');
  }

  const completed = await responseJson(await fetch(`${base}/runs/${encodeURIComponent(pending.runId)}/verification`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({
      packageId: verification.id,
      mode: verification.mode,
      decisions: verification.items.map((item) => ({
        itemId: item.id,
        verdict: 'accept',
        rationale: `Browser E2E independent check completed for ${item.label}.`,
        reviewerId: 'browser-e2e-independent-reviewer',
      })),
    }),
  }));

  const unresolved = Object.entries(completed.stages || {}).filter(([, stage]) => !['passed', 'skipped'].includes(stage?.status));
  if (unresolved.length) {
    throw new Error(`Fixture review did not complete: ${unresolved.map(([name, stage]) => `${name}=${stage.status}`).join(', ')}`);
  }

  const manifest = await responseJson(await fetch(`${base}/runs/${encodeURIComponent(completed.runId)}/semantic-index/rebuild`, {
    method: 'POST',
    headers: headers(),
  }));
  if (!manifest?.indexHash || !manifest?.counts?.units) {
    throw new Error('Semantic fixture index was not created.');
  }

  const ready = {
    schemaVersion: 'medantir-browser-e2e-ready/1',
    runId: completed.runId,
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
    reviewApiBase: base,
    indexHash: manifest.indexHash,
    manifestHash: manifest.manifestHash,
    unitCount: manifest.counts.units,
    clusterCount: manifest.counts.clusters,
  };
  await writeFile(readyFile, `${JSON.stringify(ready, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(JSON.stringify({ event: 'semantic-browser-fixture-ready', ...ready }));

  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ event: 'semantic-browser-fixture-stopping', signal }));
    await server.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void close('SIGTERM'); });
  process.once('SIGINT', () => { void close('SIGINT'); });
  await new Promise(() => {});
}

bootstrap().catch((error) => {
  console.error(JSON.stringify({
    event: 'semantic-browser-fixture-failed',
    error: error instanceof Error ? error.stack || error.message : String(error),
  }));
  process.exit(1);
});
