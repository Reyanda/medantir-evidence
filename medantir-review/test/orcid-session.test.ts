import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCredentialVault } from '../src/adapters/registration/registry-adapters.js';
import { OrcidOAuthSessionManager } from '../src/registration/orcid-session.js';

function successfulTokenResponse() {
  return new Response(JSON.stringify({
    access_token: 'secret-access-token',
    token_type: 'bearer',
    scope: '/authenticate /read-public',
    name: 'Geoffrey Manda',
    orcid: '0000-0002-1825-0097',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('ORCID session manager uses single-use state and stores the token behind a credential reference', async () => {
  const vault = new InMemoryCredentialVault();
  const manager = new OrcidOAuthSessionManager({
    config: {
      clientId: 'APP-TEST',
      clientSecret: 'client-secret',
      redirectUri: 'https://review.test/auth/orcid/callback',
      sandbox: true,
      scopes: ['/authenticate'],
    },
    credentialStore: vault,
    fetchImpl: async () => successfulTokenResponse(),
    now: () => Date.parse('2026-07-13T06:00:00.000Z'),
  });

  const session = manager.start();
  assert.match(session.authorizationUrl, /^https:\/\/sandbox\.orcid\.org\/oauth\/authorize/);
  assert.ok(session.state.length >= 40);

  const completed = await manager.complete('authorization-code', session.state);
  assert.equal(completed.identity.authenticated, true);
  assert.equal(completed.identity.orcid, '0000-0002-1825-0097');
  assert.match(completed.credentialReference, /^orcid:/);
  assert.equal(await vault.get(completed.credentialReference), 'secret-access-token');
  assert.equal(JSON.stringify(completed).includes('secret-access-token'), false);

  await assert.rejects(
    () => manager.complete('authorization-code', session.state),
    /already-consumed/,
  );
});

test('ORCID session manager rejects expired state before exchanging a code', async () => {
  let now = Date.parse('2026-07-13T06:00:00.000Z');
  let fetchCalled = false;
  const manager = new OrcidOAuthSessionManager({
    config: {
      clientId: 'APP-TEST',
      clientSecret: 'client-secret',
      redirectUri: 'https://review.test/auth/orcid/callback',
      sandbox: true,
    },
    credentialStore: new InMemoryCredentialVault(),
    stateTtlSeconds: 10,
    now: () => now,
    fetchImpl: async () => {
      fetchCalled = true;
      return successfulTokenResponse();
    },
  });
  const session = manager.start();
  now += 11_000;
  await assert.rejects(() => manager.complete('code', session.state), /expired/);
  assert.equal(fetchCalled, false);
});
