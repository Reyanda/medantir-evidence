# Automatic GRADE Evidence Derivation

MEDANTIR separates **evidence derivation** from **certainty judgement**.

The automatic evidence layer may construct source-bound inputs for GRADE. It may not assign a GRADE concern or final certainty. Domain concerns remain the deterministic consequence of the frozen, protocol-bound GRADE policy implemented in `certainty/grade.ts`.

## Current automatic derivations

### 1. Exact PICO directness

`AutomaticGradeEvidenceAgent` can classify population, intervention/exposure, comparator and outcome as `direct` only when every study contributing to the pooled outcome has an identified canonical estimand whose normalized PICO strings exactly match the frozen `ReviewSpec` target.

No ontology, synonym, embedding, or language-model equivalence is silently assumed. If one study is missing an estimand or uses wording that is not an exact normalized match, automatic directness remains unresolved.

Every attempt emits an `AutomaticGradeEvidenceReceipt`, whether derivation succeeds or not.

### 2. Exact outcome information size

`StructuredParticipantCountAgent` constructs `outcomeParticipantCountLedger` during extraction.

A participant count is accepted only from the **same LiteParse structured table row already accepted for quantitative effect extraction**. Two patterns are currently certifiable:

1. one unique total-participant column such as `Total N` or `Sample size`;
2. one unique intervention/treatment N column plus one unique control/comparator N column, which are summed.

Counts are rejected when:

- the quantitative estimate is not table-bound;
- the source document/table/row cannot be uniquely reconstructed;
- multiple total-N cells are plausible;
- arm-specific N columns are ambiguous;
- the count appears only in prose, abstract text, another row, or another table.

GRADE information size is automatically summed only when every independent study contributing to the outcome has exactly one `status=exact` count receipt.

### 3. Small-study-effect assessment

For an outcome with at least ten independent quantitative studies, MEDANTIR can run deterministic Egger regression using the actual effect and variance rows from the random-effects analysis.

The receipt records:

- k;
- intercept;
- intercept standard error;
- t statistic;
- degrees of freedom;
- two-sided p value;
- frozen analysis hash.

A prespecified `p < 0.10` asymmetry result becomes a unit-strength **small-study-effect signal** that the GRADE publication-bias policy may evaluate.

A non-significant Egger test does **not** automatically establish `no serious publication bias`. The domain remains unresolved because absence of detected small-study effects is not evidence that missing-study/publication processes are absent.

For fewer than ten studies the method is marked inapplicable and no publication-bias conclusion is generated.

## Publication-bias assessment basis

The public GRADE evidence API requires a source-bound publication-bias assessment basis. A protocol PICO receipt cannot be reused as publication-bias evidence.

Automatic Egger evidence is added to `publicationBiasEvidenceCatalog` with an explicit allowed use. Client-supplied signal weights are never accepted; the server controls the weight assigned to each certified signal.

## Artifacts

- `outcomeParticipantCountLedger`
- `participantCountExtractionQuality`
- `gradeOutcomeEvidence`
- `gradeAutomaticEvidenceReceipts`
- `publicationBiasEvidenceCatalog`

## Non-negotiable failure modes

MEDANTIR must not:

- infer directness from merely similar wording;
- derive outcome N from nearby prose or another table row;
- treat a negative funnel/asymmetry test as proof of no publication bias;
- let a model assign GRADE certainty directly;
- let automatically generated evidence bypass the prospective GRADE policy.

When an automatic rule cannot prove its preconditions, it must record `not-derived` and leave the relevant GRADE domain unresolved.
