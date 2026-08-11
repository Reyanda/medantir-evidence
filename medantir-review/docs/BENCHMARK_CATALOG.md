# Benchmark Catalogue

The machine-readable catalogue is in `src/benchmark/catalog.ts`.

## Ready open stage-level benchmarks

| Case | Main stages | Use |
|---|---|---|
| SYNERGY screening collection | Deduplication and title/abstract screening | Cross-review recall and prioritisation regression testing |
| CLEF TAR intervention tasks | Title/abstract prioritisation | High-recall intervention screening |
| CLEF TAR diagnostic tasks | Title/abstract prioritisation | Diagnostic-review screening behaviour |
| Evidence Inference 2.0 | PDF evidence spans and extraction | Source-grounded clinical extraction |
| AHRQ SRDR projects | Extraction and appraisal | Project-specific structured extraction after snapshot onboarding |

## WHO whole-review benchmark candidates

| Case | Disease area | Review complexity |
|---|---|---|
| Mental health at work | Mental and occupational health | Existing-review appraisal, quantitative and qualitative evidence |
| Wasting and nutritional oedema | Child nutrition and SAM | Multiple intervention, prognosis, implementation, and policy questions |
| Non-sugar sweeteners | Nutrition and metabolic health | Trial and observational evidence streams |
| Tuberculosis screening | Infectious disease | Screening accuracy and patient-important outcomes |
| Tuberculosis diagnostics | Infectious disease | Multiple tests, thresholds, and reference standards |
| Postpartum haemorrhage | Maternal health | Intervention effects, harms, GRADE, and recommendation linkage |
| School health services | Child and adolescent public health | Complex intervention and context coding |

These packages are open reference products, but some original searches used subscription databases. Therefore:

- frozen exports are required for exact reproduction;
- current database searches are evaluated as live reruns;
- method handbooks are used for conformance;
- inaccessible inputs are recorded rather than silently reconstructed.

## Method-conformance cases

- Cochrane intervention reviews;
- Cochrane diagnostic test accuracy;
- Cochrane prognosis and prediction;
- Cochrane-Campbell qualitative synthesis;
- JBI scoping reviews;
- JBI mixed-methods reviews;
- JBI umbrella reviews;
- Campbell evidence and gap maps;
- WHO rapid reviews;
- OHAT environmental health;
- Navigation Guide environmental health;
- SYRCLE animal studies.

## Onboarding a published review

A candidate becomes benchmark-ready only after:

1. the exact review version is identified;
2. all accessible reference artefacts are inventoried;
3. raw exports and analysis files are frozen where available;
4. the review is decomposed into question-specific units;
5. study and report identifiers are normalised;
6. expected outputs are converted into machine-readable targets;
7. unavailable or licensed inputs are documented;
8. a human curator signs the benchmark manifest;
9. a second curator independently verifies the oracle package;
10. development and held-out splits are assigned.
