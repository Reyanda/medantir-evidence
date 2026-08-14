# Production deployment

## Canonical ownership

`Reyanda/medantir-evidence` is the canonical source for the evidence workbench and `medantir-review` service. The copies currently present in the larger `Reyanda/Medantir` repository are integration copies and must not be edited independently. A later repository-consolidation change should replace manual copying with a pinned package, submodule, subtree automation, or release artifact.

## Required topology

A production installation has four security boundaries:

1. **Static frontend** served over HTTPS.
2. **Review API** behind a TLS reverse proxy, authenticated with Cognito access tokens and scoped by `X-Actiora-Project`.
3. **Persistent review data volume** holding the ownership index, hash-chained checkpoints, external-action ledger, and encrypted credential envelopes.
4. **Optional specialist services**: LiteParse, institutional browser bridge, inference gateway, object storage, and registry adapters.

The included Compose file deploys the review API only. It can complete open-source searches with supported official APIs. Login-walled databases require a separately secured browser bridge and lawful institutional access.

## Required variables

`CORS_ORIGINS`, `COGNITO_USER_POOL_ID`, and `COGNITO_CLIENT_ID` are mandatory. The production entrypoint rejects wildcard CORS, multiple origins in one process, missing authentication, and non-live execution. `CORS_ORIGINS` must be the exact origin without a trailing slash or path.

The credential master key must decode to exactly 32 bytes. In simple Compose deployments, `REVIEW_ALLOW_BOOTSTRAP_KEY=1` creates a random key inside the persistent volume on first start. In managed infrastructure, inject `REVIEW_CREDENTIAL_MASTER_KEY` from a secret manager and set bootstrap to `0`.

## Frontend authentication

The GitHub Pages build uses OAuth 2.0 Authorization Code with PKCE. Configure the exact deployed base URL as an allowed Cognito callback and logout URL, for example:

```text
https://reyanda.github.io/medantir-evidence/
```

The callback URL can be overridden at build time with `VITE_COGNITO_REDIRECT_URI`. The frontend stores tokens only in `sessionStorage`; it does not persist them to `localStorage`.

## Start and verify

```bash
cp .env.production.example .env.production
$EDITOR .env.production
docker compose -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.production.yml ps
curl -fsS http://127.0.0.1:8788/health
```

Place Caddy, nginx, an application load balancer, or an API gateway in front of the loopback listener and forward the original `Authorization` and `X-Actiora-Project` headers.

## Persistence and recovery

The entire named `review_data` volume is authoritative and must be backed up as one consistency unit. It contains:

```text
/data/control/runs.json
/data/durability/runs/<run-id>/journal/*.json
/data/durability/runs/<run-id>/snapshot.json
/data/durability/external-actions/**
/data/credentials/*.json
/data/secrets/credential-master.key   # only for bootstrap-key deployments
```

Create a cold backup:

```bash
./scripts/backup-review-data.sh ./backups
```

Test restoration on a separate host before relying on backups. Restoring encrypted credentials without the matching master key makes them intentionally unreadable.

## Current production boundary

This baseline is safe for a **single review-service replica** with persistent storage. The scientific checkpoint journal is crash-safe, but run ownership is still indexed in one JSON control file and execution is scheduled inside the API process. Do not scale the review container horizontally yet.

Horizontal production requires a transactional ownership/run store, distributed leases and heartbeats, a durable work queue, immutable object storage for large evidence bodies, and dead-letter/reconciliation operations. The existing ports and hash-chained checkpoint model were designed to accept those backends without rewriting the scientific pipeline.

## Database and registry certification

Open official adapters can be exercised continuously. Licensed databases, PROSPERO, OSF, ORCID, Zenodo publication, GitHub organisation policies, MFA, CAPTCHA, and vendor interface changes require sandbox or supervised production certification. MEDANTIR must never bypass access controls or call a partial export a complete systematic-review search.
