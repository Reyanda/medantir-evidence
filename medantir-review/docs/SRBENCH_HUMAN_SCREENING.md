# SRBench frozen human-screening benchmark

This workflow builds a real title/abstract screening benchmark from the dual-human validation sample published with the 2026 Nature Medicine review of large language models in clinical medicine.

The benchmark source is not copied into the MEDANTIR repository. Instead, MEDANTIR pins the external public Git repository at one full commit SHA and verifies the exact Git blob SHA of each required source before materializing any local benchmark artifact.

## Frozen source identities

Repository:

`nyuolab/llms-in-clinical-medicine-systematic-review`

Commit:

`69597fdd1dd2cd45417446997af5af671853e2ec`

Required blobs:

| Role | Path | Git blob SHA |
|---|---|---|
| Human screener group 1 | `Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Screener Group 1.csv` | `daaa8b1d274fd1cd3df9da22a9bec27d318bbf08` |
| Human screener group 2 | `Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Screener Group 2.csv` | `7b07436c32aa96685035e18998570c0ecf315939` |
| Human adjudication | `Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Tiebreaks.csv` | `d18c9a588ed5df2fec607a663cf09cb8159bb401` |
| Screening contract | `Prompts/screening_instructions.txt` | `0f56006f2b019e6d7531866805d7e6fc5e801c30` |

For every downloaded object the materializer recomputes the Git blob SHA and a SHA-256 content identity (`HOBJ-<sha256>`). A moving branch, changed file, proxy rewrite, or corrupted download therefore fails before benchmark gold is created.

## Human-gold reconstruction

The materializer independently recreates the historical human validation ledger:

1. parse both human screening CSVs with quoted-newline-safe CSV parsing;
2. require unique titles within each screener file;
3. take the exact title intersection;
4. require identical source abstract text for matching titles;
5. use the shared decision when both screeners agree;
6. require a frozen `Final Decision` from the tiebreak CSV when they disagree;
7. fail if any disagreement lacks adjudication;
8. assign deterministic `LLMCLINICAL-####` record IDs after canonical title sorting;
9. write model input and hidden gold to separate files;
10. bind the complete title/abstract screening stage to both the model gold and the immutable source-manifest receipt.

False-negative exclusions are fatal under the classification scorer.

## Materialize the 500-record case

From `medantir-review`:

```bash
npm run benchmark:sr:materialize-llm-clinical
```

The default output is:

```text
artifacts/srbench-cases/llm-clinical-2026-human-screening/
  source-manifest.json
  input.json
  gold.json
  case.json
  suite.json
```

The generated `source-manifest.json` records all immutable source objects, reconstruction counts, source-manifest hash and materialization hash.

The generated suite intentionally contains no qualification corpus. It is a **real published-review validation stress test**, but it cannot contribute to production promotion because the historical review did not have every classical SR100 qualification plane. This prevents a strong screening benchmark from being misrepresented as a complete review reproduction benchmark.

## Validate before inference

```bash
SRBENCH_SUITE='artifacts/srbench-cases/llm-clinical-2026-human-screening/suite.json' \
npm run benchmark:sr:validate
```

Do not run models if source materialization or suite validation fails.

## Run multiple models against the same frozen 500 records

```bash
SRBENCH_SUITE='artifacts/srbench-cases/llm-clinical-2026-human-screening/suite.json' \
SRBENCH_MODELS='model-a,model-b,model-c' \
SRBENCH_ENDPOINT='http://127.0.0.1:20128/v1' \
SRBENCH_REPEATS=3 \
npm run benchmark:sr
```

Every model sees the same source records and screening contract. Gold, scorer and critical-failure metadata remain sealed behind the benchmark port.

## Report screening safety

```bash
npm run benchmark:sr:summary
```

For each model, the performance summary reports run-level screening sensitivity, the lower 95% Wilson bound, false-negative rate, and conservative missed-study burden per 1,000 candidate records in addition to reproduction score and counterfactual-canary performance.

Repeated executions of the same 500 records are **not pooled** as if they created a larger validation sample. Three repeats remain three stability observations of the same evidence set, not an independent n=1,500 experiment.

## Relationship to SR100 promotion

This specialist benchmark improves evidence about one critical capability but does not satisfy SR100 promotion by itself.

The default `MEDANTIR-SR100` v1.1.0 policy separately requires the model to be directly evaluated on question, protocol, search, title/abstract screening, full-text screening, extraction, appraisal and report generation across at least three distinct complete review hashes and three distinct scientific domains per stage. Deterministic deduplication and statistical synthesis software remain outside required model capability coverage.
