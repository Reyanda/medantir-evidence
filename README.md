# MEDANTIR Evidence

MEDANTIR Evidence is the canonical evidence-review application in the MEDANTIR ecosystem. It combines an evidence workbench, a protocol-led closed-loop review engine, live bibliographic and registry search adapters, document intelligence, evidence-bound human gates, synthesis, certainty assessment, reporting, and independent verification.

The larger `Reyanda/Medantir` repository may consume or deploy this project, but this repository owns the evidence-specific frontend under `src/` and the review service under `medantir-review/`. Changes to those trees should be made here first. Copying code independently into both repositories is not an acceptable production workflow because it can create silent scientific and security drift.

## What is implemented

The TypeScript review service supports 21 review families and a 21-stage auditable pipeline:

```text
question → identity → protocol → existing-review landscape → protocol draft
→ database-specific search build and validation → protocol finalisation
→ registration package → definitive search → deduplication → TIAB screening
→ lawful full-text retrieval → LiteParse-first document intelligence
→ full-text screening → extraction → risk of bias → synthesis → certainty
→ report → evidence-bound human verification
```

The dedicated workbench adds question decomposition, protocol/search design, screening, extraction, synthesis, evidence mapping, figures, reports, source configuration, model routing, project files, and verifier views.

## Local frontend

```bash
npm ci
npm run dev
```

The frontend defaults to the deployed review service. Override it for a local service:

```bash
VITE_REVIEW_API_URL=http://127.0.0.1:8788 npm run dev
```

## Review service

Hermetic development/test server:

```bash
cd medantir-review
npm ci
npm test
npm start
```

Production service:

```bash
cp .env.production.example .env.production
# edit all required values
docker compose -f docker-compose.production.yml up --build -d
```

The production image:

- runs as the unprivileged `node` user;
- uses a read-only root filesystem with a dedicated persistent `/data` volume;
- stores run ownership and durable hash-chained checkpoints on that volume;
- encrypts OAuth and registry credentials with AES-256-GCM;
- fails closed when Cognito, CORS, live mode, or credential-key configuration is unsafe;
- exposes only loopback port `8788` by default, for placement behind a TLS reverse proxy.

See `docs/PRODUCTION_DEPLOYMENT.md` for configuration, backup, recovery, and current scaling boundaries.

## Quality gates

```bash
npm run ci
```

This runs frontend lint/build and review-engine typecheck/tests. Pull requests also build the production container. GitHub Pages deployment repeats the scientific-engine checks before publishing the frontend.

## Scientific boundary

MEDANTIR automates retrieval, evidence organisation, deterministic calculations, provenance, and controlled model-assisted tasks. It does not silently invent protocol decisions, licensed access, reviewer judgements, registry approvals, or certainty evidence. Material ambiguity, independent search-strategy peer review, RoB 2 signalling, GRADE policy/evidence, registry-universe completeness, registration reconciliation, and final verification remain explicit attributable gates.
