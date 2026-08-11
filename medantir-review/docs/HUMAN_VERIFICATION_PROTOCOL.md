# Evidence-Bound Human Verification Protocol

## Purpose

The Human Verification Agent is the closure authority for the review. It does not ask a reviewer to approve or reject an opaque model output. It creates a decision-by-decision adjudication package in which every proposition is paired with the evidence used to produce it.

A final report is not released until the configured verification rules are satisfied.

## Decisions presented for verification

The package contains independently reviewable items for:

1. title and abstract eligibility;
2. full-text eligibility;
3. core study extraction;
4. rationale extraction;
5. objective extraction;
6. results extraction;
7. discussion and interpretation extraction;
8. limitations extraction;
9. outcome estimates;
10. risk-of-bias domain judgements;
11. synthesis method and interpretation;
12. GRADE certainty judgements;
13. the final report conclusion.

Each item contains:

- a stable item identifier;
- the proposition being reviewed;
- the proposed value or judgement;
- the system rationale;
- page-level evidence excerpts;
- section labels;
- evidence-coverage indicators;
- optional bibliographic and model metadata, depending on blinding mode.

## Required evidence domains

The extraction verification bundle must include evidence from:

- rationale or introduction;
- objectives or aims;
- results or findings;
- discussion or interpretation;
- limitations.

Methods evidence is additionally attached to study-design, population, intervention, comparator, and risk-of-bias decisions.

Missing evidence is not silently replaced by inference. The extraction records `Not explicitly reported`, generates a coverage warning, and exposes the gap to the reviewer.

## Reviewer verdicts

For every item, the reviewer selects one verdict and provides a written rationale:

- `accept`: the proposition is supported by the cited evidence;
- `reject`: the proposition is unsupported and cannot close;
- `amend`: the reviewer supplies a corrected value and rationale;
- `defer`: a decision cannot yet be made, for example because a supplement or second reviewer is required.

A rationale is mandatory for all verdicts. An amended value is mandatory for `amend`.

## Blinded verification

Blinded mode hides:

- raw record and study identifiers;
- authors;
- journal;
- source databases;
- funding information;
- agent identity;
- model confidence.

The reviewer still sees the proposition, proposed value, methodological rationale, evidence excerpts, page numbers, and section labels. Blinding therefore reduces prestige, source, and automation bias without turning the exercise into evidence-free approval.

## Unblinded verification

Unblinded mode additionally shows:

- title and bibliographic identity;
- authors and journal;
- source-database provenance;
- funding;
- responsible agent;
- model confidence where available.

This mode is appropriate for adjudication, provenance checking, study-family resolution, conflict-of-interest review, and operational troubleshooting.

## Closed-loop amendment behaviour

Human amendments do not overwrite the report in place.

The engine identifies the earliest affected stage, stores the amendment in a versioned override ledger, invalidates dependent artefacts, and reruns the pipeline from that stage. Examples:

| Amended item | Restart stage |
|---|---|
| TIAB eligibility | `tiab-screen` |
| Full-text eligibility | `fulltext-screen` |
| Extracted field | `extract` |
| Risk-of-bias domain | `risk-of-bias` |
| Synthesis judgement | `synthesise` |
| GRADE judgement | `grade` |
| Report conclusion | `report` |

After regeneration, a new verification package is created and human verification is required again.

## Closure rules

The review remains open when:

- any required item is missing;
- any item is deferred;
- any item is rejected;
- an amendment has not yet propagated through dependent stages;
- the verification package does not match the active run or mode.

The review closes only when every required item has an evidence-based accepted verdict, or human verification was explicitly disabled in the run configuration.

## API sequence

1. `POST /runs` creates and executes a run.
2. The server returns `202 Accepted` when the final verification package is ready.
3. `GET /runs/{runId}/verification` retrieves the active package.
4. `POST /runs/{runId}/verification` submits item-level verdicts.
5. The server returns:
   - `200 OK` when verification closes the review;
   - `202 Accepted` when adjudication, amendment propagation, or a new verification round remains;
   - `422 Unprocessable Entity` when a pipeline stage fails.
