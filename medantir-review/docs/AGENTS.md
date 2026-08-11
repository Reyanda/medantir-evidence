# Agent Registry

| Agent | Stage | Main responsibility | Failure boundary |
|---|---|---|---|
| QuestionAgent | question | Validate and normalise the research question | Missing title or objective |
| ResearcherIdentityAgent | identity | Resolve authenticated researcher identity and ORCID requirements | Required authenticated ORCID unavailable |
| ProtocolAgent | protocol | Select review-family standards, modules, appraisal, certainty, and synthesis plan | Unsupported or incomplete plan |
| ReviewLandscapeAgent | review-landscape | Recommend de novo, update, adopt/adapt, overview, or living-update route | Reuse without directness, currency, trustworthiness, or extractability |
| ProtocolDraftAgent | protocol-draft | Generate a cited common and review-family-specific protocol | Missing mandatory section or unresolved placeholder |
| SearchBuildAgent | search-build | Produce database-specific syntax and mark search purpose | Missing concepts or uncertified syntax |
| SearchStrategyTestAgent | search-test | Test syntax, concept coverage, and peer-review status | Invalid syntax or unresolved required peer review |
| ProtocolFinaliseAgent | protocol-finalise | Freeze the protocol, field maps, citations, and file checksums | Failed search test or incomplete finalisation |
| ProtocolRegistrationAgent | register-protocol | Select registry routes, submit approved packages, and issue receipts | Ineligible target, missing identity, pending peer review, credential or external failure |
| SearchExecuteAgent | search-execute | Execute approved adapters and reconcile exports | Adapter absence, timeout, or result/export mismatch |
| DeduplicationAgent | deduplicate | Merge duplicate records and preserve source provenance | False merge or study-family ambiguity |
| TiabScreeningAgent | tiab-screen | Decide title/abstract eligibility with evidence, reasons, and confidence | False exclusion or unsupported decision |
| FullTextRetrievalAgent | fulltext-retrieve | Retrieve lawful full text and report missing items | Access restriction or unresolved report |
| PdfToTextAgent | pdf-to-text | Produce page-indexed text and section maps | Empty, corrupt, or structurally lost text |
| FullTextScreeningAgent | fulltext-screen | Apply full-text eligibility and document exclusions | Unclear criteria or companion-report ambiguity |
| ExtractionAgent | extract | Extract structured data and section-specific proof | Contradictory, missing, or uncited values |
| RiskOfBiasAgent | risk-of-bias | Apply review-family appraisal with cited evidence | Unsupported judgement or missing signalling information |
| SynthesisAgent | synthesise | Run safe generic fixtures or route to a specialist adapter | Incompatible estimand, model family, or variance structure |
| GradeAgent | grade | Apply the configured certainty framework per outcome or finding | Unsupported downgrade or upgrade |
| ReportAgent | report | Produce a draft report and evidence appendices | Missing or inconsistent upstream artefacts |
| HumanVerificationAgent | human-verify | Present every decision with proof and collect adjudicated verdicts | Missing rationale, rejection, deferral, or unresolved amendment |


## Protocol and registration agents

### ResearcherIdentityAgent

Resolves an authenticated identity through `ResearcherIdentityPort`. The workflow receives the ORCID iD, provider, scopes, and verification time, not the password or OAuth token.

### ProtocolDraftAgent

Combines the common protocol blueprint with the selected review-family extension. It attaches methodological citations and validation rules to every section.

### SearchStrategyTestAgent

Runs deterministic or live-adapter tests against every database strategy. It records syntax validity, covered and missing concepts, warnings, errors, pilot counts, test time, and peer-review status.

### ProtocolFinaliseAgent

Creates the immutable protocol package, whole-package checksum, file checksums, `CITATION.cff`, `.zenodo.json`, and machine-readable field maps for all registration targets.

### ProtocolRegistrationAgent

Builds a target-by-target eligibility plan and uses configured adapters. It fails closed when mandatory search peer review remains pending. It produces receipts and a no-secrets ledger for prepared, draft, submitted, published, ineligible, awaiting-human, and failed outcomes.

## Review Landscape Agent

The landscape agent implements a WHO-like commission gate before primary-study searching. It scores existing reviews on:

- question directness;
- population, intervention/exposure/test, and outcome match;
- search currency;
- AMSTAR 2, ROBIS, INSPECT-SR, or custom trustworthiness assessment;
- reproducible search availability;
- extractable study-level data;
- risk-of-bias and certainty assessment availability.

Its output is a `ReviewCommissionDecision`. The decision always requires human approval unless explicitly pre-authorised.

## Synthesis safety routing

The generic fixture computes only an ordinary effect meta-analysis. The following modes are blocked until a specialist adapter is connected:

- bivariate or HSROC diagnostic synthesis;
- network meta-analysis;
- prognosis by time origin and horizon;
- prediction-model performance synthesis;
- prevalence/incidence synthesis;
- qualitative synthesis;
- mixed-methods integration;
- umbrella-review overlap synthesis;
- economic normalisation;
- mechanistic causal-step synthesis.

This prevents plausible-looking but methodologically invalid pooling.

## Human Verification Agent

The final agent supports:

- blinded and unblinded verification;
- item-level decisions rather than one global approval button;
- mandatory human rationale;
- page-level excerpts and section labels;
- evidence coverage across rationale, objectives, results, discussion, and limitations;
- rejection that blocks report closure;
- amendment through a versioned human-override ledger;
- rollback to the earliest affected stage;
- regeneration and a fresh verification round.

See `HUMAN_VERIFICATION_PROTOCOL.md`.

## Benchmark components

Benchmarking is implemented outside the scientific stage chain so it cannot alter the review it is evaluating:

- `benchmark/catalog.ts`: gold datasets, silver whole-review cases, and method-conformance cases;
- `benchmark/protocol.ts`: frozen reproduction, live rerun, and independent audit protocols;
- `benchmark/evaluator.ts`: stage metrics and discrepancy classification;
- human verification: final adjudication of candidate errors.

## Adapter boundary

Agents depend on ports rather than automating proprietary interfaces directly:

- `ResearcherIdentityPort`;
- `SearchStrategyTestingPort`;
- `ProtocolRegistryAdapter`;
- `CredentialVaultPort`;
- `EvidenceSourceAdapter`;
- `FullTextRetrievalPort`;
- `PdfTextExtractionPort`;
- `HumanDecisionPort`;
- `HumanVerificationPort`.

Credentials, institutional access, vendor-specific browser logic, and reviewer interfaces remain outside the scientific workflow.
