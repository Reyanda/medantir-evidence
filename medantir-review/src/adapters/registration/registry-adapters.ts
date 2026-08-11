import type { CredentialStorePort, CredentialVaultPort, ProtocolRegistryAdapter } from '../../core/ports.js';
import type {
  ProtocolPackage,
  RegistrationReceipt,
  RegistrationSubmissionMode,
  RegistrationTarget,
  ResearcherIdentity,
  ReviewRequest,
} from '../../core/types.js';
import type { ExternalActionReconciliation } from '../../durability/external-action-coordinator.js';

export class InMemoryCredentialVault implements CredentialStorePort {
  private readonly values: Map<string, string>;
  constructor(values: Readonly<Record<string, string>> = {}) {
    this.values = new Map(Object.entries(values));
  }
  async get(reference: string): Promise<string | null> {
    return this.values.get(reference) ?? null;
  }
  async put(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
  }
  async delete(reference: string): Promise<void> {
    this.values.delete(reference);
  }
}

export interface RegistryRegistrationInput {
  protocol: ProtocolPackage;
  request: ReviewRequest;
  identity: ResearcherIdentity;
  submissionMode: RegistrationSubmissionMode;
  credentialReference?: string;
  idempotencyKey?: string;
}

export interface AuthenticatedRegistrationBrowserPort {
  submit(input: {
    target: 'prospero' | 'osf';
    protocol: ProtocolPackage;
    request: ReviewRequest;
    identity: ResearcherIdentity;
    submissionMode: RegistrationSubmissionMode;
    authentication: 'orcid' | 'osf-oauth';
    idempotencyKey?: string;
  }): Promise<{
    status: 'draft-created' | 'submitted' | 'awaiting-human';
    externalId?: string;
    url?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
}

function baseReceipt(
  target: RegistrationTarget,
  status: RegistrationReceipt['status'],
  protocol: ProtocolPackage,
  message: string,
): RegistrationReceipt {
  return {
    target,
    status,
    message,
    protocolChecksum: protocol.checksum,
    metadata: {},
  };
}

export class ProsperoBrowserRegistryAdapter implements ProtocolRegistryAdapter {
  readonly target = 'prospero' as const;
  constructor(private readonly browser: AuthenticatedRegistrationBrowserPort) {}

