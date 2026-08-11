# MEDANTIR SRBench

SRBench evaluates whether a model can reproduce frozen systematic-review pipeline artifacts under deterministic scientific grading.

## Core rule

A high score and a complete benchmark are different things.

- **Reproduction score**: accuracy on tasks with a frozen gold artifact.
- **Pipeline coverage**: percentage of the full systematic-review pipeline for which the benchmark has complete independently bound gold.
- **Effective score**: `reproduction score × pipeline coverage / 100`.
- **SR100**: reproduction score = 100, pipeline coverage = 100, every task exact, and zero critical/fatal scientific failures.

A model cannot receive SR100 from a partially reconstructed historical review.

## Pipeline weights

| Stage | Weight |
|---|---:|
| Question | 5 |
| Protocol | 5 |
| Search | 15 |
| Deduplication | 5 |
| Title/abstract screening | 15 |
| Full-text screening | 10 |
| Extraction | 15 |
| Appraisal | 10 |
| Synthesis | 15 |
| Report | 5 |

Complete gold receives the full stage weight, partial gold receives half for coverage reporting, and missing gold receives zero. Partial/missing gold can never produce SR100.

## Deterministic grading

SRBench does not use another language model as judge. Tasks are scored with frozen deterministic validators:

- exact canonical JSON identity;
- exact set identity plus precision/recall/F1 diagnostics;
- classification ledgers with TP/FP/TN/FN and explicit false-negative safety gates;
- prespecified numeric tolerances.

Gold receipt hashes are derived from the hidden stage gold artifacts and scoring contracts. A case that marks a stage complete without a matching gold receipt is rejected.

Before spending model tokens, validate the entire suite:

```bash
npm run benchmark:sr:validate
```

This resolves file-backed inputs/gold, recomputes complete-stage receipts, case hashes, the suite hash and pipeline coverage, and writes `artifacts/srbench/srbench-validation.json`.

## Screening safety is not average accuracy

Systematic-review screening is asymmetric: a false inclusion costs reviewer time, but a false exclusion can permanently remove relevant evidence. For that reason SRBench does not interpret high accuracy, F1, Cohen's kappa or a high mean reproduction score as sufficient screening safety.

For every title/abstract or full-text classification task that contains both gold-positive and gold-negative records, the performance summary computes a separate run-level screening-safety report containing:

- observed sensitivity and false-negative rate;
- a 95% Wilson interval for sensitivity;
- observed missed eligible studies per 1,000 candidate records;
- a conservative missed-study burden combining the upper 95% prevalence bound with the lower 95% sensitivity bound;
- a prespecified high-recall pass/fail gate.

The default `MEDANTIR-SCREENING-HIGH-RECALL` policy requires observed sensitivity >=95%, sensitivity lower 95% bound >=90%, observed false-negative rate <=5%, and conservative missed-study burden <=50 per 1,000 candidates.

These metrics **do not relax SR100**. If the task scorer marks false-negative exclusions fatal, one false exclusion still blocks SR100 regardless of the safety summary. The safety layer exists to discriminate among near-perfect models and quantify the scientific burden hidden by strong average metrics.

Repeated executions of the same records are never pooled into a larger binomial sample. Each task-run retains its own uncertainty interval and the model summary reports the worst run-level safety values. Repeating the same 500 records three times therefore cannot masquerade as an independent n=1,500 validation set.

After a tournament, produce the compact model-level readout with:

```bash
npm run benchmark:sr:summary
```

This writes `artifacts/srbench/srbench-performance-summary.json` with reproduction, pipeline coverage, SR100 rate, screening-safety burden, counterfactual-canary performance, contamination flags and qualification promotion tier.

## Model endpoints

The runner uses an OpenAI-compatible `/chat/completions` endpoint. This allows the same suite to run through OmniRoute, a local compatible server, or a pinned provider endpoint.

```bash
SRBENCH_MODELS='model-a,model-b,auto/reasoning:free' \
SRBENCH_ENDPOINT='http://127.0.0.1:20128/v1' \
SRBENCH_API_KEY='your-gateway-key' \
SRBENCH_REPEATS=3 \
npm run benchmark:sr
```

Optional OmniRoute budget headers:

