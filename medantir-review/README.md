# Closed-Loop Evidence Review Engine

A runnable TypeScript reference architecture for protocol-led, auditable, multi-review evidence synthesis, registration, evidence-bound human verification, and reproducibility benchmarking.

## What is implemented

- 21 review-family profiles covering intervention, diagnostic, prognosis, prediction, prevalence, qualitative, mixed-methods, scoping, rapid, umbrella, living, network, harms, economic, implementation, mechanistic, animal, environmental, and evidence-map reviews.
- A protocol-development subsystem based on PRISMA-P, PRISMA-S, PRESS, Cochrane, JBI, and review-family-specific guidance.
- A WHO-like existing-review landscape gate that selects de novo, update, adopt/adapt, overview, or living-update routes.
- Database-specific search construction, automated syntax and concept testing, and optional independent search peer review.
- ORCID OAuth utilities for authenticated researcher identity without collecting passwords.
- Registration adapters and field maps for PROSPERO, OSF, Zenodo, and GitHub.
- Prepare-only, external-draft, and submit modes.
- Checksummed protocol packages, file-level hashes, registration receipts, and a no-secrets audit ledger.
- Twenty-one scientific workflow stages with validation, retries, provenance, rollback, and human gates.
- Deduplication, screening, lawful full-text retrieval, PDF section mapping, extraction, appraisal, synthesis, certainty, reporting, and final verification.
- Gold-data, silver-review, and method-conformance benchmarking.
- Strict TypeScript tests for methodology, protocol generation, registry routing, identity, adapters, closed-loop execution, and human adjudication.

## Pipeline

```text
Question
  -> ORCID-linked researcher identity
  -> Review-family methodology profile
  -> Existing-review landscape and commission decision
  -> Cited protocol draft
  -> Database-specific search build
  -> Search syntax, concept and pilot testing
  -> Independent search peer review, when required
  -> Protocol approval and immutable checksum
  -> PROSPERO, OSF, Zenodo and GitHub routing
  -> Registration receipts and audit ledger
  -> Definitive search execution
  -> Deduplication and study linkage
  -> TIAB screening
  -> Full-text retrieval and PDF conversion
  -> Full-text screening
  -> Section-aware extraction
  -> Risk of bias, synthesis and certainty
  -> Draft report
  -> Blinded or unblinded evidence-bound human verification
  -> Verified final report
```

## Protocol development

The engine generates a complete protocol rather than a generic form with renamed headings. Every review receives a common governance spine plus a specialist extension.

Common protocol content includes:

- registration, status, versioning, and amendments;
- authors, ORCID iDs, roles, and approvals;
- funding and conflicts;
- rationale and existing-review landscape;
- question framework and eligibility;
- information sources and search methods;
- screening, retrieval, extraction, and study linkage;
- outcomes, effect measures, risk of bias, synthesis, and certainty;
- equity, applicability, stakeholder involvement, reproducibility, and dissemination.

Specialist content is added for each review family. Examples include PIRD and threshold handling for diagnostic reviews, time origin and horizon for prognosis, calibration and discrimination for prediction models, epistemology and CERQual for qualitative evidence, causal-step predictions for mechanistic reviews, and animal-model clustering and translational indirectness for preclinical reviews.

Generated templates are in `docs/protocol-templates/`. The canonical source is `src/protocols/protocol-template-library.ts`.

## Search strategy testing and peer review

Before registration, every database strategy is tested for:

- empty or malformed queries;
- unbalanced parentheses and quotations;
- repeated or dangling Boolean operators;
- database-specific field syntax;
- coverage of question concepts;
- warnings that need human inspection;
- pilot result counts where a live testing adapter supplies them.

Required independent search peer review is fail-closed. `submit` mode cannot reach a registry or the definitive search while peer review is pending. Credentials are not resolved in that state.

## Registration architecture

The engine distinguishes four functions:

| Target | Function | Route |
|---|---|---|
| PROSPERO | Prospective review registration where the current eligibility rules permit | Authenticated browser workflow, with ORCID and human handoffs |
| OSF | General registration or preregistration across review families | Authenticated browser or API adapter |
| Zenodo | Archival deposit and DOI | REST API |
| GitHub | Version control, amendments, code, and releases | REST API or GitHub App |

Every final protocol package contains:

```text
protocol/PROTOCOL.md
protocol/protocol.json
protocol/search-strategies.json
protocol/search-test-report.json
registration/registry-submission-documents.json
registration/prospero-field-map.json
registration/osf-field-map.json
registration/zenodo-field-map.json
registration/github-field-map.json
CITATION.cff
.zenodo.json
```

