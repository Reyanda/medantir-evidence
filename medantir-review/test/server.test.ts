import test from 'node:test';
import assert from 'node:assert/strict';
import type { HumanVerificationPackage } from '../src/core/types.js';
import { startServer } from '../src/server.js';
import { fixtureRequest } from '../src/fixtures.js';

const testIdentityProvider = { authenticate: async () => ({ sub: 'test-user', projectId: 'test-project' }) };
const testRunsFile = () => `/tmp/actiora-review-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`;

test('exposes health, run, verification, and finalisation endpoints', async (t) => {
  const server = await startServer(0, { identityProvider: testIdentityProvider, runsFile: testRunsFile() });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'medantir-review-engine', version: '0.5.0' });

  const run = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...fixtureRequest,
      humanVerification: { enabled: true, mode: 'blinded' },
    }),
  });
  assert.equal(run.status, 202);
  const accepted = await run.json() as {
    runId: string;
    stages: { 'human-verify': { status: string } };
  };
  // Runs execute in the background: the POST returns immediately with all
  // stages pending; poll the run until the pipeline reaches its rest point.
  assert.equal(accepted.stages['human-verify'].status, 'pending');
  let pending: {
    runId: string;
    stages: { 'human-verify': { status: string } };
    artifacts: { finalReport?: unknown };
  } | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const poll = await fetch(`${base}/runs/${accepted.runId}`);
    assert.equal(poll.status, 200);
    const state = await poll.json() as typeof pending;
    if (state!.stages['human-verify'].status !== 'pending' && state!.stages['human-verify'].status !== 'running') {
      pending = state;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(pending, 'pipeline did not reach the human-verification gate in time');
  assert.equal(pending!.stages['human-verify'].status, 'awaiting-human');
  assert.equal(pending!.artifacts.finalReport, undefined);

  const protocolResponse = await fetch(`${base}/runs/${pending.runId}/protocol`);
  assert.equal(protocolResponse.status, 200);
  const protocol = await protocolResponse.json() as { checksum: string; files: Array<{ path: string }> };
  assert.ok(protocol.checksum.length >= 32);
  assert.ok(protocol.files.some((file) => file.path === 'protocol/PROTOCOL.md'));

  const registrationResponse = await fetch(`${base}/runs/${pending.runId}/registration`);
  assert.equal(registrationResponse.status, 200);
  const registration = await registrationResponse.json() as { ledger: { noSecretsPersisted: boolean } };
  assert.equal(registration.ledger.noSecretsPersisted, true);

  const packageResponse = await fetch(`${base}/runs/${pending.runId}/verification`);
  assert.equal(packageResponse.status, 200);
  const verificationPackage = await packageResponse.json() as HumanVerificationPackage;
  assert.equal(verificationPackage.mode, 'blinded');
  assert.ok(verificationPackage.items.length > 0);

  const finalise = await fetch(`${base}/runs/${pending.runId}/verification`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      packageId: verificationPackage.id,
      mode: verificationPackage.mode,
      decisions: verificationPackage.items.map((item) => ({
        itemId: item.id,
        verdict: 'accept',
        rationale: `Evidence checked for ${item.label}.`,
        reviewerId: 'api-reviewer',
      })),
    }),
  });
  assert.equal(finalise.status, 200);
  const completed = await finalise.json() as {
    stages: { 'human-verify': { status: string } };
    artifacts: { finalReport: unknown; verificationOutcome: { status: string } };
  };
  assert.equal(completed.stages['human-verify'].status, 'passed');
  assert.equal(completed.artifacts.verificationOutcome.status, 'accepted');
  assert.ok(completed.artifacts.finalReport);

  const invalid = await fetch(`${base}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reviewType: 'systematic' }),
  });
  assert.equal(invalid.status, 400);
});

test('exposes a secure ORCID OAuth start and callback flow without returning the access token', async (t) => {
  const { InMemoryCredentialVault } = await import('../src/adapters/registration/registry-adapters.js');
  const { OrcidOAuthSessionManager } = await import('../src/registration/orcid-session.js');
  const vault = new InMemoryCredentialVault();
  const manager = new OrcidOAuthSessionManager({
    config: {
      clientId: 'APP-TEST',
      clientSecret: 'client-secret',
      redirectUri: 'https://review.test/auth/orcid/callback',
      sandbox: true,
    },
    credentialStore: vault,
    fetchImpl: async () => new Response(JSON.stringify({
      access_token: 'oauth-secret',
      token_type: 'bearer',
      scope: '/authenticate',
      name: 'Geoffrey Manda',
      orcid: '0000-0002-1825-0097',
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const server = await startServer(0, { orcidSessionManager: manager, identityProvider: testIdentityProvider, runsFile: testRunsFile() });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`;

  const start = await fetch(`${base}/auth/orcid/start`);
  assert.equal(start.status, 200);
  const session = await start.json() as { authorizationUrl: string; state: string };
  assert.match(session.authorizationUrl, /sandbox\.orcid\.org/);

  const callback = await fetch(`${base}/auth/orcid/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'authorisation-code', state: session.state }),
  });
  assert.equal(callback.status, 200);
  const completed = await callback.json() as {
    identity: { orcid: string; authenticated: boolean };
    credentialReference: string;
  };
  assert.equal(completed.identity.orcid, '0000-0002-1825-0097');
  assert.equal(completed.identity.authenticated, true);
  assert.equal(await vault.get(completed.credentialReference), 'oauth-secret');
  assert.equal(JSON.stringify(completed).includes('oauth-secret'), false);
});
