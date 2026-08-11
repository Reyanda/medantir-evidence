# Reproducibility and Independent-Audit Benchmark Protocol

## Objective

Determine whether the Evidence Review Engine can:

1. reproduce a completed review from immutable reference inputs;
2. rerun a published review against current evidence interfaces without confusing database drift with error;
3. independently audit the source review and identify defensible discrepancies;
4. generalise across diseases, study designs, and review families.

## Benchmark modes

### Mode A: Frozen reproduction

This is the only mode that supports a claim of exact reproducibility.

Freeze:

- protocol and amendments;
- search strategies and search dates;
- raw database exports;
- duplicate clusters;
- title/abstract and full-text decisions;
- full-text corpus;
- extraction tables;
- risk-of-bias forms;
- analysis code and environment;
- certainty judgements;
- report tables and flow counts.

Every file receives a checksum. The engine must not query a live database during this mode unless the benchmark explicitly tests retrieval separately.

### Mode B: Live rerun

Run the original strategy against current interfaces. This mode measures currency and robustness, not exact equality.

Differences may arise from:

- database indexing changes;
- retractions or corrections;
- changed controlled vocabulary;
- interface and syntax changes;
- newly published studies;
- changed article versions;
- altered API/export behaviour.

The report must separate these from pipeline defects.

### Mode C: Independent audit

Two independent engine runs reconstruct the review without using the source review’s final decisions as prompts. Initial human verification is blinded. Unblinding occurs only for adjudication.

The audit may confirm the source review or produce an evidence-supported challenge. A challenge is not labelled a source-review error unless it has:

- source-level proof;
- replication across independent runs;
- exclusion of a pipeline defect;
- human adjudication;
- a versioned written rationale.

## Benchmark tiers

### Gold-data benchmarks

Open labelled datasets test individual stages with stable ground truth:

- SYNERGY for screening;
- CLEF TAR intervention and diagnostic tasks for prioritisation;
- Evidence Inference for evidence-span and clinical extraction;
- AHRQ SRDR projects for structured extraction and appraisal mappings.

### Silver-review benchmarks

Open WHO evidence packages test whole-review reconstruction. Candidate packages cover:

- mental health at work;
- child wasting and severe acute malnutrition;
- non-sugar sweeteners;
- tuberculosis screening;
- tuberculosis diagnostics;
- postpartum haemorrhage;
- school health services.

These are not assumed to have fully public search inputs. Exact reproduction requires onboarding frozen exports. Current searches belong in live-rerun mode.

### Method-conformance benchmarks

Authoritative handbooks test whether the pipeline chose and enforced the correct method. They are not numeric ground truth.

Included families:

- Cochrane intervention, diagnostic, prognosis, prediction, and qualitative methods;
- JBI scoping, mixed-methods, and umbrella reviews;
- Campbell evidence and gap maps;
- WHO rapid reviews;
- OHAT and Navigation Guide environmental reviews;
- SYRCLE animal reviews.

## Six-phase execution protocol

### B0. Eligibility and access audit

Confirm that reference materials can be lawfully used and that the benchmark has enough information for its stated mode.

Stop when a required reference output is unavailable or use is prohibited.

### B1. Freeze the reference package

Create:

- manifest;
- file checksums;
- source versions;
- software environment lockfile;
- source-to-artifact lineage graph.

No exact-reproduction test begins before this phase passes.

### B2. Reconstruct the review protocol

Encode:

- review family;
- question framework;
- eligibility criteria;
- evidence streams;
- search logic;
- unit of analysis;
- estimand;
- outcome definitions;
- time zero and follow-up;
- appraisal tool;
- synthesis model;
- certainty framework.

Unrecoverable critical choices are marked as unresolved rather than guessed.

### B3. Execute stage by stage

Each stage emits:

- input checksum;
- output checksum;
- software and agent version;
- parameters;
- timestamp;
- warnings;
- retry events;
- human decisions;
- lineage to source evidence.

### B4. Compare and classify differences

The difference taxonomy is:

1. exact match;
2. acceptable numeric or semantic tolerance;
3. database drift;
4. publication-version drift;
5. prespecified methodological discretion;
6. pipeline defect;
7. candidate source-review error;
8. unresolved.

### B5. Human adjudication

The reviewer receives proof packets rather than global approval prompts. Each packet contains:

- proposition;
- reference value;
- reproduced value;
- calculation or decision trace;
- cited source passages;
- applicable method rule;
- discrepancy classification;
- blinded metadata where configured.

The reviewer accepts, rejects, amends, or defers each item with rationale.

## Stage metrics

### Search

- known-study recall;
- precision where a complete retrieval set exists;
- translation fidelity across databases;
- PRESS defects;
- result/export count reconciliation;
- provenance completeness.

### Deduplication and study linkage

- duplicate precision, recall, and F1;
- false merges;
- missed duplicates;
- correct multiple-report clustering;
- reversible decisions.

### Screening

- sensitivity/recall;
- specificity;
- precision;
- F1;
- work saved over sampling at 95% recall;
- false exclusions by exclusion reason;
- inter-reviewer agreement;
- evidence and rationale completeness.

### Retrieval and PDF processing

- lawful retrieval yield;
- correct version selection;
- supplement completeness;
- text extraction accuracy;
- page and section mapping;
- table integrity.

### Extraction

- field accuracy;
- numerical tolerance;
- denominator correctness;
- evidence-span overlap;
- source-page validity;
- section coverage for rationale, objectives, results, discussion, and limitations;
- contradiction detection across report families.

### Risk of bias

- signalling-question agreement;
- domain agreement;
- overall agreement;
- evidence citation validity;
- factual extraction versus judgement separation.

### Synthesis

- eligible estimate set;
- effect-scale match;
- model-family match;
- dependency handling;
- pooled estimate and standard error tolerance;
- heterogeneity statistics;
- sensitivity and subgroup reproduction;
- numerical environment reproducibility.

### Certainty and reporting

- domain-level agreement;
- overall certainty agreement;
- rationale evidence;
- PRISMA count consistency;
- table and text consistency;
- audit and provenance completeness.

## Default acceptance thresholds

Defaults are initial engineering gates, not universal methodological truth:

- known-study recall: at least 0.95;
- deduplication precision and recall: at least 0.98;
- title/abstract recall: at least 0.95;
- full-text retrieval yield: at least 0.95 where legally available;
- core extraction field accuracy: at least 0.90;
- numerical extraction within tolerance: at least 0.98;
- required evidence-section coverage: 1.00;
- risk-of-bias domain agreement after adjudication: at least 0.80;
- certainty-domain agreement after adjudication: at least 0.80;
- PRISMA and provenance consistency: 1.00.

Each benchmark can tighten or replace these thresholds.

## Multidisease sampling strategy

The benchmark portfolio should be stratified rather than randomly assembled. Include:

- infectious disease;
- nutrition and metabolic disease;
- maternal health;
- child and adolescent health;
- mental health;
- environmental health;
- diagnostics;
- prognosis and prediction;
- qualitative and implementation questions;
- animal and mechanistic evidence.

Within each stratum, select cases with strong open reference artefacts, methodological diversity, and enough complexity to expose pipeline errors.

## Leakage prevention

For independent audit:

- final included-study labels are hidden during screening;
- source extraction tables are hidden during extraction;
- source risk-of-bias and GRADE decisions are hidden during judgement;
- the published pooled result is hidden during analysis;
- benchmark maintainers keep a sealed oracle package;
- prompts, model versions, and tool calls are logged;
- benchmark cases used for development are separated from held-out evaluation cases.
