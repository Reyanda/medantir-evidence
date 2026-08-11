import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiServer, type IdentityProvider } from '../src/server.js';
import { createPipelineState } from '../src/core/state.js';
import { createReviewProtocol } from '../src/protocols/review-protocol.js';
import { refreshScientificRunArtifacts } from '../src/core/scientific-run-manifest.js';

function verifierState() {
  const state = createPipelineState({
    reviewType: 'systematic',
    databases: ['PubMed'],
    question: {
      title: 'Verifier API review',
      objective: 'Test authenticated verifier access.',
      population: 'adults',
      interventionOrExposure: 'treatment',
      outcomes: ['mortality'],
    },
  });
  state.artifacts.quantitativeExtractionLedger = [{
    studyId: 'study-1', recordId: 'report-1', outcome: 'mortality', status: 'extracted',
    effectMeasure: 'RR', effect: 0.8, tableId: 'table-1', page: 7,
    authorization: 'Bearer must-not-leak',
  }];
  state.artifacts.estimandLedger = [{
    studyId: 'study-1', recordId: 'report-1', outcome: 'mortality', status: 'identified',
    estimand: { estimandId: 'estimand-1', source: { recordId: 'report-1', tableId: 'table-1', page: 7 } },
  }];
  state.artifacts.fullTexts = [{ recordId: 'report-1', content: 'licensed article body' }];
  state.artifacts.parsedDocuments = [{ recordId: 'report-1', text: 'parsed full article body' }];
  refreshScientificRunArtifacts(state, createReviewProtocol('systematic'));
  return state;
}

async function listen(server: ReturnType<typeof createApiServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: ReturnType<typeof createApiServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const identityProvider: IdentityProvider = {
  async authenticate(req) {
    const authorization = String(req.headers.authorization ?? '');
    const projectId = String(req.headers['x-actiora-project'] ?? '');
    if (!authorization.startsWith('Bearer ') || !projectId) throw Object.assign(new Error('Unauthorized'), { status: 401 });
    return { sub: authorization.slice(7), projectId };
  },
};

function headers(sub = 'alice', projectId = 'project-1') {
  return { authorization: `Bearer ${sub}`, 'x-actiora-project': projectId };
}

test('verifier HTTP surface is owned, read-only, allowlisted and tamper-detecting', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'medantir-verifier-'));
  const runsFile = join(directory, 'runs.json');
  const good = verifierState();
  const tampered = structuredClone(good);
  tampered.runId = `${good.runId}-tampered`;
  (tampered.artifacts.quantitativeExtractionLedger as Array<Record<string, unknown>>)[0]!.effect = 1.4;
  writeFileSync(runsFile, JSON.stringify([
    [good.runId, { ownerSub: 'alice', projectId: 'project-1', state: good }],
    [tampered.runId, { ownerSub: 'alice', projectId: 'project-1', state: tampered }],
  ]));

  const server = createApiServer({ runsFile, identityProvider });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const root = await fetch(`${base}/runs/${good.runId}/verifier`, { headers: headers() });
    assert.equal(root.status, 200);
    const view = await root.json() as { sealValid?: boolean; artifactIndex?: Array<{ key?: string; readable?: boolean }> };
    assert.equal(view.sealValid, true);
    assert.equal(view.artifactIndex?.find((entry) => entry.key === 'fullTexts')?.readable, false);
    assert.equal(view.artifactIndex?.find((entry) => entry.key === 'quantitativeExtractionLedger')?.readable, true);

    for (const control of ['manifest', 'seal', 'lineage', 'attempts']) {
      const response = await fetch(`${base}/runs/${good.runId}/verifier/${control}`, { headers: headers() });
      assert.equal(response.status, 200, `${control} should be readable by the run owner`);
    }

    const quantitative = await fetch(`${base}/runs/${good.runId}/verifier/artifacts/quantitativeExtractionLedger`, { headers: headers() });
    assert.equal(quantitative.status, 200);
    const quantitativeText = await quantitative.text();
    assert.doesNotMatch(quantitativeText, /must-not-leak/);
    assert.match(quantitativeText, /\[REDACTED\]/);

    for (const forbidden of ['fullTexts', 'parsedDocuments']) {
      const response = await fetch(`${base}/runs/${good.runId}/verifier/artifacts/${forbidden}`, { headers: headers() });
      assert.equal(response.status, 403);
    }

    const otherOwner = await fetch(`${base}/runs/${good.runId}/verifier`, { headers: headers('bob') });
    assert.equal(otherOwner.status, 404);
    const otherProject = await fetch(`${base}/runs/${good.runId}/verifier`, { headers: headers('alice', 'project-2') });
    assert.equal(otherProject.status, 404);

    const tamperResponse = await fetch(`${base}/runs/${tampered.runId}/verifier/artifacts/quantitativeExtractionLedger`, { headers: headers() });
    assert.equal(tamperResponse.status, 409);
    assert.match(await tamperResponse.text(), /no longer matches/i);

    const writeAttempt = await fetch(`${base}/runs/${good.runId}/verifier/artifacts/quantitativeExtractionLedger`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ effect: 9.9 }),
    });
    assert.equal(writeAttempt.status, 404);
    const afterWrite = await fetch(`${base}/runs/${good.runId}/verifier/artifacts/quantitativeExtractionLedger`, { headers: headers() });
    assert.equal(afterWrite.status, 200);
    assert.doesNotMatch(await afterWrite.text(), /9\.9/);
  } finally {
    await close(server);
    rmSync(directory, { recursive: true, force: true });
  }
});