Each registry map identifies unresolved live-form fields and mandatory human confirmations. The agent is not allowed to invent missing information to complete a submission.

## ORCID login

The ORCID module supports:

- production and sandbox OAuth authorization URLs;
- state propagation;
- authorization-code exchange;
- checksum validation and normalisation;
- identity metadata returned separately from credentials.

Only credential references enter the scientific pipeline. Passwords and raw access tokens are prohibited from protocol packages, audit events, GitHub commits, Zenodo deposits, or registration receipts.

## Existing-review commission gate

Before commissioning a new primary-study review, the engine can assess existing reviews for directness, currency, reproducibility, trustworthiness, extractability, risk-of-bias coverage, and certainty coverage. It then recommends `de-novo`, `update`, `adopt-adapt`, `overview`, or `living-update` and retains the rationale in the protocol and audit trail.

## Review-family safety

Different review types do not share one statistical engine. Generic pooling is blocked for diagnostic accuracy, network meta-analysis, prognosis, prediction models, prevalence, qualitative synthesis, mixed-methods integration, umbrella reviews, economic evidence, and mechanistic evidence. The engine returns `deferred-specialist` and names the required adapter.

## Human verification

The final stage presents each screening, extraction, appraisal, synthesis, certainty, and report decision with its rationale and page-level proof. Reviewers accept, reject, amend, or defer with written reasons.

Blinded mode hides authors, journal, source database, funding, raw identifiers, agent identity, and confidence while retaining the evidence needed to judge the proposition. Unblinded mode exposes complete provenance. Amendments create a versioned override, roll the workflow back to the earliest affected stage, regenerate dependent outputs, and require a new verification round.

## Reproducibility benchmark

The benchmark system supports:

1. gold open datasets for exact stage-level scoring;
2. silver whole-review packages, including open WHO evidence products;
3. method-conformance cases based on Cochrane, JBI, Campbell, OHAT, Navigation Guide, SYRCLE, and related guidance.

Modes are `frozen-reproduction`, `live-rerun`, and `independent-audit`. A difference from a source review is not called an error without source-level proof, repeatability, exclusion of a pipeline defect, and human adjudication.

## Run locally

```bash
npm install
npm run typecheck
npm test
npm run generate:templates
npm run demo:protocol
npm run demo
npm run demo:human
npm run demo:benchmark
npm start
```

The server listens on `PORT`, default `8787`. With `TLS_CERT_PATH` and `TLS_KEY_PATH`, it serves HTTPS; otherwise it serves HTTP.

## API flow

```http
GET /auth/orcid/start
POST /auth/orcid/callback
POST /runs
GET /runs/{runId}
GET /runs/{runId}/protocol
GET /runs/{runId}/registration
GET /runs/{runId}/verification
POST /runs/{runId}/verification
```

Response statuses:

- `200`: requested artifact or verified completion;
- `201`: a run completed immediately;
- `202`: a human gate, verification, or rework step remains;
- `400`: invalid request;
- `404`: run or artifact not found;
- `422`: a scientific stage failed.

## Main extension points

- `ResearcherIdentityPort`
- `SearchStrategyTestingPort`
- `ProtocolRegistryAdapter`
- `CredentialVaultPort`
- `EvidenceSourceAdapter`
- `FullTextRetrievalPort`
- `PdfTextExtractionPort`
- `HumanDecisionPort`
- `HumanVerificationPort`
- specialist synthesis adapters

## Documentation

- `docs/PROTOCOL_REGISTRATION_ARCHITECTURE.md`
- `docs/PROTOCOL_TEMPLATE_GUIDE.md`
- `docs/REGISTRY_FIELD_CROSSWALK.md`
- `docs/ORCID_SECURITY_PROTOCOL.md`
- `docs/PROTOCOL_TEMPLATE_LIBRARY.md`
- `docs/PROTOCOLS.md`
- `docs/AGENTS.md`
- `docs/METHODS_CROSSWALK.md`
- `docs/BENCHMARK_PROTOCOL.md`
- `docs/HUMAN_VERIFICATION_PROTOCOL.md`

## Important boundary

The code provides tested contracts and adapters, not a claim of universal live submission. PROSPERO and OSF form workflows, MFA, CAPTCHAs, contributor approval, institutional logins, vendor interface changes, and registry eligibility must be certified in sandbox or supervised browser sessions before production. The engine never bypasses access controls and never treats Zenodo or GitHub as substitutes for prospective registration.
