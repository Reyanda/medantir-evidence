# Protocol Development and Registration Architecture

## Purpose

The protocol subsystem converts a structured research question into a review-family-specific, cited, tested, versioned, and registration-ready protocol before the definitive evidence search begins.

The governing rule is:

> No definitive review execution should begin until the protocol, search strategy, identity, registration route, and amendment policy have passed their required gates.

The subsystem follows the principles of PRISMA-P, PRISMA-S, PRESS, Cochrane, JBI, and review-family-specific guidance. Registration and archiving are handled as distinct functions:

- PROSPERO: prospective review registration where the current eligibility rules permit;
- OSF: general preregistration or registration across review families;
- Zenodo: archival deposit and DOI layer;
- GitHub: version control, machine-readable history, code, amendments, and release metadata;
- ORCID: authenticated researcher identity and contributor linkage.

## Stage sequence

```text
Question
  -> Researcher identity and ORCID verification
  -> Review-family and methodology profile
  -> Existing-review landscape
  -> Protocol draft
  -> Database-specific search construction
  -> Automated search testing
  -> Independent search peer review, when required
  -> Protocol validation and human approval
  -> Immutable protocol package and checksum
  -> Registry eligibility and route selection
  -> Draft, submit, or prepare-only action
  -> Registration receipts and audit ledger
  -> Definitive search execution
```

## Stage contracts

### 1. Identity

**Input:** review request and configured authors.

**Output:** `ResearcherIdentity`.

The identity stage records an authenticated ORCID iD when required. The scientific workflow never receives an ORCID password. OAuth authorization codes and access tokens are handled by the identity integration and credential vault.

### 2. Protocol methodology

**Input:** structured question and review type.

**Output:** `ReviewPlan`.

The plan declares:

- question framework;
- reporting and protocol standards;
- evidence streams;
- eligibility logic;
- appraisal instruments;
- synthesis family;
- certainty framework;
- mandatory and optional modules.

### 3. Existing-review landscape

The engine determines whether the question requires a de novo review, update, adoption or adaptation, overview, or living update. This decision and its rationale are incorporated into the protocol.

### 4. Protocol draft

The `ProtocolDraftAgent` combines common governance sections with a specific template for the selected review family. Every section includes:

- purpose;
- draft content;
- required status;
- validation rules;
- methodological citations.

### 5. Search development and testing

Every database receives a platform-specific search. Testing covers:

- balanced parentheses and quotations;
- valid Boolean structure;
- database field syntax;
- concept coverage;
- unsupported or suspicious operators;
- pilot-result metadata where a live adapter is available;
- documented warnings and errors.

PRESS-style independent peer review can be made mandatory. A definitive registry submission is blocked while required peer review remains pending.

### 6. Protocol finalisation

Finalisation produces an immutable `ProtocolPackage` containing:

- protocol Markdown;
- structured protocol JSON;
- full database strategies;
- search test report;
- cited guidance library;
- `CITATION.cff`;
- `.zenodo.json`;
- PROSPERO field map;
- OSF field map;
- Zenodo field map;
- GitHub field map;
- a SHA-based checksum for the whole protocol package;
- a checksum for every file.

### 7. Registry planning

The `ProtocolRegistrationAgent` separates eligibility from submission. Each target receives:

- role;
- current eligibility rationale;
- authentication requirement;
- API, browser, or hybrid route;
- unresolved fields;
- required human confirmations.

A target can be marked ineligible without blocking other appropriate targets.

### 8. Registration and archival actions

The engine supports three modes:

- `prepare-only`: generate all files and field maps without creating an external record;
- `draft`: create an editable external draft where the service permits;
- `submit`: submit or publish only after all mandatory gates pass.

### 9. Registration ledger

Every action produces a `RegistrationReceipt` and a `ProtocolRegistrationLedger` containing:

- target;
- status;
- external identifier;
- URL or DOI where returned;
- protocol checksum;
- version;
- time;
- non-secret metadata;
- evidence that raw credentials were not persisted.

## Amendment protocol

A registered protocol is not overwritten silently.

Each amendment must record:

1. previous protocol version and checksum;
2. new version and checksum;
3. date;
4. reason;
5. affected protocol sections;
6. affected searches or analyses;
7. whether the change was made before or after relevant results were known;
8. approver;
9. registry update status;
10. GitHub commit or release;
11. archival deposit relationship.

Major amendments should create a new protocol release and update each applicable registry record according to that service's rules.

## Security boundaries

- Do not store account passwords.
- Do not place access tokens in `ReviewRequest`, protocol files, audit events, or registration receipts.
- Store only credential references in the workflow.
- Resolve secrets from a vault immediately before an external action.
- Redact HTTP headers and browser-session details from logs.
- Require CSRF-protected `state` values for OAuth.
- Prefer sandbox environments before production certification.
- Apply least-privilege scopes and repository permissions.
- Require a human handoff for CAPTCHAs, MFA, terms acceptance, or author approval.

## Methodological sources

- PRISMA-P: https://www.prisma-statement.org/protocols
- PRISMA-S: https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-020-01542-z
- PRESS: https://www.cadth.ca/press-peer-review-electronic-search-strategies-2015-guideline-explanation-and-elaboration
- Cochrane Handbook: https://training.cochrane.org/handbook/current
- JBI Manual for Evidence Synthesis: https://jbi-global-wiki.refined.site/space/MANUAL
- PROSPERO: https://www.crd.york.ac.uk/prospero/
- OSF registrations: https://help.osf.io/article/330-welcome-to-registrations
- Zenodo API: https://developers.zenodo.org/
- ORCID OAuth: https://info.orcid.org/documentation/integration-guide/orcid-oauth-sign-in-guidelines/
- GitHub citation guidance: https://docs.github.com/repositories/archiving-a-github-repository/referencing-and-citing-content