  async register(input: RegistryRegistrationInput): Promise<RegistrationReceipt> {
    if (input.submissionMode === 'prepare-only') {
      return baseReceipt(this.target, 'prepared', input.protocol, 'PROSPERO field mapping and browser submission package prepared.');
    }
    if (!input.identity.authenticated || !input.identity.orcid) {
      return baseReceipt(this.target, 'awaiting-human', input.protocol, 'Authenticated ORCID sign-in is required before PROSPERO submission.');
    }
    const result = await this.browser.submit({
      target: this.target,
      protocol: input.protocol,
      request: input.request,
      identity: input.identity,
      submissionMode: input.submissionMode,
      authentication: 'orcid',
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    const receipt = baseReceipt(this.target, result.status, input.protocol, result.message);
    if (result.externalId) receipt.externalId = result.externalId;
    if (result.url) receipt.url = result.url;
    receipt.metadata = {
      ...(result.metadata ?? {}),
      route: 'authenticated-browser',
      requiresNamedAuthorApproval: true,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return receipt;
  }
}

export class OsfBrowserRegistryAdapter implements ProtocolRegistryAdapter {
  readonly target = 'osf' as const;
  constructor(private readonly browser: AuthenticatedRegistrationBrowserPort) {}

  async register(input: RegistryRegistrationInput): Promise<RegistrationReceipt> {
    if (input.submissionMode === 'prepare-only') {
      return baseReceipt(this.target, 'prepared', input.protocol, 'OSF registration package prepared with protocol, search tests and metadata.');
    }
    const result = await this.browser.submit({
      target: this.target,
      protocol: input.protocol,
      request: input.request,
      identity: input.identity,
      submissionMode: input.submissionMode,
      authentication: 'osf-oauth',
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    });
    const receipt = baseReceipt(this.target, result.status, input.protocol, result.message);
    if (result.externalId) receipt.externalId = result.externalId;
    if (result.url) receipt.url = result.url;
    receipt.metadata = {
      ...(result.metadata ?? {}),
      route: 'authenticated-browser-or-api',
      immutableOnApproval: true,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return receipt;
  }
}

interface HttpAdapterOptions {
  fetchImpl?: typeof fetch;
  credentialVault: CredentialVaultPort;
}

async function tokenFor(reference: string | undefined, vault: CredentialVaultPort): Promise<string> {
  if (!reference) throw new Error('Credential reference is required; raw tokens must not be placed in the review request.');
  const value = await vault.get(reference);
  if (!value) throw new Error(`Credential '${reference}' was not found in the credential vault.`);
  return value;
}

function zenodoBase(request: ReviewRequest): { base: string; sandbox: boolean } {
  const sandbox = request.registration?.zenodo?.sandbox === true;
  return { base: sandbox ? 'https://sandbox.zenodo.org/api' : 'https://zenodo.org/api', sandbox };
}

export class ZenodoRegistryAdapter implements ProtocolRegistryAdapter {
  readonly target = 'zenodo' as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: HttpAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async register(input: RegistryRegistrationInput): Promise<RegistrationReceipt> {
    if (input.submissionMode === 'prepare-only') {
      return baseReceipt(this.target, 'prepared', input.protocol, 'Zenodo archival metadata and deposit files prepared.');
    }
    const token = await tokenFor(input.credentialReference, this.options.credentialVault);
    const { base, sandbox } = zenodoBase(input.request);
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const create = await this.fetchImpl(`${base}/deposit/depositions`, { method: 'POST', headers, body: '{}' });
    if (!create.ok) throw new Error(`Zenodo draft creation failed with HTTP ${create.status}`);
    const draft = await create.json() as Record<string, unknown>;
    const links = draft.links as Record<string, unknown> | undefined;
    const bucket = String(links?.bucket ?? '');
    const depositionId = String(draft.id ?? '');
    if (!bucket || !depositionId) throw new Error('Zenodo response did not contain deposit identifiers.');

    for (const file of input.protocol.files) {
      const upload = await this.fetchImpl(`${bucket}/${encodeURIComponent(file.path.replaceAll('/', '_'))}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': file.mediaType },
        body: file.content,
      });
      if (!upload.ok) throw new Error(`Zenodo upload failed for ${file.path} with HTTP ${upload.status}`);
    }

    const authors = input.protocol.structuredProtocol.authors.map((author) => {
      const creator: Record<string, string> = { name: `${author.familyName}, ${author.givenName}` };
      if (author.affiliation) creator.affiliation = author.affiliation;
      if (author.orcid) creator.orcid = author.orcid;
      return creator;
    });
    const marker = input.idempotencyKey ? ` MEDANTIR action: ${input.idempotencyKey}.` : '';
    const metadata: Record<string, unknown> = {
      title: input.protocol.title,
      upload_type: 'publication',
      publication_type: 'report',
      description: `Prospective protocol package for a ${input.request.reviewType} evidence review. Protocol checksum: ${input.protocol.checksum}.${marker}`,
      creators: authors,
      access_right: input.request.registration?.publicOnApproval === false ? 'restricted' : 'open',
      license: 'cc-by-4.0',
      keywords: [
        'systematic review protocol',
        input.request.reviewType,
        'evidence synthesis',
        ...(input.idempotencyKey ? [`medantir-action:${input.idempotencyKey}`] : []),
      ],
    };
    const community = input.request.registration?.zenodo?.community;
    if (community) metadata.communities = [{ identifier: community }];
    const update = await this.fetchImpl(`${base}/deposit/depositions/${depositionId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ metadata }),
    });
    if (!update.ok) throw new Error(`Zenodo metadata update failed with HTTP ${update.status}`);

    let published: Record<string, unknown> | null = null;
    if (input.submissionMode === 'submit') {
      const publish = await this.fetchImpl(`${base}/deposit/depositions/${depositionId}/actions/publish`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!publish.ok) throw new Error(`Zenodo publication failed with HTTP ${publish.status}`);
      published = await publish.json() as Record<string, unknown>;
    }
    const source = published ?? await update.json() as Record<string, unknown>;
    const receipt = baseReceipt(this.target, input.submissionMode === 'submit' ? 'published' : 'draft-created', input.protocol, input.submissionMode === 'submit' ? 'Zenodo record published.' : 'Zenodo draft deposit created.');
    receipt.externalId = String(source.id ?? depositionId);
    const doi = source.doi ? String(source.doi) : undefined;
    if (doi) receipt.doi = doi;
    const html = (source.links as Record<string, unknown> | undefined)?.html;
    if (html) receipt.url = String(html);
    receipt.metadata = {
      sandbox,
      filesUploaded: input.protocol.files.length,
      tokenPersisted: false,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return receipt;
  }

  async reconcile(input: RegistryRegistrationInput & { idempotencyKey: string }): Promise<ExternalActionReconciliation<RegistrationReceipt>> {
    const token = await tokenFor(input.credentialReference, this.options.credentialVault);
    const { base, sandbox } = zenodoBase(input.request);
    const response = await this.fetchImpl(`${base}/deposit/depositions?size=100`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!response.ok) {
      return { status: 'uncertain', reason: `Zenodo reconciliation failed with HTTP ${response.status}` };
    }
    const payload = await response.json();
    const candidates = Array.isArray(payload) ? payload as Record<string, unknown>[] : [];
    const matches = candidates.filter((candidate) => {
      const metadata = candidate.metadata as Record<string, unknown> | undefined;
      const description = String(metadata?.description ?? '');
      const keywords = Array.isArray(metadata?.keywords) ? metadata?.keywords.map(String) : [];
      return description.includes(input.protocol.checksum) && (
        description.includes(input.idempotencyKey) || keywords.includes(`medantir-action:${input.idempotencyKey}`)
      );
    });
    if (matches.length === 0) {
      // A process may have died after blank-deposit creation but before the marker
      // was written, so absence of a marked deposit does not prove absence remotely.
      return { status: 'uncertain', reason: 'No marked Zenodo deposit was found, but an unmarked orphan draft may exist; manual reconciliation is required.' };
    }
    if (matches.length > 1) {
      return { status: 'uncertain', reason: `Multiple Zenodo deposits match ${input.idempotencyKey}; manual deduplication is required.` };
    }
    const source = matches[0]!;
    const submitted = source.submitted === true || Boolean(source.doi);
    if (input.submissionMode === 'submit' && !submitted) {
      return { status: 'uncertain', reason: 'Matching Zenodo draft exists but publication completion cannot be proven.' };
    }
    const receipt = baseReceipt(this.target, input.submissionMode === 'submit' ? 'published' : 'draft-created', input.protocol, 'Zenodo registration recovered by remote reconciliation.');
    receipt.externalId = String(source.id ?? '');
    if (source.doi) receipt.doi = String(source.doi);
    const html = (source.links as Record<string, unknown> | undefined)?.html;
    if (html) receipt.url = String(html);
    receipt.metadata = { sandbox, reconciled: true, idempotencyKey: input.idempotencyKey, tokenPersisted: false };
    return { status: 'completed', response: receipt };
  }
}

function githubBase(request: ReviewRequest): { repository: NonNullable<ReviewRequest['registration']>['github']; branch: string; base: string } | null {
  const repository = request.registration?.github;
  if (!repository) return null;
  const branch = repository.branch ?? 'main';
  return {
    repository,
    branch,
    base: `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`,
  };
}

export class GitHubRegistryAdapter implements ProtocolRegistryAdapter {
  readonly target = 'github' as const;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: HttpAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async register(input: RegistryRegistrationInput): Promise<RegistrationReceipt> {
    const config = githubBase(input.request);
    if (!config?.repository) return baseReceipt(this.target, 'ineligible', input.protocol, 'GitHub repository configuration is missing.');
    if (input.submissionMode === 'prepare-only') {
      return baseReceipt(this.target, 'prepared', input.protocol, 'GitHub version-control package prepared, including CITATION.cff and .zenodo.json.');
    }
    const token = await tokenFor(input.credentialReference, this.options.credentialVault);
    const { repository, branch, base } = config;
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
    };

    for (const file of input.protocol.files) {
      const path = encodeURIComponent(file.path).replaceAll('%2F', '/');
      const get = await this.fetchImpl(`${base}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers });
      let sha: string | undefined;
      if (get.ok) {
        const existing = await get.json() as Record<string, unknown>;
        if (existing.sha) sha = String(existing.sha);
      } else if (get.status !== 404) {
        throw new Error(`GitHub content lookup failed for ${file.path} with HTTP ${get.status}`);
      }
      const marker = input.idempotencyKey ? ` [medantir:${input.idempotencyKey}]` : '';
      const body: Record<string, unknown> = {
        message: `Register protocol ${input.protocol.version}: ${file.path}${marker}`,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        branch,
      };
      if (sha) body.sha = sha;
      const put = await this.fetchImpl(`${base}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
      if (!put.ok) throw new Error(`GitHub file update failed for ${file.path} with HTTP ${put.status}`);
    }

    let releaseUrl: string | undefined;
    if (repository.createRelease === true && input.submissionMode === 'submit') {
      const tag = repository.releaseTag ?? `protocol-v${input.protocol.version}`;
      const release = await this.fetchImpl(`${base}/releases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tag_name: tag,
          target_commitish: branch,
          name: `Protocol ${input.protocol.version}`,
          body: `Registered evidence-review protocol. Checksum: ${input.protocol.checksum}${input.idempotencyKey ? `\nMEDANTIR action: ${input.idempotencyKey}` : ''}`,
          draft: false,
          prerelease: false,
        }),
      });
      if (!release.ok) throw new Error(`GitHub release creation failed with HTTP ${release.status}`);
      const payload = await release.json() as Record<string, unknown>;
      if (payload.html_url) releaseUrl = String(payload.html_url);
    }

    const receipt = baseReceipt(this.target, input.submissionMode === 'submit' ? 'published' : 'draft-created', input.protocol, releaseUrl ? 'Protocol files committed and release created.' : 'Protocol files committed to GitHub.');
    receipt.externalId = `${repository.owner}/${repository.repository}@${branch}`;
    receipt.url = releaseUrl ?? `https://github.com/${repository.owner}/${repository.repository}/tree/${branch}`;
    receipt.version = input.protocol.version;
    receipt.metadata = {
      filesCommitted: input.protocol.files.length,
      releaseCreated: Boolean(releaseUrl),
      tokenPersisted: false,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
    return receipt;
  }

  async reconcile(input: RegistryRegistrationInput & { idempotencyKey: string }): Promise<ExternalActionReconciliation<RegistrationReceipt>> {
    const config = githubBase(input.request);
    if (!config?.repository) return { status: 'uncertain', reason: 'GitHub repository configuration is missing during reconciliation.' };
    const token = await tokenFor(input.credentialReference, this.options.credentialVault);
    const { repository, branch, base } = config;
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    };
    let found = 0;
    for (const file of input.protocol.files) {
      const path = encodeURIComponent(file.path).replaceAll('%2F', '/');
      const get = await this.fetchImpl(`${base}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers });
      if (get.status === 404) continue;
      if (!get.ok) return { status: 'uncertain', reason: `GitHub reconciliation lookup failed for ${file.path} with HTTP ${get.status}` };
      found += 1;
      const existing = await get.json() as Record<string, unknown>;
      const encoded = typeof existing.content === 'string' ? existing.content.replace(/\s+/g, '') : '';
      const actual = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
      if (actual !== file.content) {
        return { status: 'uncertain', reason: `GitHub file ${file.path} exists but does not match the protocol package.` };
      }
    }
    if (found === 0) return { status: 'not-found' };
    if (found !== input.protocol.files.length) {
      return { status: 'uncertain', reason: `GitHub contains only ${found}/${input.protocol.files.length} protocol files; the previous registration is partial.` };
    }

    let releaseUrl: string | undefined;
    if (repository.createRelease === true && input.submissionMode === 'submit') {
      const tag = repository.releaseTag ?? `protocol-v${input.protocol.version}`;
      const release = await this.fetchImpl(`${base}/releases/tags/${encodeURIComponent(tag)}`, { headers });
      if (release.status === 404) {
        return { status: 'uncertain', reason: 'Protocol files are complete on GitHub but the required release is missing; registration is partial.' };
      }
      if (!release.ok) return { status: 'uncertain', reason: `GitHub release reconciliation failed with HTTP ${release.status}` };
      const payload = await release.json() as Record<string, unknown>;
      const body = String(payload.body ?? '');
      if (!body.includes(input.protocol.checksum)) {
        return { status: 'uncertain', reason: 'Existing GitHub release does not carry the expected protocol checksum.' };
      }
      if (payload.html_url) releaseUrl = String(payload.html_url);
    }

    const receipt = baseReceipt(this.target, input.submissionMode === 'submit' ? 'published' : 'draft-created', input.protocol, 'GitHub registration recovered by remote reconciliation.');
    receipt.externalId = `${repository.owner}/${repository.repository}@${branch}`;
    receipt.url = releaseUrl ?? `https://github.com/${repository.owner}/${repository.repository}/tree/${branch}`;
    receipt.version = input.protocol.version;
    receipt.metadata = {
      filesCommitted: input.protocol.files.length,
      releaseCreated: Boolean(releaseUrl),
      reconciled: true,
      idempotencyKey: input.idempotencyKey,
      tokenPersisted: false,
    };
    return { status: 'completed', response: receipt };
  }
}
