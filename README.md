# MEDANTIR Evidence

MEDANTIR Evidence is the canonical evidence-review application in the MEDANTIR ecosystem. It combines an evidence workbench, a protocol-led closed-loop review engine, live bibliographic and registry search adapters, document intelligence, evidence-bound human gates, synthesis, certainty assessment, reporting, independent verification, and an immutable Evidence Operating System layer.

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

## Evidence OS

The Evidence OS kernel projects the same durable review state into a versioned, content-addressed evidence graph. It does not maintain a second scientific pipeline or silently upgrade unsupported methods.

The core object path is:

```text
Question → Protocol → Search Strategy → Search Execution → Retrieved Record
→ Screening Decision → Full Text → Parsed Document → Evidence Excerpt
→ Study → Effect Estimate / Mechanism → Risk of Bias → Synthesis
→ Certainty → Report → Verification
```

The kernel provides:

- immutable evidence objects with scientific content hashes;
- stable logical identities, versions, and supersession edges;
- graph edges for dependency, derivation, support, appraisal, synthesis, reporting, and verification;
- a workflow DAG derived from the existing typed 21-stage protocol;
- model-routing and cost ledgers;
- a reproducibility bundle containing the workflow, graph, cost ledger, scientific manifest, scientific seal, protocol checksum, and final-report hash;
- explicit ports for future Temporal, Dagster, Prefect, Airflow, Kafka, RabbitMQ, Redis Streams, transactional repositories, and immutable object storage;
- a machine-readable capability registry that distinguishes operational, human-gated, partial, research-only, externally certified, and planned functions.

Public discovery endpoints:

```text
GET /evidence-os/architecture
GET /evidence-os/openapi
```

Authenticated, owner-and-project-scoped run endpoints:

```text
GET /runs/:runId/evidence-os
GET /runs/:runId/evidence-graph
GET /runs/:runId/evidence-objects/:objectId
GET /runs/:runId/workflow-plan
GET /runs/:runId/cost-ledger
GET /runs/:runId/reproducibility-bundle
```

See [`docs/EVIDENCE_OS_ARCHITECTURE.md`](docs/EVIDENCE_OS_ARCHITECTURE.md) for the full architecture, capability matrix, invariants, distributed-workflow seam, and remaining certification work.

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

See [`docs/PRODUCTION_DEPLOYMENT.md`](docs/PRODUCTION_DEPLOYMENT.md) for configuration, backup, recovery, and current scaling boundaries.

## Kubernetes

A hardened, single-replica Kubernetes baseline is available under [`deploy/kubernetes`](deploy/kubernetes). It uses `Recreate`, a `ReadWriteOnce` persistent volume, non-root execution, a read-only root filesystem, dropped capabilities, health probes, and secret injection.

The replica count must remain one until a transactional run store, distributed leases, a durable queue, immutable artifact storage, and cross-worker checkpoint coordination are implemented and certified.

## Quality gates

```bash
npm run ci
```

This runs frontend lint/build and review-service typecheck/tests. Pull requests also build the production container. GitHub Pages deployment repeats the deployable scientific-service checks before publishing the frontend.

Evidence OS production tests additionally cover object addressing, immutability, secret redaction, supersession, DAG acyclicity, graph projection, stable hashes, capability truth status, cost aggregation, authenticated graph access, object retrieval, and cross-owner denial.

## Scientific boundary

MEDANTIR automates retrieval, evidence organisation, deterministic calculations, provenance, controlled model-assisted tasks, and reproducible graph projection. It does not silently invent protocol decisions, licensed access, reviewer judgements, registry approvals, certainty evidence, appraisal-tool parity, causal identification, or unsupported synthesis methods.

Material ambiguity, independent search-strategy peer review, RoB 2 signalling, GRADE policy/evidence, registry-universe completeness, registration reconciliation, and final verification remain explicit attributable gates. ROBINS-I/E, QUADAS, QUIPS, COSMIN, advanced Bayesian and network synthesis, and the HEOS causal modules remain partial, planned, or research-only until their own validated production contracts and conformance corpora exist.
