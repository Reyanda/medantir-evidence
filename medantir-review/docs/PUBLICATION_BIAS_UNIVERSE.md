# MEDANTIR Publication-Bias Eligible-Universe Engine

## Purpose

Publication bias cannot be assessed only from studies that happened to enter a meta-analysis.

MEDANTIR therefore maintains a separate **eligible evidence universe** containing:

- studies contributing quantitative estimates;
- eligible registered studies with no usable estimate;
- eligible studies known to lack a full publication or result;
- registry-discovered candidates whose eligibility, result, outcome, or publication status is still scientifically unresolved.

A trial that never contributes to synthesis can therefore still provide evidence about publication/reporting bias.

## Core authority rules

### 1. Completeness debt is not evidence of bias

The engine separates two ledgers.

**Positive publication-bias signals**

- eligible registered study proven to have no available result in the reconciled evidence universe;
- target outcome proven to have been prespecified primary but absent from reconciled available results;
- eligible study proven to be registry-only or otherwise unpublished-known.

**Completeness debt**

- unresolved eligibility;
- eligible study not reconciled against the prespecified registry search;
- unknown global result availability;
- unknown primary-outcome prespecification;
- unknown target-outcome reporting status;
- unknown publication/preprint linkage status.

Completeness debt can block a signal-free GRADE assessment basis. It can never itself become a unit-strength publication-bias signal.

### 2. Registry-local facts are not global evidence-universe facts

ClinicalTrials.gov API v2 exposes `hasResults`. MEDANTIR captures that source fact internally as `hasPostedResults`.

`hasPostedResults=false` means only that summary results are not posted in ClinicalTrials.gov. It does **not** mean:

- no journal publication exists;
- no preprint exists;
- no result exists elsewhere;
- the target outcome was not reported elsewhere.

Consequently:

- `hasPostedResults=true` proves that some registry results exist;
- exact posted target-outcome data can prove target-outcome availability;
- `hasPostedResults=false` leaves global result availability unresolved until publication/result reconciliation;
- an unlinked registry candidate starts with `publicationStatus='unknown'`, never `registry-only`.

### 3. Publication existence does not automatically prove result availability

MEDANTIR treats publication linkage and results availability as separate scientific facts.

An exact NCT-linked protocol paper may establish `publicationStatus='published'` while leaving `resultsAvailable='unknown'`.

`resultsAvailable=true` requires evidence that the linked report is result-bearing, for example:

- study-family role `primary-results`, `secondary-analysis`, `follow-up`, `economic-analysis`, `mechanistic-substudy`, or `companion-report`;
- an extracted study/outcome tied to the linked report;
- an explicit results-bearing document role in an exact-identifier discovery result;
- or explicit quantitative result fields in the bibliographic record.

### 4. Negative clearance requires a prospectively frozen completeness policy

`PublicationBiasUniversePolicy` is bound to the final protocol checksum. It controls whether a signal-free eligible universe can become the GRADE publication-bias assessment basis.

The policy includes:

- minimum eligible-universe registry-search coverage;
- whether eligibility must be resolved;
- whether global result availability must be known;
- whether primary-outcome prespecification must be known;
- whether target-outcome reporting status must be known;
- whether publication/preprint linkage status must be known.

Primary-outcome and publication-status completeness default conservatively to `true` when omitted from older configurations.

If a non-zero registry-coverage policy is frozen but the final search plan contains no supported registry source, protocol finalisation stops before evidence search.

### 5. Full-universe completeness supersedes an Egger-only basis

Egger regression is a small-study-effect diagnostic, not a complete publication-bias audit.

If automatic Egger assessment created an earlier `__assessment-basis__`, the eligible-universe layer removes that basis until the prospectively required registry/result/publication audit is complete.

Positive Egger or missing-result signals remain preserved. Only a complete eligible-universe audit restores the assessment-basis receipt required for deterministic GRADE finalisation.

## ClinicalTrials.gov source capture

`SourceRichClinicalTrialsGovAdapter` uses the official API v2 and preserves:

