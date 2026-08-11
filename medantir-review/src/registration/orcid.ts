export interface OrcidOAuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  sandbox?: boolean;
  scopes?: string[];
}

export interface OrcidTokenResponse {
  accessToken: string;
  tokenType: string;
  refreshToken?: string;
  expiresIn?: number;
  scope: string;
  name?: string;
  orcid: string;
}

export function isValidOrcid(value: string): boolean {
  const compact = value.replace(/^https?:\/\/(?:www\.)?orcid\.org\//, '').trim();
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(compact)) return false;
  const digits = compact.replaceAll('-', '');
  let total = 0;
  for (let index = 0; index < 15; index += 1) {
    const digit = Number(digits[index]);
    if (!Number.isInteger(digit)) return false;
    total = (total + digit) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const check = result === 10 ? 'X' : String(result);
  return digits[15] === check;
}

export function normaliseOrcid(value: string): string {
  const compact = value.replace(/^https?:\/\/(?:www\.)?orcid\.org\//, '').trim();
  if (!isValidOrcid(compact)) throw new Error('Invalid ORCID iD checksum or format');
  return compact;
}

export function createOrcidAuthorizationUrl(config: OrcidOAuthConfig, state: string): string {
  const base = config.sandbox ? 'https://sandbox.orcid.org/oauth/authorize' : 'https://orcid.org/oauth/authorize';
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    scope: (config.scopes ?? ['/authenticate']).join(' '),
    redirect_uri: config.redirectUri,
    state,
  });
  return `${base}?${params.toString()}`;
}

export async function exchangeOrcidCode(
  config: OrcidOAuthConfig & { clientSecret: string },
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OrcidTokenResponse> {
  const endpoint = config.sandbox ? 'https://sandbox.orcid.org/oauth/token' : 'https://orcid.org/oauth/token';
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`ORCID token exchange failed with HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const orcid = String(payload.orcid ?? '');
  if (!isValidOrcid(orcid)) throw new Error('ORCID token response did not include a valid authenticated iD');
  const result: OrcidTokenResponse = {
    accessToken: String(payload.access_token ?? ''),
    tokenType: String(payload.token_type ?? 'bearer'),
    scope: String(payload.scope ?? ''),
    orcid: normaliseOrcid(orcid),
  };
  if (payload.refresh_token) result.refreshToken = String(payload.refresh_token);
  if (typeof payload.expires_in === 'number') result.expiresIn = payload.expires_in;
  if (payload.name) result.name = String(payload.name);
  return result;
}
