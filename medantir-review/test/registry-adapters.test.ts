import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProtocolPackage, ResearcherIdentity, ReviewRequest } from '../src/core/types.js';
import {
  GitHubRegistryAdapter,
  InMemoryCredentialVault,
  OsfBrowserRegistryAdapter,
  ProsperoBrowserRegistryAdapter,
  ZenodoRegistryAdapter,
} from '../src/adapters/registration/registry-adapters.js';
import { fixtureRequest } from '../src/fixtures.js';

const identity: ResearcherIdentity = {
  displayName: 'Geoffrey Manda',
  orcid: '0000-0002-1825-0097',
  authenticated: true,
  authenticationProvider: 'orcid',
  scopes: ['/authenticate'],
};

const protocol: ProtocolPackage = {
  id: 'protocol-1',
  reviewType: 'systematic',
  title: 'Protocol: Test review',
  version: '1.0.0',
  status: 'final',
  finalisedAt: '2026-07-13T00:00:00.000Z',
  documentMarkdown: '# Protocol',
  structuredProtocol: {
    id: 'draft-1', reviewType: 'systematic', title: 'Protocol: Test review', version: '1.0.0', status: 'draft', createdAt: '2026-07-13T00:00:00.000Z',
    authors: [{ givenName: 'Geoffrey', familyName: 'Manda', orcid: '0000-0002-1825-0097' }], sections: [], citations: [], checklist: [],
  },
  searchStrategies: [],
  searchTestReport: { status: 'passed', results: [], peerReviewRequired: false, peerReviewStatus: 'not-required', completedAt: '2026-07-13T00:00:00.000Z' },
  citations: [],
  checksum: 'abc123',
  files: [{ path: 'protocol/PROTOCOL.md', mediaType: 'text/markdown', content: '# Protocol', checksum: 'filehash' }],
};

test('PROSPERO adapter requires authenticated ORCID for a browser submission', async () => {
  let submitted = false;
  const adapter = new ProsperoBrowserRegistryAdapter({
    async submit() {
      submitted = true;
      return { status: 'submitted', externalId: 'CRD420260001', message: 'Submitted' };
    },
  });
  const denied = await adapter.register({
    protocol,
    request: fixtureRequest,
    identity: { ...identity, authenticated: false },
    submissionMode: 'submit',
  });
  assert.equal(denied.status, 'awaiting-human');
  assert.equal(submitted, false);

  const accepted = await adapter.register({ protocol, request: fixtureRequest, identity, submissionMode: 'submit' });
  assert.equal(accepted.status, 'submitted');
  assert.equal(accepted.externalId, 'CRD420260001');
});

test('OSF adapter prepares or submits an immutable registration package through an authenticated route', async () => {
  const submittedInputs: Array<{ authentication?: string; target?: string }> = [];
  const adapter = new OsfBrowserRegistryAdapter({
    async submit(input) {
      submittedInputs.push({ authentication: input.authentication, target: input.target });
      return {
        status: 'submitted',
        externalId: 'osf-reg-123',
        url: 'https://osf.io/registrations/osf-reg-123',
        message: 'OSF registration submitted for contributor approval.',
      };
    },
  });
  const prepared = await adapter.register({ protocol, request: fixtureRequest, identity, submissionMode: 'prepare-only' });
  assert.equal(prepared.status, 'prepared');
  assert.equal(submittedInputs.length, 0);

  const submitted = await adapter.register({ protocol, request: fixtureRequest, identity, submissionMode: 'submit' });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.externalId, 'osf-reg-123');
  assert.equal(submitted.metadata.immutableOnApproval, true);
  assert.equal(submittedInputs[0]?.authentication, 'osf-oauth');
  assert.equal(submittedInputs[0]?.target, 'osf');
});

test('Zenodo adapter creates a draft, uploads files, sets metadata, and does not persist the token', async () => {
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    calls.push({ url, method, ...(headers.get('authorization') ? { authorization: headers.get('authorization')! } : {}) });
    if (url.endsWith('/deposit/depositions') && method === 'POST') {
      return new Response(JSON.stringify({ id: 42, links: { bucket: 'https://zenodo.test/bucket' } }), { status: 201 });
    }
    if (url.startsWith('https://zenodo.test/bucket/') && method === 'PUT') return new Response('{}', { status: 200 });
    if (url.endsWith('/deposit/depositions/42') && method === 'PUT') {
      return new Response(JSON.stringify({ id: 42, links: { html: 'https://zenodo.test/record/42' } }), { status: 200 });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const adapter = new ZenodoRegistryAdapter({ fetchImpl, credentialVault: new InMemoryCredentialVault({ zenodoRef: 'zenodo-secret' }) });
  const receipt = await adapter.register({
    protocol,
    request: { ...fixtureRequest, registration: { enabled: true, zenodo: { sandbox: false } } },
    identity,
    submissionMode: 'draft',
    credentialReference: 'zenodoRef',
  });
  assert.equal(receipt.status, 'draft-created');
  assert.equal(receipt.externalId, '42');
  assert.equal(receipt.metadata.tokenPersisted, false);
  assert.ok(calls.every((call) => call.authorization === 'Bearer zenodo-secret'));
});

test('GitHub adapter commits protocol files and creates a release through the REST API', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (method === 'GET') return new Response('{}', { status: 404 });
    if (url.endsWith('/releases') && method === 'POST') return new Response(JSON.stringify({ html_url: 'https://github.test/release/1' }), { status: 201 });
    if (method === 'PUT') return new Response(JSON.stringify({ content: { sha: 'new-sha' } }), { status: 201 });
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const request: ReviewRequest = {
    ...fixtureRequest,
    registration: {
      enabled: true,
      github: { owner: 'geoffrey', repository: 'review', createRelease: true, releaseTag: 'protocol-v1' },
    },
  };
  const adapter = new GitHubRegistryAdapter({ fetchImpl, credentialVault: new InMemoryCredentialVault({ githubRef: 'github-secret' }) });
  const receipt = await adapter.register({ protocol, request, identity, submissionMode: 'submit', credentialReference: 'githubRef' });
  assert.equal(receipt.status, 'published');
  assert.equal(receipt.url, 'https://github.test/release/1');
  assert.ok(calls.some((call) => call.method === 'PUT' && call.url.includes('/contents/protocol/PROTOCOL.md')));
  assert.ok(calls.some((call) => call.method === 'POST' && call.url.endsWith('/releases')));
});
