# MEDANTIR autonomy completion plan

## Definition

MEDANTIR should be described as fully autonomous only when it can execute a complete review loop without unrecorded manual operations while stopping at explicit scientific, legal, or accountability gates.

Autonomy does not mean removing all humans. It means that the system can plan, execute, recover, verify, and update work independently, while every gate that requires independent judgement is presented with complete evidence and an attributable decision path.

## Current position

The repository now has substantial production foundations:

- typed review-family selection and protocol compilation;
- durable, resumable single-replica orchestration;
- lawful source adapters and institutional bridge contracts;
- search, deduplication, screening, document intelligence, extraction, RoB 2, intervention synthesis, GRADE, reporting, and verification components;
- immutable evidence objects and checkpoint-bound evidence graphs;
- tokenisation of every run artifact;
- IMRAD-bound extraction field contracts;
- semantic units, embeddings, hybrid search, clustering, and a workbench surface;
- authentication, owner/project scoping, encrypted credentials, containerization, and Kubernetes deployment.

This is not yet a universally complete autonomous systematic-review engine. The intervention-review vertical is the strongest. Several review families, licensed-source paths, appraisal instruments, synthesis engines, and distributed-runtime requirements remain bounded or uncertified.

## Completion gates

### 1. Production integration

- merge and rebase the stacked production, Evidence OS, tokenisation, and semantic-index changes;
- deploy a release image and configure the web application against it;
- establish migration and rollback procedures;
- add backup restoration drills and run-level disaster recovery.

### 2. Distributed durability

Replace single-file ownership and in-process job execution with:

- transactional run and authorization database;
- durable workflow backend;
- distributed leases, heartbeats, retries, and dead-letter handling;
- immutable binary artifact storage;
- transactional state, evidence-graph, semantic-index, and external-action publication;
- horizontally scalable workers.

### 3. Search completeness

- certify every supported open API against source exports;
- build lawful institutional connectors for MEDLINE, Embase, CINAHL, Web of Science, Scopus, Cochrane Library, Global Health, and other licensed sources;
- capture exact strategies, platform, date, limits, export counts, and source receipts;
- add citation chaining, grey-literature, registry, preprint, and living-search coverage;
- benchmark recall against known systematic reviews.

### 4. Full-text intelligence

- supplement discovery and inventory reconciliation;
- GROBID and additional parser adapters;
- page-coordinate text and layout provenance;
- table cell reconstruction and validation;
- figure, panel, caption, and plot extraction;
- multilingual OCR and quality-aware fallback;
- lawful acquisition and inaccessible-report adjudication.

### 5. Extraction ontology

Extend the IMRAD and semantic contract registry for:

- diagnostic accuracy;
- prognosis and prediction models;
- prevalence and incidence;
- qualitative and mixed-methods evidence;
- economic evaluations;
- implementation science;
- adverse effects;
- measurement properties and COSMIN;
- mechanistic, animal, and environmental evidence;
- causal estimands, time-varying treatments, mediation, transportability, and equity.

Every new field requires value type, cardinality, source region, locator requirements, validation fixtures, context behavior, and reporting destination.

### 6. Appraisal and certainty

Implement and certify:

- ROBINS-I and ROBINS-E;
- QUADAS-2 and QUADAS-C;
- QUIPS and prediction-model tools;
- AMSTAR 2, ROBIS, INSPECT-SR, CASP, and COSMIN;
- GRADE-DTA, GRADE-CERQual, prognosis certainty, OHAT, and review-family-specific certainty;
- official-tool conformance fixtures and independent reviewer agreement studies.

### 7. Specialist synthesis

Add validated engines for:

- Bayesian meta-analysis and prior governance;
- network meta-analysis, transitivity, inconsistency, and multi-arm covariance;
- bivariate and HSROC diagnostic models;
- prognostic factor and prediction-model synthesis;
- prevalence and incidence models;
- rare events and time-to-event outcomes;
- individual-participant data and multilevel dependence;
- qualitative, realist, framework, and mixed-methods synthesis;
- umbrella-review overlap and second-order certainty;
- causal, mechanistic, and triangulation synthesis.

### 8. Semantic certification

- choose and freeze one or more provider embedding profiles;
- create held-out retrieval corpora by review family;
- benchmark hybrid retrieval, clustering, outcome harmonization, contradiction detection, and study-family linkage;
- add ontology-backed entity normalization;
- implement claim support, contradiction, and uncertainty relations;
- record human-approved cluster and concept labels;
- migrate large indexes to project-isolated ANN infrastructure.

### 9. Safe automation

- calibrated active-learning prioritization with prospective stopping-rule validation;
- dual independent model proposals where appropriate;
- mandatory disagreement and low-confidence queues;
- automatic rollback from stale downstream artifacts when upstream evidence changes;
- model routing based on certified task capability, cost, privacy, and latency;
- explicit refusal and escalation for unsupported review families or incomplete evidence.

### 10. Continuous validation

- reproduce selected Cochrane, WHO, and high-quality historical reviews;
- maintain prospective blinded holdouts;
- validate numerical parity against trusted statistical software;
- test missed-study, wrong-exclusion, wrong-extraction, wrong-estimand, wrong-appraisal, and wrong-conclusion failure modes;
- monitor performance by language, geography, study design, evidence stream, and review family;
- publish versioned model cards, method cards, and benchmark receipts.

### 11. Governance and operations

- role-based permissions and independent reviewer separation;
- data retention, deletion, export, and legal-hold policies;
- audit access and redaction controls;
- cost ceilings and run budgets;
- observability, incident response, and change control;
- privacy, security, accessibility, and regulatory review;
- institutional certification of credentialed and licensed-source workflows.

## Recommended release sequence

1. **Release A: intervention-review production pilot**
   - single replica;
   - open sources plus one certified institutional connector;
   - RoB 2, random-effects intervention synthesis, GRADE;
   - tokenisation, IMRAD contracts, semantic search;
   - mandatory final human verification.

2. **Release B: distributed intervention service**
   - transactional run store, workflow engine, queue, object storage, ANN index;
   - multi-user adjudication and living updates;
   - prospective benchmark evidence.

3. **Release C: specialist review families**
   - add one family only after its extraction, appraisal, synthesis, certainty, reporting, and benchmark chain is complete.

4. **Release D: causal and mechanistic Evidence OS**
   - production-certified DAG, target-trial, transportability, mechanism, and triangulation modules;
   - explicit causal identification and refutation gates.

## Recommended product claim

Until all completion gates are met, the accurate claim is:

> MEDANTIR is a production-oriented, closed-loop Evidence OS with autonomous execution, deterministic provenance, semantic retrieval, and fail-closed human accountability gates. Its intervention-review pathway is the most mature; specialist review families and distributed deployment remain progressively certified.

That claim is strong, useful, and defensible. It avoids describing architectural placeholders or research modules as completed scientific capabilities.
