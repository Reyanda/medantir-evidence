# MEDANTIR ReviewSpec and Material Clarification Contract

This module is the first implementation slice of `docs/AUTONOMOUS_SR_IMPLEMENTATION_PLAN.md` Workstreams C and D.

## Scientific contract

A production-autonomous review may proceed past the question stage only when every scientifically material intake field is either explicitly supplied, protocol-derived without narrowing eligibility, or resolved through an attributable human clarification.

The compiler intentionally distinguishes two classes of missing information:

1. **material unknowns** — alternatives can change retrieval, eligibility, extraction, appraisal, estimands, synthesis, certainty, or conclusions; these block the run and produce one precise clarification request;
2. **reversible broadening defaults** — defaults that preserve or broaden evidence capture rather than silently excluding evidence, such as no language or date restriction. These are recorded in the ReviewSpec with `source = reversible-default` and remain auditable.

The compiler must never invent population, intervention/exposure, comparator, outcomes, eligible study designs, or evidence sources for intervention-family reviews.

## Artifacts

The autonomous question agent emits:

- `reviewSpec` — typed specification with per-field provenance and a deterministic hash;
- `reviewSpecCompilation` — completion status, safe-default ledger, and unresolved material fields;
- `clarificationIssues` — all current material ambiguities and their downstream stage impacts;
- `clarificationRequest` — exactly one user-facing question to answer next;
- `clarificationResolutionLedger` — attributable human answers;
- `protocolAmendments` — hash-bound scientific changes with earliest replay stage.

## Clarification lifecycle

```text
ReviewRequest
   |
   v
ReviewSpec compiler
   |
   +-- complete --------------------------> protocol development
   |
   +-- material ambiguity
          |
          v
      clarificationRequest
          |
          v
      authenticated human resolution
          |
          v
  recordClarificationResolution
          |
          v
      question = pending
          |
          v
      compiler reruns
```

`recordClarificationResolution` does **not** directly mutate the ReviewSpec. It validates and records the answer, hashes the scientific value and rationale into the audit trail, and reopens the question stage. Only the compiler can regenerate the scientific specification. This prevents an API or UI caller from bypassing compiler rules.

Clarification cycles are not execution retries. Once a valid answer is recorded, the question-stage operational retry counter is reset while the previous attempt remains visible in the audit/scientific ledger. This permits multiple legitimate questions without exhausting failure retry budgets.

## Initial intervention-family material fields

The first production vertical treats these as blocking when absent:

- population;
- intervention/exposure;
- comparator;
- outcomes;
- eligible study designs;
- database/source selection.

Living reviews additionally require an explicit surveillance/update policy.

The materiality map records which downstream stages each field can contaminate and the earliest stage that must be replayed after an amendment.

## Safe defaults

Current broadening defaults include:

- no language restriction;
- no date restriction;
- no setting restriction beyond the population criterion;
- no additional age exclusion beyond the population criterion;
- no exclusion solely by publication status;
- inclusion of eligible grey/unpublished evidence when lawfully retrievable;
- distinct retention of timepoints until a protocol hierarchy is locked;
- no mandatory subgroup restriction.

These defaults are permitted because they avoid silent evidence exclusion. Any future default that can narrow eligibility or alter the target estimand must be promoted to a material clarification rule.

## Production API

The real review engine is guarded by `AutonomousQuestionAgent`. A run with a material ambiguity stops at the question stage before downstream protocol or search execution.

The authenticated API exposes:

- `GET /runs/:id/clarification` — return the current clarification request, all remaining material issues, and ReviewSpec compilation state;
- `POST /runs/:id/clarification` — submit one answer, record it through the audited state transition, and resume the existing run.

The POST payload contains only `issueId`, `field`, `value`, and `rationale`. Actor identity and decision time are derived by the server from the verified authenticated session and server clock. Client-supplied `actorId` or `decidedAt` values have no authority.

A semantically identical retry is idempotent even if the server timestamp differs. The decision identity is based on issue, field, value, rationale, and authenticated actor. A lost-response retry therefore returns the existing state without recording a second decision or invoking pipeline resume twice. A conflicting second answer to the same issue is rejected.

Neither the HTTP route nor any client may write `reviewSpec` or `protocolAmendments` directly.

## Verification status

The compiler core has an independently executed focused verification under Node 22.16.0 and TypeScript 5.8.3 using the repository's strict compiler flags. It demonstrated material-design clarification, successful attributable resolution, time-invariant ReviewSpec hashing, and replay beginning at `protocol`.

This focused signal does not substitute for the repository-pinned TypeScript 7 full build/test suite. GitHub-hosted Actions remain non-informative while jobs terminate before step 1 with no step or log payload.

## Promotion tests

The module is not complete until tests demonstrate at minimum:

- missing material fields never receive fabricated values;
- deterministic ReviewSpec identity across timestamps;
- safe defaults are explicitly provenance-labelled;
- resolutions are attributable and schema-valid;
- forged clarification entries cannot amend already-specified fields;
- duplicate issue identities inside a ledger are rejected;
- conflicting duplicate answers are rejected;
- identical HTTP retry submissions are idempotent and do not resume twice;
- clarification cycles do not consume execution-failure retry budget;
- a resolution changes the ReviewSpec hash;
- amendments identify the correct earliest replay stage;
- living reviews cannot invent surveillance policy;
- the autonomous question agent stops before protocol development when material uncertainty remains;
- the real pipeline cannot execute search/network work before unresolved material intake issues are cleared;
- authenticated API actor identity overrides any spoofed client identity.
