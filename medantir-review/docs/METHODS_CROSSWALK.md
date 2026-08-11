# Authoritative Review-Methods Crosswalk

## Purpose

This crosswalk converts recurring design patterns from WHO guideline evidence work, Cochrane methods, JBI evidence synthesis, Campbell reviews, environmental-health frameworks, and preclinical review methods into executable requirements for the Evidence Review Engine.

The objective is not to force every evidence question through one generic systematic-review workflow. The engine first identifies the review family and then activates the relevant question framework, evidence streams, appraisal tools, synthesis model, certainty framework, reporting standards, and human gates.

## Cross-ecosystem findings encoded in the engine

### 1. Decide whether a new review is necessary

WHO guideline evidence workflows commonly begin by identifying existing systematic reviews and judging whether they are sufficiently direct, current, trustworthy, and extractable. A new primary-study review is only one possible route.

The engine now makes an explicit commission decision:

- `de-novo`
- `update`
- `adopt-adapt`
- `overview`
- `living-update`

Candidate reviews are scored for:

- question and PICO/PIRD/PICOTS directness;
- search currency;
- trustworthiness;
- reproducibility of the search;
- availability of study-level data;
- risk-of-bias assessment;
- certainty assessment.

The decision remains a human approval gate.

### 2. Review families require different protocols

Cochrane, JBI, and Campbell do not treat all reviews as ordinary intervention reviews. The engine now supports 21 profiles.

| Review family | Question framework | Appraisal | Synthesis | Certainty/reporting safeguards |
|---|---|---|---|---|
| General systematic | PICO or PECO | RoB 2, ROBINS-I, ROBINS-E | Effect meta-analysis or structured narrative | GRADE, PRISMA 2020, PRISMA-S |
| Intervention | PICO | RoB 2, ROBINS-I | Pairwise meta-analysis | GRADE |
| Diagnostic accuracy | PIRD | QUADAS-2, QUADAS-C | Bivariate or HSROC | GRADE-DTA, PRISMA-DTA |
| Overall prognosis | PICOTS | QUIPS adapted to prognosis | Absolute-risk/time-horizon synthesis | GRADE prognosis |
| Prognostic factor | PICOTS | QUIPS | Adjusted association synthesis | GRADE prognosis |
| Prediction model | PICOTS | PROBAST | Calibration/discrimination meta-analysis | TRIPOD-SRMA |
| Prevalence/incidence | CoCoPop | JBI prevalence appraisal | Proportion/rate meta-analysis | Denominator and sampling safeguards |
| Qualitative | SPIDER | CASP or JBI | Thematic, framework, or meta-ethnographic synthesis | GRADE-CERQual, ENTREQ |
| Mixed methods | SPICE | MMAT plus design-specific tools | Convergent integrated or segregated | Quantitative and qualitative certainty kept distinct |
| Scoping | PCC | Optional, if prespecified | Mapping/charting | PRISMA-ScR |
| Rapid | PICO | Design-specific | Prespecified abbreviated synthesis | PRISMA-RR; every shortcut logged |
| Umbrella | PCC | ROBIS, AMSTAR 2 | Review-level synthesis | Primary-study overlap correction, PRIOR |
| Living | PICO | Design-specific | Versioned update synthesis | Surveillance triggers and retirement rules |
| Network meta-analysis | PICO | RoB 2, ROBINS-I, CINeMA domains | Network model | Connectivity, transitivity, coherence |
| Adverse effects | PICO/PECO | RoB 2, ROBINS-I/E | Rare-event or harms synthesis | Harms-specific search and outcome handling |
| Economic | PICO | JBI economic or CHEC | Cost and economic model synthesis | Currency, price year, perspective, discounting |
| Implementation | SPICE | MMAT/JBI | Mixed-methods integration | Strategy, determinant, mechanism, context separated |
| Mechanistic | Mechanism-context-outcome | Mechanistic credibility domains | Causal-step synthesis | Effect evidence kept separate from mechanism evidence |
| Animal | PICO | SYRCLE | Animal meta-analysis | Species, strain, sex, clustering, translation |
| Environmental | PECO | OHAT or Navigation Guide | Human, animal, mechanistic streams | Stream-specific confidence and integration |
| Evidence map | PCC | Optional | Ontology-based mapping | Frozen map dimensions and coding rules |

### 3. Study reports are not the same as studies

Review implementations repeatedly require linking:

- conference abstract to full publication;
- protocol to results report;
- preprint to journal article;
- primary outcome report to follow-up report;
- multiple articles from one cohort or trial;
- overlapping cohorts across publications.

The engine retains record-level provenance but requires a study-family linkage module before extraction and synthesis. Deduplication may remove duplicate records; it must not delete distinct reports from the same study.

### 4. Synthesis must be type safe

A frequent automation failure is to pool any available number. The engine now allows simple common-effect inverse-variance pooling only for the generic effect-meta-analysis fixture. It blocks and names a specialist adapter for:

- diagnostic bivariate/HSROC synthesis;
- network meta-analysis;
- prognosis by time horizon;
- prediction-model performance;
- prevalence and incidence;
- qualitative synthesis;
- mixed-methods integration;
- umbrella-review overlap;
- economic normalisation;
- mechanistic causal-step synthesis.

A blocked specialist synthesis is a valid pipeline state. It is safer than generating an invalid pooled result.

### 5. Certainty is review-family specific

The certainty stage is configured as one of:

- GRADE;
- GRADE-DTA;
- GRADE prognosis;
- GRADE-CERQual;
- OHAT confidence;
- none, where a certainty framework is not required.

Scoping reviews and evidence maps do not automatically acquire risk-of-bias or GRADE stages. Animal and mechanistic reviews are not assigned conventional intervention GRADE by default.

### 6. Rapid review is not “systematic review but faster”

Rapid-review constraints must be explicit protocol variables. Examples include:

- reduced database coverage;
- date or language restrictions;
- single screening with verification;
- focused outcomes;
- use of an existing review as a base;
- abbreviated stakeholder engagement.

The benchmark scores whether shortcuts were declared, justified, and tested for likely bias. Speed alone is not a validity metric.

### 7. Guideline evidence requires a decision layer

WHO-commissioned evidence products usually extend beyond effect estimates. The complete architecture therefore distinguishes:

1. evidence review;
2. certainty assessment;
3. evidence-to-decision considerations;
4. recommendation formulation;
5. implementation and update planning.

The current code covers review and certainty orchestration. A production Evidence-to-Decision adapter should additionally model benefits, harms, values, resources, cost-effectiveness, equity, acceptability, feasibility, and contextual transferability.

## Sources represented in the crosswalk

The implementation is grounded in the following authoritative families:

- WHO Handbook for Guideline Development and WHO normative-product methods;
- WHO rapid-review guidance;
- WHO commissioned evidence packages and guideline annexes;
- Cochrane Handbook for Systematic Reviews of Interventions;
- Cochrane diagnostic test accuracy methods;
- Cochrane prognosis and prediction-model methods;
- Cochrane-Campbell qualitative evidence synthesis methods;
- JBI Manual for Evidence Synthesis, including scoping, prevalence, mixed-methods, and umbrella reviews;
- Campbell systematic-review and evidence-and-gap-map methods;
- OHAT Handbook;
- Navigation Guide;
- SYRCLE animal-study risk-of-bias methods;
- PRISMA 2020 and relevant extensions.

## Important boundary

This crosswalk describes authoritative method families and representative commissioned-review patterns. It does not claim that every review ever conducted was individually inspected. Each benchmark case must still freeze the exact source review, methods version, inputs, and outputs before it can serve as a reproducibility oracle.
