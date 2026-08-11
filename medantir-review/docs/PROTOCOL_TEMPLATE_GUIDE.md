# Review Protocol Template Guide

## Template structure

Every generated protocol has a common methodological spine and a review-family-specific extension.

### Common sections

1. Administrative information, registration, version control, and amendments
2. Authors, affiliations, ORCID iDs, roles, and approvals
3. Funding, sponsor role, and competing interests
4. Rationale and existing-review landscape
5. Objectives and question framework
6. Eligibility criteria
7. Information sources
8. Search development, testing, and peer review
9. Record management and study-family linkage
10. Title and abstract screening
11. Full-text retrieval and eligibility
12. Data extraction and evidence provenance
13. Outcomes, variables, and effect measures
14. Risk of bias or critical appraisal
15. Synthesis and heterogeneity
16. Meta-bias and selective reporting
17. Certainty or confidence assessment
18. Equity, applicability, implementation, and stakeholder considerations
19. Data management, software, reproducibility, dissemination, and amendments

### Review-family extensions

| Review family | Mandatory specialist protocol content |
|---|---|
| Systematic | Estimand, eligible designs, effect measures, heterogeneity, sensitivity analyses |
| Intervention | PICO, intervention components, co-interventions, adherence, estimands, adverse effects |
| Diagnostic accuracy | PIRD, index test, reference standard, thresholds, flow and timing, paired accuracy synthesis |
| Overall prognosis | Starting point, time origin, prediction horizon, censoring, competing risks |
| Prognostic factor | Factor definition, measurement timing, adjustment sets, causal versus predictive interpretation |
| Prediction model | Model purpose, development versus validation, calibration, discrimination, updating, PROBAST domains |
| Prevalence and incidence | Case definition, denominator, sampling frame, period, person-time, transformation and design effects |
| Qualitative | Epistemology, phenomenon, context, sampling, reflexivity, synthesis method, CERQual |
| Mixed methods | Integration design, transformation, convergence, discordance, mixed-methods appraisal |
| Scoping | PCC, mapping objective, charting framework, consultation, optional appraisal |
| Rapid | Every abbreviation, expected bias, mitigation, verification sample, expansion trigger |
| Umbrella | Review eligibility, overlap, preferred-review rules, corrected covered area, discordance |
| Living | Surveillance frequency, update trigger, versioning, retirement criteria |
| Network meta-analysis | Node construction, transitivity, geometry, inconsistency, rankings, disconnected networks |
| Adverse effects | Harms taxonomy, exposure window, seriousness, rare events, zero events, duplicate safety reports |
| Economic | Perspective, price year, currency, discounting, time horizon, transferability, threshold |
| Implementation | Framework, strategy specification, determinants, fidelity, adaptations, mechanisms, outcomes |
| Mechanistic | Explicit causal chain, predicted observations, perturbations, competing mechanisms, triangulation |
| Animal | Species, strain, sex, age, model, clustering, randomisation, blinding, dose translation |
| Environmental | Exposure matrix, route, timing, co-exposure, human/animal/mechanistic streams, integration rules |
| Evidence map | Coding ontology, map axes, gap taxonomy, stakeholder prioritisation, update rules |

## Validation rules

A template is not registration-ready merely because every heading contains text. Validation must identify:

- unresolved placeholders;
- internally contradictory eligibility criteria;
- outcomes without time points or measures;
- synthesis methods incompatible with the included evidence;
- absent search sources;
- untested searches;
- incomplete search peer review;
- missing guarantor or corresponding author;
- absent amendment policy;
- missing software and reproducibility plan;
- registration fields that require live confirmation.

## Generated templates

The 21 complete Markdown templates are in `docs/protocol-templates/`. They can be regenerated from the TypeScript source with:

```bash
npm run generate:templates
```

The canonical source is `src/protocols/protocol-template-library.ts`; generated files should not be edited independently.