- registry identifier and overall status;
- registry-posted result status;
- study type, phase, allocation, intervention model, purpose, masking and enrollment;
- eligibility criteria, age, sex and study-population fields;
- arm groups and interventions;
- protocol primary and secondary outcomes;
- posted outcome-result structures and actual outcome/statistical data presence;
- structured registry references, preserving `type`, PMID and citation separately.

The adapter preserves complete-export reconciliation, record limits, retry/backoff and explicit pagination checks.

## Authority hierarchy for publication reconciliation

MEDANTIR uses the strongest deterministic source available before asking a human.

### Layer 1: official registry RESULT references

`RegistryReferenceEvidenceAgent` uses only ClinicalTrials.gov references explicitly typed `RESULT`.

- a RESULT reference establishes that a result exists;
- a RESULT reference with PMID may establish `publicationStatus='published'`;
- a citation-only RESULT reference establishes result availability but leaves publication indexing/status unresolved;
- `BACKGROUND` references have zero publication-bias completeness authority;
- RESULT references never, by themselves, prove that the target GRADE outcome was reported.

Every accepted reference emits a body-free `RegistryResultReferenceReceipt`.

### Layer 2: durable exact-NCT publication discovery

If material publication/result debt remains, `RegistryPublicationDiscoveryAgent` performs a separate exact-identifier publication search against official PubMed and Europe PMC adapters.

This is **not** a rerun or mutation of the review's primary search universe. The discovered records live on a dedicated publication-bias evidence plane:

- `registryPublicationDiscoveryRecords`;
- `registryPublicationDiscoveryReceipts`;
- `registryPublicationDiscoveryProvenance`;
- `registryPublicationDiscoveryQuality`.

External requests run through `ExternalActionCoordinator` with `safe-repeat` replay policy. A successful exact NCT search is therefore reused after restart instead of being silently reissued, and whether a durable response was reused is intentionally excluded from scientific receipt identity.

If no durable coordinator exists, MEDANTIR refuses to perform the remote discovery and records explicit deferred debt rather than doing uncheckpointed external work.

### Layer 3: exact publication linkage

`RegistryPublicationLinkageAgent` accepts exact registry association only through:

1. a study-family link with one unique registry ID and `linkageBasis='single-registry-id'`;
2. one literal `NCT########` identifier found in a non-registry bibliographic title, abstract or keyword;
3. a record returned by MEDANTIR's exact-NCT durable discovery query.

Routes 2 and 3 remain distinct in the receipt:

- `bibliographic-unique-nct` means the identifier was literally present in the bibliographic record;
- `registry-discovery-exact-nct` means association came from the exact source query and its discovery receipt.

Both routes also require a deterministic trial-document role. Protocol/study-report/results-bearing records are allowed; systematic reviews, meta-analyses, editorials, commentaries, perspectives, correspondence, news, errata and corrections are rejected. A multi-NCT citation is ambiguous and never auto-linked.

No semantic title similarity is used.

Every accepted link emits a body-free `RegistryPublicationLinkReceipt` with the exact source route and evidence IDs.

## Conservative registry eligibility

`assessRegistrySourceEligibility()` deliberately has asymmetric authority.

### Automatic exclusion

Allowed only for an explicit structural contradiction currently safe to encode deterministically, such as an observational/non-randomized registry design against an RCT-only ReviewSpec.

Missing or non-exact population/intervention/comparator/outcome wording is **not** an exclusion rule.

### Automatic inclusion

Requires exact deterministic matches for all five core facets:

1. design;
2. population;
3. intervention;
4. comparator;
5. outcome.

Intervention and comparator matching is arm-role aware. Synonym, ontology and semantic equivalence are not silently assumed by this deterministic layer.

## Smallest-material-question review loop

Each unresolved subject exposes a machine-readable `requiredFields` array containing only fields still capable of changing the completeness audit:

- `eligibilityStatus`;
- `resultsAvailable`;
- `prespecifiedPrimaryOutcomeFound`;
- `targetOutcomeReported`;
- `publicationStatus`.

Registry adjudication is incrementally completable:

