# Execution Protocols

## Protocol 0: Governance and run initiation

Every run receives an immutable run ID, declared review family, structured question, selected databases, commission preferences, verification mode, and approval policy. Inputs and outputs are hashed. No agent may silently change eligibility, searches, study identity, extraction, synthesis settings, or human amendments.

## Protocol 1: Researcher identity and ORCID

**Output:** `ResearcherIdentity`.

The stage resolves the guarantor or corresponding author, validates the ORCID checksum, and records whether the iD was authenticated. Passwords and raw tokens are prohibited from review artifacts. Registration can require authenticated ORCID as a policy gate.

## Protocol 2: Question and methodology selection

**Output:** `ReviewPlan` containing the question framework, standards, evidence streams, appraisal tools, certainty framework, synthesis mode, required modules, eligibility criteria, and methodology warnings.

## Protocol 3: Existing-review landscape and commission route

Candidate reviews are appraised for directness, currency, trustworthiness, reproducibility, and extractability. Outputs are de novo, update, adopt/adapt, overview, or living update. The route is retained in the protocol and audit record.

## Protocol 4: Cited protocol development

The engine generates a review-family-specific protocol using a common governance spine and specialist sections. Every section stores its purpose, draft content, required status, validation rules, and citations. Unresolved placeholders remain visible and block finalisation where material.

## Protocol 5: Database-specific search construction

The Search Builder translates concepts into database-native syntax for each selected database and platform. It labels the strategy purpose and preserves the exact query.

## Protocol 6: Search testing and peer review

Each strategy is tested for syntax, field tags, Boolean structure, concept coverage, and pilot metadata. PRESS-style independent peer review can be required. A definitive registration and search are blocked while required peer review is pending.

## Protocol 7: Protocol finalisation and checksum

The final package includes Markdown, structured JSON, searches, test results, citation metadata, registry field maps, `CITATION.cff`, `.zenodo.json`, a whole-package checksum, and file-level checksums.

## Protocol 8: Registration planning and execution

PROSPERO is treated as a prospective registry where current eligibility permits. OSF is the general registration route. Zenodo is an archival DOI layer. GitHub provides version control and releases. Actions support prepare-only, draft, and submit modes. Each action produces a receipt and no-secrets ledger.

## Protocol 9: Search execution and troubleshooting

An approved API or browser adapter must authenticate lawfully, execute the frozen strategy, capture provenance, reconcile result and export counts, retry transient failures, and stop for CAPTCHAs, inaccessible licensed content, material syntax repairs, or unresolved mismatches.

## Protocol 10: Record identity and study-family linkage

Record deduplication and study linkage are separate operations. DOI, PMID, title, author, year, journal, registration, and fuzzy matching support duplicate detection. Protocols, abstracts, preprints, primary reports, follow-up reports, and companion analyses are linked to a study family rather than deleted.

## Protocol 11: Title and abstract screening

Each decision returns include, exclude, or uncertain with:

- reason;
- confidence;
- title/abstract proof;
- reviewer or agent identity;
- version and timestamp.

False exclusions are safety-critical. Low-confidence decisions route to independent review.

## Protocol 12: Full-text retrieval and conversion

Retrieval uses lawful sources only. Missing documents remain explicit. Native extraction is preferred and OCR is a fallback. Parsed documents preserve pages, headings, tables where possible, and the sections rationale, objectives, methods, results, discussion, and limitations.

## Protocol 13: Full-text eligibility

Every exclusion requires a review-compatible reason and page-level proof. Companion-report and overlapping-cohort uncertainty must be resolved before synthesis. Full-text approval is a mandatory human gate unless pre-authorised.

## Protocol 14: Evidence-bound extraction

Extraction separates reported from derived values and stores page-level proof. Required evidence bundles cover:

- rationale;
- objectives;
- results;
- discussion;
- limitations.

Contradictions, units, denominators, time points, outcome variants, and multiple reports are represented explicitly.

## Protocol 15: Risk of bias and trustworthiness

Tool selection follows review family and design. Supported profiles include RoB 2, ROBINS-I/E, QUADAS-2/C, QUIPS, PROBAST, CASP, JBI, MMAT, ROBIS, AMSTAR 2, SYRCLE, OHAT, and Navigation Guide. Factual signalling evidence remains separate from judgement.

## Protocol 16: Synthesis

The engine first validates:

- estimand;
- effect scale;
- outcome definition;
- follow-up or prediction horizon;
- dependency structure;
- study design;
- model assumptions.

Ordinary inverse-variance pooling is never substituted for diagnostic, prognosis, prediction, prevalence, network, qualitative, umbrella, economic, or mechanistic synthesis. Missing specialist capability produces `deferred-specialist`, not a fabricated result.

## Protocol 17: Certainty and decision support

The configured framework is GRADE, GRADE-DTA, GRADE prognosis, GRADE-CERQual, OHAT, or none. Every judgement links to extracted results, limitations, risk of bias, and synthesis. Evidence-to-Decision remains a separate layer so evidence is not confused with policy judgement.

## Protocol 18: Draft reporting

The report contains methodology profile, commission decision, search strategies, provenance, deduplication, screening, excluded studies, study families, extraction proof, appraisal, synthesis, certainty, flow counts, limitations, and audit history.

## Protocol 19: Human verification and closure

Every proposed decision is verified individually. The reviewer accepts, rejects, amends, or defers with written rationale. Blinded mode hides bibliographic and model identity while retaining proof. Amendments create a versioned override, invalidate downstream outputs, and trigger a fresh verification round.

## Supported review profiles

The engine contains profiles for:

- general systematic;
- intervention;
- diagnostic accuracy;
- overall prognosis;
- prognostic factor;
- prediction model;
- prevalence/incidence;
- qualitative;
- mixed methods;
- scoping;
- rapid;
- umbrella;
- living;
- network meta-analysis;
- adverse effects;
- economic;
- implementation;
- mechanistic;
- animal;
- environmental;
- evidence map.

See `METHODS_CROSSWALK.md` for the full mapping and `BENCHMARK_PROTOCOL.md` for reproducibility testing.
