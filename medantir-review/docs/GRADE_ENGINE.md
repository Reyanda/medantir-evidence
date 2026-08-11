# MEDANTIR GRADE Certainty Engine

## Scope

This module implements outcome-level certainty assessment for the first production intervention/RCT review vertical.

The five downgrade domains are:

1. risk of bias;
2. inconsistency;
3. indirectness;
4. imprecision;
5. publication bias.

Upgrade domains are represented separately for future evidence families, but the RCT intervention vertical starts at high certainty and does not use upgrades to exceed high certainty.

## Core rule

Missing information is **not** equivalent to “no serious concern.”

Each domain decision is one of:

- `no-serious-concern`;
- `serious`;
- `very-serious`;
- `not-assessable`.

If any required domain is missing or `not-assessable`, the outcome-level GRADE assessment remains `incomplete` and no final certainty rating is emitted.

## Authority and provenance

Decision sources are explicit:

- `deterministic-policy` — produced by a frozen protocol rule and carries a policy ID;
- `model-proposed` — attributable model/human-review proposal requiring actor/time before it can become authoritative;
- `human` — attributable human decision;
- `unresolved` — missing policy/evidence and therefore no scientific authority.

Every domain retains rationale, evidence IDs, metrics and source identity.

## Frozen policy requirement

GRADE does not define universal numerical cutoffs for all review contexts. MEDANTIR therefore does not silently hard-code an I² threshold, risk-of-bias weight cutoff, OIS threshold, directness count, or publication-bias score as globally authoritative.

A deterministic threshold is used only when a protocol-bound policy is frozen with:

- policy ID;
- protocol hash;
- version;
- rationale;
- frozen timestamp;
- domain-specific thresholds.

Without that policy, the domain is `not-assessable`.

## Risk of bias

The RCT vertical consumes result-level RoB 2 final judgements and the corresponding random-effects synthesis weights.

A crucial invariant is **complete synthesis-weight coverage**. If one or more weighted studies lack a complete RoB 2 assessment, MEDANTIR refuses to renormalize the remaining weights to 100%. The GRADE risk-of-bias domain becomes `not-assessable` until the missing weighted evidence is appraised.

The frozen policy may specify thresholds for:

- weighted high-risk evidence producing a one-level downgrade;
- weighted high-risk evidence producing a two-level downgrade;
- weighted some-concerns evidence producing a one-level downgrade.

These are review policy choices, not universal GRADE constants.

## Inconsistency

The deterministic evidence object can include:

- study count;
- I²;
- tau²;
- prediction interval;
- decision thresholds/null value.

A frozen policy can define I² thresholds and whether a prediction interval spanning materially different decision regions is sufficient for a serious concern.

The engine does not treat I² alone as a complete description of heterogeneity.

## Imprecision

Imprecision is evaluated against **decision thresholds and information size**, not merely the pooled standard error.

The policy contains:

- null value;
- benefit threshold;
- harm threshold;
- required information size;
- fraction of required information size considered very serious.

The engine identifies which decision regions the confidence interval spans and combines that with the information-size fraction.

A confidence interval that simultaneously permits important benefit and important harm can therefore be rated more severely than an equally wide interval located wholly within one decision region.

## Indirectness

Directness is evaluated dimension by dimension:

- population;
- intervention/exposure;
- comparator;
- outcome;
- optional setting;
- optional follow-up.

Each dimension is `direct`, `partial`, or `indirect`. A frozen policy determines how many partial/indirect dimensions trigger one- or two-level concern.

## Publication bias

Publication bias is represented as explicit evidence signals rather than a single funnel-plot verdict.

Examples of signals that may be supplied by upstream evidence modules include:

- registered completed studies without results;
- selective dissemination evidence;
- prespecified small-study-effect evidence;
- sponsor/reporting patterns;
- grey-literature/publication-status discrepancies.

Each signal has an ID, description, strength and source evidence IDs. A frozen policy maps accumulated signal strength to concern severity.

An empty signal list is meaningful only when the outcome evidence package explicitly records that publication-bias surveillance was performed; absence of a package remains `not-assessable`.

## Stage agent

`InterventionGradeAgent` consumes:

- `interventionRandomEffectsAnalyses`;
- `rob2Assessments`;
- `gradePolicySet`;
- `gradeOutcomeEvidence`.

The stage computes deterministic domain proposals where evidence and policy are sufficient. Missing evidence/policy creates `gradeEvidenceReviewPackage` and returns `awaiting-human`.

Only complete outcome assessments enter the compatibility `grade` artifact.

## Current boundary

The engine is not yet production-certified until:

1. GRADE policies are incorporated into protocol development/amendment workflows;
2. directness, information-size and publication-bias evidence are generated from source-bound upstream modules rather than manually staged artifacts;
3. an authenticated GRADE adjudication controller/API is added;
4. model proposals are schema/evidence bounded and kept separate from deterministic/human authority;
5. Summary-of-Findings absolute effects and baseline-risk handling are implemented;
6. GRADE benchmark cases are frozen against independently adjudicated expert outcomes;
7. the full TypeScript-7 repository suite executes successfully.

## Non-negotiable invariant

MEDANTIR never converts `not-assessable` into high certainty merely to finish a report.
