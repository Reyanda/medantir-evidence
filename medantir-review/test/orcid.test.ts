import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrcidAuthorizationUrl, exchangeOrcidCode, isValidOrcid, normaliseOrcid } from '../src/registration/orcid.js';

test('validates and normalises ORCID identifiers using the checksum', () => {
  assert.equal(isValidOrcid('0000-0002-1825-0097'), true);
  assert.equal(isValidOrcid('0000-0002-1825-0098'), false);
  assert.equal(normaliseOrcid('https://orcid.org/0000-0002-1825-0097'), '0000-0002-1825-0097');
});

test('creates an ORCID OAuth authorization URL with state and requested scopes', () => {
  const url = new URL(createOrcidAuthorizationUrl({
    clientId: 'APP-TEST',
    redirectUri: 'https://example.org/oauth/orcid/callback',
    sandbox: true,
    scopes: ['/authenticate', '/read-limited'],
  }, 'csrf-state'));
  assert.equal(url.origin, 'https://sandbox.orcid.org');
  assert.equal(url.searchParams.get('state'), 'csrf-state');
  assert.equal(url.searchParams.get('scope'), '/authenticate /read-limited');
});

test('exchanges an ORCID code without exposing request credentials in the result shape', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(JSON.stringify({
      access_token: 'secret-token',
      token_type: 'bearer',
      scope: '/authenticate',
      name: 'Geoffrey Manda',
      orcid: '0000-0002-1825-0097',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await exchangeOrcidCode({
    clientId: 'APP-TEST',
    clientSecret: 'client-secret',
    redirectUri: 'https://example.org/callback',
    sandbox: true,
  }, 'authorization-code', fetchImpl);
  assert.equal(result.orcid, '0000-0002-1825-0097');
  assert.equal(result.accessToken, 'secret-token');
  assert.equal(calls.length, 1);
  assert.match(String(calls[0]?.init?.body), /grant_type=authorization_code/);
});
