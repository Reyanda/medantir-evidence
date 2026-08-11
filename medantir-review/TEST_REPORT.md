# Test Report

## Result

- Package version: 0.5.0
- Strict TypeScript type check: passed
- Build: passed
- Protocol template generation: 21 of 21 review families generated
- Automated tests: 75 passed, 0 failed
- Protocol and registration demonstration: passed
- Benchmark demonstration: passed
- Runtime: Node.js native test runner

## Protocol development

Validated:

- a cited common protocol spine;
- 21 review-family-specific extensions;
- protocol Markdown and structured JSON generation;
- complete database-strategy appendices;
- protocol validation and checksums;
- `CITATION.cff` and `.zenodo.json` generation;
- PROSPERO, OSF, Zenodo, and GitHub field-map generation;
- full package and individual file hashes.

## Search strategy testing

Validated:

- empty-query detection;
- parenthesis and quotation balancing;
- repeated and dangling Boolean detection;
- PubMed, Ovid, and Web of Science syntax warnings;
- concept-coverage checks;
- search peer-review status;
- fail-closed blocking of definitive registration when required peer review is pending;
- continuation after peer review is documented as completed.

## Identity and credentials

Validated:

- ORCID format and checksum validation;
- production and sandbox authorization URL generation;
- OAuth authorization-code exchange;
- single-use and expiring OAuth state;
- access-token storage behind a credential reference;
- no token returned in the completed identity payload;
- no raw secret stored in protocol or registration ledgers;
- HTTP start and callback endpoints for an injected ORCID session manager.

## Registration adapters

Validated:

- PROSPERO prepare-only and authenticated browser submission states;
- ORCID requirement before PROSPERO submission;
- OSF prepare-only and authenticated submission routes;
- Zenodo draft creation, file upload, metadata update, and optional publication flow;
- GitHub file create/update and release creation;
- target eligibility and fallback planning;
- registry receipts linked to the exact protocol checksum;
- no-secrets registration ledger.

## Methodology routing

Validated:

- 21 review-family profiles;
- question frameworks;
- protocol, search, and reporting standards;
- appraisal tools;
- certainty frameworks;
- module selection;
- scoping-stage omission;
- diagnostic and qualitative safeguards.

## Existing-review commission decision

Validated:

- current, direct, trustworthy review selects adopt/adapt;
- older reusable review selects update;
- no reusable review selects de novo;
- review landscape is included in every protocol.

## Core workflow

Validated:

- complete systematic-review execution;
- scoping review without forced appraisal or certainty;
- rapid, mechanistic, and animal profiles;
- intermediate human-gate suspension;
- audit-trail generation;
- protocol and registration stages precede definitive searching;
- protocol and registration API retrieval.

## Search and records

Validated:

- HTTP evidence-source adapter;
- result/export reconciliation;
- transient retry;
- persistent mismatch fail-closed behaviour;
- DOI deduplication;
- merged database provenance.

## Evidence extraction and verification

Validated:

- page-indexed section mapping;
- rationale, objectives, results, discussion, and limitations evidence;
- blinded and unblinded packages;
- accept, reject, amend, and defer governance;
- rollback, regeneration, and re-verification.

## Synthesis safety

Validated:

- ordinary fixture meta-analysis;
- specialist review modes blocked from generic pooling;
- explicit specialist-adapter designation.

## Benchmark system

Validated:

- gold, silver, and method-conformance catalogue tiers;
- fully open versus mixed-access classification;
- frozen reproduction protocol;
- independent blinded audit protocol;
- exact, minimum, numeric-tolerance, and set-recovery metrics;
- screening recall, precision, F1, and work saved;
- database drift classification;
- source-review error proof requirements;
- prevention of method handbooks being used as numeric gold standards.

## API

Validated:

- health endpoint;
- ORCID OAuth start endpoint;
- ORCID OAuth callback endpoint;
- run creation;
- run retrieval;
- protocol-package retrieval;
- registration-plan and receipt retrieval;
- pending verification response;
- verification-package retrieval;
- verification submission;
- final report completion;
- invalid request rejection.

## Commands executed

```bash
npm run generate:templates
npm test
npm run demo:protocol
npm run demo:benchmark
```

## Remaining production certification

The deterministic suite does not claim live certification of:

- the current PROSPERO form, eligibility decision, named-author approval, MFA, or CAPTCHA workflow;
- OSF provider-specific schemas, contributor approval, or production API permissions;
- live ORCID client credentials and production redirect configuration;
- live Zenodo publication or community curation;
- GitHub App installation, branch protection, and organisational policy;
- licensed bibliographic database authentication;
- vendor interface changes;
- heterogeneous real-world OCR and table extraction;
- clinical correctness of automated appraisal;
- equivalence to specialist DTA, NMA, prognosis, prediction, prevalence, qualitative, economic, or mechanistic software;
- whole-review reproduction until frozen reference packages are onboarded;
- reviewer-interface usability under real workloads.
