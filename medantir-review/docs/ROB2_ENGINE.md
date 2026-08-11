# MEDANTIR RoB 2 Appraisal Engine

## Scope

This is the first production appraisal engine for the intervention-review vertical.

Supported configuration:

- RoB 2 tool version: 22 August 2019;
- individually randomized, parallel-group trials;
- result-level assessment;
- effect of assignment to intervention.

Not yet certified by this engine:

- cluster-randomized trials;
- crossover trials;
- effect of adhering to intervention;
- non-randomized intervention studies;
- exact parity with the official RoB 2 Excel algorithm workbook.

Unsupported variants are refused or capability-blocked. They are never silently routed through this implementation.

## Authority separation

MEDANTIR separates three layers:

1. **source evidence** — immutable `EvidenceExcerpt` objects with record/page/section provenance;
2. **signalling responses** — `Y`, `PY`, `PN`, `N`, `NI`, or `NA`, with rationale and evidence;
3. **judgement software** — deterministic domain and overall judgement.

A model may propose layer 2 only. It cannot submit a domain or overall risk judgement.

## Five domains

The engine implements structured signalling for:

1. D1 — bias arising from the randomization process;
2. D2 — bias due to deviations from intended interventions;
3. D3 — bias due to missing outcome data;
4. D4 — bias in measurement of the outcome;
5. D5 — bias in selection of the reported result.

Conditional questions are activated from preceding responses. A substantive response to an inactive conditional question is audit-visible and makes the assessment incomplete; explicit `NA` is allowed as flow notation.

## Evidence contract

For `Y`, `PY`, `PN`, or `N`, at least one source excerpt is required. `NI` and `NA` may carry no evidence.

Model output is rejected if it contains:

- invalid JSON;
- unknown or duplicate question IDs;
- invalid response values;
- missing rationale;
- an evidence ID not present in the supplied evidence catalogue;
- a substantive response without evidence;
- invalid confidence values.

Rejected model output becomes an unresolved evidence-review item. No fallback risk label is fabricated.

## Judgement audit model

Every domain retains:

- `algorithmJudgement` — immutable software proposal;
- `proposedJudgement` — backwards-compatible alias of the software proposal;
- `finalJudgement` — judgement after any attributable domain override;
- algorithm rationale;
- final rationale;
- active signalling questions;
- unsupported/missing questions;
- substantive inactive conditional responses.

The assessment separately retains:

- `algorithmOverall`;
- `proposedOverall` as its backwards-compatible alias;
- `domainAdjustedOverall` after domain overrides;
- `finalOverall` after any explicit overall override.

Human overrides require actor identity, time, rationale, and exact `from`/`to` judgements. Overrides never overwrite the algorithm proposal.

Multiple domains with some concerns create an explicit `multipleSomeConcernsEscalation` flag. MEDANTIR does not silently convert that discretionary situation to high risk.

## Model use

Production model-assisted signalling is enabled only when `OMNIROUTE_ROB2_MODEL` is configured. The model receives:

- study/result identity;
- outcome;
- signalling-question definitions;
- a finite evidence catalogue with source excerpt IDs.

The prompt explicitly prohibits model-generated risk judgements. Request/output hashes and actual routed model/provider receipts are retained.

Without a configured model or attributable human submission, the stage stops at `awaiting-human` with an evidence-review package.

## Human evidence review API

Authenticated endpoints:

```text
GET  /runs/:runId/risk-of-bias
POST /runs/:runId/risk-of-bias
```

The client submits only:

- study/result/outcome identity;
- signalling responses;
- rationale;
- evidence excerpt IDs;
- optional explicit judgement overrides.

The server resolves evidence IDs against the active review package. Arbitrary evidence objects are not accepted. Reviewer identity and decision time are injected by the authenticated server session.

Submissions are semantically idempotent across lost HTTP responses. Identical retries do not rerun the stage; conflicting retries are rejected.

One result can be resolved at a time. If other result-level RoB 2 assessments remain unresolved, the stage returns to `awaiting-human` and synthesis does not begin.

## Intervention appraisal routing

The production intervention router sends RCT-only ReviewSpecs to this engine.

If eligible designs include a non-randomized intervention design, MEDANTIR currently blocks appraisal and reports the missing validated design-specific engine. It does **not** label the legacy generic heuristic as ROBINS-I.

## Certification boundary

The signalling structure and conservative decision implementation are source-grounded, but the repository does not yet claim exact truth-table equivalence with the official RoB 2 Excel workbook.

Every assessment therefore carries:

```text
exactExcelAlgorithmParity = pending
productionCertificationBlockedOnExactParity = true
```

The intervention review can use the engine for development, evidence review, auditing, and benchmark construction, but the 100% production-certification gate remains closed until exact workbook parity is independently proven with a frozen conformance suite.

## Required certification work

1. obtain/freeze the official 2019 individually randomized Excel workbook;
2. enumerate its domain decision tables/algorithms into machine-readable gold;
3. generate exhaustive or boundary-complete signalling combinations;
4. compare MEDANTIR domain outputs against official outputs;
5. resolve every discrepancy without weakening fail-closed evidence rules;
6. freeze a signed conformance receipt tied to the official workbook hash;
7. add held-out real RCT result-level assessments from independent human reviewers;
8. only then change `exactExcelAlgorithmParity` from `pending`.