```bash
SRBENCH_BUDGET_USD_PER_REQUEST=0.000001 \
SRBENCH_BUDGET_FALLBACK=strict \
SRBENCH_MODELS='auto/reasoning:free,auto/coding:free' \
npm run benchmark:sr
```

The adapter sends `temperature=0`, requests raw JSON only, disables OmniRoute memory/cache during benchmarking, and records requested model, actual routed model, provider, request ID, latency, token counts, cost where exposed, and request/output hashes. Invalid JSON and Markdown-fenced JSON count as model failures rather than being repaired by the benchmark harness.

## Current v1 cases

### `SRBENCH-FIXTURE-001`

A synthetic 100%-coverage case used only to falsify the benchmark machinery. It spans all ten pipeline stages. It is **excluded from model promotion**.

### `SRBENCH-JAK-COVID-2021`

A real published JAK-inhibitor/COVID-19 systematic review. Its current pipeline coverage is **47.5%**. Source-bound appraisal is complete; question/protocol/search/dedup/screening/synthesis/report have partial historical gold; complete source-authorized extraction remains missing. Even perfect model performance on the currently scored task cannot produce SR100.

As the historical-replay work reconstructs exact source reports, parser checkpoints, study-by-outcome rows and RevMan synthesis inputs, this case should be upgraded stage-by-stage rather than replaced.

## Promotion policy

The default `MEDANTIR-SR100` promotion policy requires:

- at least 3 complete **published-review** cases;
- at least 3 distinct frozen review hashes, not merely different labels;
- at least 3 distinct scientific domains;
- at least 3 distinct repeat indices per complete review hash;
- every included run must be SR100;
- zero critical scientific failures;
- one pinned actual model identity across validation runs.

Passing these checks makes the model eligible for **supervised prospective review use**. SRBench v1 deliberately does not grant autonomous scientific authority from benchmark performance alone.

## Living-review drift sentinel

Living-review eligibility requires a current, hash-bound sentinel receipt. A boolean environment flag is not accepted.

A sentinel is bound to:

- the exact SRBench suite hash;
- requested model identity;
- one pinned actual model;
- held-out 100%-coverage canary case hashes;
- exact canary run hashes;
- zero critical failures;
- an issuance and expiry time.

It can be minted only when every selected canary run is SR100. The minting command also refuses to use published-review validation cases as operational canaries.

After a tournament containing held-out canary cases:

```bash
SRBENCH_SENTINEL_MODEL='model-a' \
SRBENCH_CANARY_CASE_IDS='canary-1,canary-2' \
SRBENCH_SENTINEL_TTL_HOURS=168 \
npm run benchmark:sr:mint-sentinel
```

Then supply the resulting receipt on the next tournament:

```bash
SRBENCH_MODELS='model-a' \
SRBENCH_DRIFT_SENTINEL_FILE='artifacts/srbench/drift-sentinel-model-a.json' \
npm run benchmark:sr
```

Missing, duplicate, tampered, suite-mismatched, model-mismatched or expired sentinel receipts cannot elevate the model to `supervised-living-review-eligible`.

## Why repeated/multi-review SR100 matters

One historical review can be memorized, unusually easy, poorly discriminating, or fail to expose a model's weaknesses. Multiple domains and repeated runs test generalization and stability. Critical failures are never averaged away: one false exclusion, provenance fabrication, or other critical task failure blocks SR100 for that run.

The benchmark is intended to validate the **model-plus-MEDANTIR scientific workflow**, not replace deterministic software with a language model. Database execution, immutable hashing, deterministic deduplication rules, statistical formulas and forensic receipts should remain authoritative software components. Model-dependent reasoning is tested where models actually participate in question/protocol interpretation, search formulation, evidence decisions, extraction/appraisal and structured reporting.

## Outputs

`npm run benchmark:sr` writes:

- `artifacts/srbench/srbench-tournament.json`
- `artifacts/srbench/srbench-leaderboard.json`
- `artifacts/srbench/srbench-promotion.json`
- `artifacts/srbench/srbench-drift-sentinels.json`

`npm run benchmark:sr:summary` additionally writes:

- `artifacts/srbench/srbench-performance-summary.json`

These retain the suite hash, case hashes, routing identities, stage scores, critical failures, SR100 status, screening-safety uncertainty, sentinel verification and promotion dossiers for independent audit.
