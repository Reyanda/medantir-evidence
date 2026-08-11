import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProtocolPackage, ResearcherIdentity, ReviewRequest } from '../src/core/types.js';
import {
  GitHubRegistryAdapter,
  InMemoryCredentialVault,
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
  id: 'protocol-reconcile-1',
  reviewType: 'systematic',
  title: 'Protocol: Reconciliation review',
  version: '1.0.0',
  status: 'final',
  finalisedAt: '2026-08-11T05:00:00.000Z',
  documentMarkdown: '# Protocol',
  structuredProtocol: {
    id: 'draft-reconcile-1',
    reviewType: 'systematic',
    title: 'Protocol: Reconciliation review',
    version: '1.0.0',
    status: 'draft',
    createdAt: '2026-08-11T05:00:00.000Z',
    authors: [{ givenName: 'Geoffrey', familyName: 'Manda', orcid: '0000-0002-1825-0097' }],
    sections: [],
    citations: [],
    checklist: [],
  },
  searchStrategies: [],
  searchTestReport: {
    status: 'passed',
    results: [],
    peerReviewRequired: false,
    peerReviewStatus: 'not-required',
    completedAt: '2026-08-11T05:00:00.000Z',
  },
  citations: [],
  checksum: 'checksum-reconcile-123',
  files: [
    { path: 'protocol/PROTOCOL.md', mediaType: 'text/markdown', content: '# Protocol', checksum: 'hash-1' },
    { path: 'protocol/protocol.json', mediaType: 'application/json', content: '{"version":"1.0.0"}', checksum: 'hash-2' },
  ],
};

const githubRequest: ReviewRequest = {
  ...fixtureRequest,
  registration: {
    enabled: true,
    github: {
      owner: 'reyanda',
      repository: 'review-test',
      branch: 'main',
      createRelease: true,
      releaseTag: 'protocol-v1',
    },
  },
};

function encoded(content: string) {
  return Buffer.from(content, 'utf8').toString('base64');
}

test('GitHub reconciliation returns completed only when every file and release match', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contents/protocol/PROTOCOL.md')) {
      return new Response(JSON.stringify({ content: encoded('# Protocol') }), { status: 200 });
    }
    if (url.includes('/contents/protocol/protocol.json')) {
      return new Response(JSON.stringify({ content: encoded('{"version":"1.0.0"}') }), { status: 200 });
    }
    if (url.includes('/releases/tags/protocol-v1')) {
      return new Response(JSON.stringify({
        html_url: 'https://github.test/release/1',
        body: `Registered evidence-review protocol. Checksum: ${protocol.checksum}`,
      }), { status: 200 });
    }
    throw new Error(`Unexpected reconciliation request ${url}`);
  };
  const adapter = new GitHubRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ githubRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: githubRequest,
    identity,
    submissionMode: 'submit',
    credentialReference: 'githubRef',
    idempotencyKey: 'ext-1111111111111111111111111111111111111111',
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') throw new Error('expected completed result');
  assert.equal(result.response.status, 'published');
  assert.equal(result.response.url, 'https://github.test/release/1');
  assert.equal(result.response.metadata.reconciled, true);
});

test('GitHub reconciliation proves not-found only when no protocol file exists', async () => {
  const fetchImpl: typeof fetch = async () => new Response('{}', { status: 404 });
  const adapter = new GitHubRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ githubRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: githubRequest,
    identity,
    submissionMode: 'submit',
    credentialReference: 'githubRef',
    idempotencyKey: 'ext-2222222222222222222222222222222222222222',
  });
  assert.deepEqual(result, { status: 'not-found' });
});

test('GitHub partial registration is uncertain rather than treated as safe to retry', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contents/protocol/PROTOCOL.md')) {
      return new Response(JSON.stringify({ content: encoded('# Protocol') }), { status: 200 });
    }
    if (url.includes('/contents/protocol/protocol.json')) return new Response('{}', { status: 404 });
    throw new Error(`Unexpected request ${url}`);
  };
  const adapter = new GitHubRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ githubRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: githubRequest,
    identity,
    submissionMode: 'submit',
    credentialReference: 'githubRef',
    idempotencyKey: 'ext-3333333333333333333333333333333333333333',
  });
  assert.equal(result.status, 'uncertain');
  if (result.status === 'uncertain') assert.match(result.reason, /only 1\/2 protocol files/i);
});

test('GitHub content mismatch is uncertain and never overwritten by recovery logic', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/contents/protocol/PROTOCOL.md')) {
      return new Response(JSON.stringify({ content: encoded('# DIFFERENT PROTOCOL') }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const adapter = new GitHubRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ githubRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: githubRequest,
    identity,
    submissionMode: 'draft',
    credentialReference: 'githubRef',
    idempotencyKey: 'ext-4444444444444444444444444444444444444444',
  });
  assert.equal(result.status, 'uncertain');
  if (result.status === 'uncertain') assert.match(result.reason, /does not match/i);
});

test('Zenodo exact marked completed deposit can be reconciled', async () => {
  const actionId = 'ext-5555555555555555555555555555555555555555';
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    assert.match(url, /deposit\/depositions\?size=100$/);
    return new Response(JSON.stringify([{
      id: 42,
      submitted: true,
      doi: '10.5281/zenodo.42',
      links: { html: 'https://zenodo.test/record/42' },
      metadata: {
        description: `Protocol checksum: ${protocol.checksum}. MEDANTIR action: ${actionId}.`,
        keywords: [`medantir-action:${actionId}`],
      },
    }]), { status: 200 });
  };
  const adapter = new ZenodoRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ zenodoRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: { ...fixtureRequest, registration: { enabled: true, zenodo: { sandbox: false } } },
    identity,
    submissionMode: 'submit',
    credentialReference: 'zenodoRef',
    idempotencyKey: actionId,
  });
  assert.equal(result.status, 'completed');
  if (result.status !== 'completed') throw new Error('expected Zenodo completed result');
  assert.equal(result.response.externalId, '42');
  assert.equal(result.response.doi, '10.5281/zenodo.42');
});

test('Zenodo absence of a marked record remains uncertain because orphan drafts may exist', async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([]), { status: 200 });
  const adapter = new ZenodoRegistryAdapter({
    fetchImpl,
    credentialVault: new InMemoryCredentialVault({ zenodoRef: 'secret' }),
  });
  const result = await adapter.reconcile({
    protocol,
    request: { ...fixtureRequest, registration: { enabled: true, zenodo: { sandbox: false } } },
    identity,
    submissionMode: 'draft',
    credentialReference: 'zenodoRef',
    idempotencyKey: 'ext-6666666666666666666666666666666666666666',
  });
  assert.equal(result.status, 'uncertain');
  if (result.status === 'uncertain') assert.match(result.reason, /orphan draft/i);
});
