# ORCID Identity and Login Security Protocol

## Objective

Collect a validated, authenticated ORCID iD without asking the researcher to disclose an ORCID password to the evidence-review engine.

## Approved flow

1. The application creates a random, single-use OAuth `state` value.
2. The user is redirected to the ORCID authorization endpoint.
3. ORCID authenticates the user and obtains consent.
4. ORCID returns an authorization code to a pre-registered redirect URI.
5. The identity service exchanges the code server-side.
6. The response is checked for a valid ORCID checksum.
7. The authenticated ORCID iD, display name, scopes, and verification time are stored as identity metadata.
8. Access and refresh tokens are stored only in a credential vault.
9. The scientific pipeline receives a credential reference, never a raw token.

The engine implements:

- `createOrcidAuthorizationUrl()`;
- `exchangeOrcidCode()`;
- ORCID format and ISO 7064 checksum validation;
- production and sandbox endpoint selection;
- scope declaration;
- token-response validation.

## Required controls

- HTTPS redirect URIs in production;
- exact redirect URI matching;
- unpredictable `state` values;
- short-lived authorization-code handling;
- secure, HTTP-only session cookies where a web session is used;
- token encryption at rest;
- secret rotation;
- least-privilege scopes;
- audit logging without tokens;
- sandbox certification before production;
- no embedded ORCID login in an iframe;
- no manual ORCID entry treated as authenticated identity.

## Suggested scopes

For identity only:

```text
/authenticate
```

Additional read or update scopes should be requested only where the user has a clear, service-specific reason and the integration is entitled to use them.

## Multi-author handling

- The corresponding author or guarantor authenticates the submission session.
- Every co-author's ORCID should be authenticated or independently confirmed before publication where feasible.
- The system records author approval separately from identity authentication.
- A PROSPERO or OSF submission remains pending until required contributor approvals are complete.

## Prohibited behaviour

- collecting ORCID passwords;
- storing raw OAuth tokens in the protocol package;
- placing secrets in GitHub, Zenodo, OSF files, logs, or error messages;
- accepting an invalid or unverified ORCID as authenticated;
- assuming that one authenticated author has approved on behalf of all authors.

## Official sources

- ORCID OAuth sign-in guidelines: https://info.orcid.org/documentation/integration-guide/orcid-oauth-sign-in-guidelines/
- ORCID authenticated iD tutorial: https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/
- ORCID Public API: https://info.orcid.org/what-is-orcid/services/public-api/
