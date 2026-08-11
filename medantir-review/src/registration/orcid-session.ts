import { randomBytes, randomUUID } from 'node:crypto';
import type { CredentialStorePort } from '../core/ports.js';
import type { ResearcherIdentity } from '../core/types.js';
import {
  createOrcidAuthorizationUrl,
  exchangeOrcidCode,
  type OrcidOAuthConfig,
} from './orcid.js';

interface PendingState {
  expiresAt: number;
}

export interface OrcidAuthorizationSession {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export interface CompletedOrcidSession {
  identity: ResearcherIdentity;
  credentialReference: string;
}

export interface OrcidOAuthSessionManagerOptions {
  config: OrcidOAuthConfig & { clientSecret: string };
  credentialStore: CredentialStorePort;
  fetchImpl?: typeof fetch;
  stateTtlSeconds?: number;
  now?: () => number;
}

export class OrcidOAuthSessionManager {
  private readonly pending = new Map<string, PendingState>();
  private readonly fetchImpl: typeof fetch;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(private readonly options: OrcidOAuthSessionManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.ttl = options.stateTtlSeconds ?? 600;
    this.now = options.now ?? Date.now;
  }

  start(): OrcidAuthorizationSession {
    this.purgeExpired();
    const state = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ttl * 1000;
    this.pending.set(state, { expiresAt });
    return {
      authorizationUrl: createOrcidAuthorizationUrl(this.options.config, state),
      state,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async complete(code: string, state: string): Promise<CompletedOrcidSession> {
    this.purgeExpired();
    const pending = this.pending.get(state);
    if (!pending) throw new Error('Invalid, expired, or already-consumed ORCID OAuth state');
    this.pending.delete(state);
    if (!code.trim()) throw new Error('ORCID authorization code is required');

    const token = await exchangeOrcidCode(this.options.config, code, this.fetchImpl);
    const credentialReference = `orcid:${randomUUID()}`;
    await this.options.credentialStore.put(credentialReference, token.accessToken);
    const identity: ResearcherIdentity = {
      displayName: token.name ?? `ORCID ${token.orcid}`,
      orcid: token.orcid,
      authenticated: true,
      authenticationProvider: 'orcid',
      verifiedAt: new Date(this.now()).toISOString(),
      scopes: token.scope.split(/\s+/).filter(Boolean),
    };
    return { identity, credentialReference };
  }

  private purgeExpired(): void {
    const current = this.now();
    for (const [state, pending] of this.pending.entries()) {
      if (pending.expiresAt <= current) this.pending.delete(state);
    }
  }
}