- a submission may resolve one or several **currently required** fields;
- `unknown`/`unresolved` values do not count as scientific progress;
- fields already resolved cannot be silently overwritten;
- remaining fields reappear in the next review package;
- identical lost-response retries are semantically idempotent;
- each partial resolution creates an append-only `RegistryUniverseResolutionReceipt`;
- cumulative current adjudication is projected separately from immutable resolution history.

`RegistryResidualDebtAgent` recomputes outstanding fields after reference resolution, durable discovery, publication linkage and adjudication so the mere existence of a prior adjudication object can never suppress remaining debt.

## Contributing studies

Already-included studies can still carry registry-specific completeness debt, especially unknown primary-outcome prespecification.

`ContributingRegistryDebtAgent` runs after publication linkage/residual-debt normalization and before the universe audit.

For a contributor:

- eligibility is already established by the included-study pipeline;
- result availability and target-outcome reporting are established by the included result;
- publication status is established by the included report;
- only unresolved registry/protocol-specific fields are surfaced.

When no registry ID exists, the stable subject key `STUDY:<studyId>` permits evidence-bound resolution.

## Replay and audit

Policy/search/adjudication changes use lineage-aware replay invalidation.

The system:

- preserves append-only scientific attempt and registry-resolution history;
- resets the earliest contaminated stage and all downstream stages;
- removes stale registry reference/discovery/linkage and certainty artifacts;
- invalidates stale scientific manifests, seals and lineage;
- treats human clarification as scientific state transition, not an execution failure.

## Independent verifier surface

The verifier allowlist includes body-free certainty/universe artifacts such as:

- frozen GRADE and publication-bias policies;
- registry universe rows and review packages;
- cumulative adjudications and append-only resolution history;
- RESULT-reference receipts;
- exact-NCT discovery records, provenance and receipts;
- exact publication-link receipts;
- eligible-universe audits and publication-bias evidence catalog;
- automatic GRADE evidence receipts and outcome-level certainty artifacts.

Verifier reads remain hash-reconciled against scientific lineage. Any post-seal mutation returns `409`. Raw full texts and parsed article bodies remain explicitly forbidden.

## Production order

```text
Automatic directness / information-size / Egger evidence
    -> Registry/result universe construction
    -> Official ClinicalTrials.gov RESULT-reference evidence
    -> Durable exact-NCT PubMed / Europe PMC publication discovery
    -> Exact publication linkage with explicit provenance route
    -> Residual-debt recomputation
    -> Contributing-study registry debt normalization
    -> Eligible-universe registry/result/publication audit
    -> Deterministic frozen-policy GRADE
```

Protocol finalisation remains:

```text
Final protocol checksum
    -> Prospective GRADE policy gate
    -> Prospective publication-bias completeness/search-plan gate
    -> Registration/search execution
```

## Implemented safeguards

- ClinicalTrials.gov API-v2 structured capture;
- unambiguous `hasPostedResults` source semantics;
- official RESULT-reference publication evidence;
- durable PubMed/Europe PMC exact-NCT secondary publication discovery;
- dedicated secondary evidence plane that never mutates the primary search universe;
- conservative exact/structural registry eligibility classification;
- full eligible-universe denominator;
- exact publication linkage from study-family identity, literal NCT identity, or durable exact-query provenance;
- report-role validation and commentary/review rejection;
- publication-vs-results separation;
- multi-NCT ambiguity refusal;
- positive-signal versus completeness-debt separation;
- incremental smallest-question registry resolution;
- contributor-specific registry debt resolution;
- prospective completeness and registry-search-plan gating;
- full-universe GRADE binding;
- lineage-aware replay and stale-seal invalidation;
- body-free independent verifier exposure.

## Remaining certification boundary

This implementation is not yet independently production-certified. Remaining external proof includes:

- full repository TypeScript/build/test execution once GitHub Actions jobs actually enter step execution;
- external retrospective/prospective qualification of publication-bias completeness decisions;
- broader registry adapters beyond ClinicalTrials.gov;
- source-grounded ontology assistance for non-exact eligibility wording with human confirmation where material;
- the separate RoB 2 official-workbook parity and RevMan/metafor synthesis-parity gates.
