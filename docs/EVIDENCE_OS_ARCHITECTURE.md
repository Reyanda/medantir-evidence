# MEDANTIR Evidence OS architecture

## Purpose

MEDANTIR Evidence OS is the architecture layer around the existing protocol-led review engine. It does not replace the scientific pipeline. It makes the pipeline addressable as an immutable evidence graph, exposes its workflow as a directed acyclic graph, records model cost and routing receipts, and publishes an honest capability manifest that distinguishes implemented, human-gated, partial, research-only, externally certified, and planned functions.

The previous workbench was paper-centred and screen-centred. Evidence OS is object-centred:

```text
Question
  -> Protocol
  -> Search strategy
  -> Search execution
  -> Retrieved record
  -> Deduplicated record
  -> Screening decision
  -> Lawful full text
  -> Parsed document
  -> Evidence excerpt
  -> Study
  -> Effect estimate / mechanism
  -> Risk-of-bias assessment
  -> Synthesis
  -> Certainty assessment
  -> Report
  -> Verification decision
```

Every object has a stable logical identity, a version, a scientific content hash, a content-addressed object ID, provenance, and optional supersession links. Every graph edge is also content-addressed.

## Relationship to the 21-stage review engine

The current engine remains the authoritative execution graph:

```text
question -> identity -> protocol -> review-landscape -> protocol-draft
-> search-build -> search-test -> protocol-finalise -> register-protocol
-> search-execute -> deduplicate -> tiab-screen -> fulltext-retrieve
-> pdf-to-text -> fulltext-screen -> extract -> risk-of-bias
-> synthesise -> grade -> report -> human-verify
```

`buildEvidenceWorkflowPlan()` derives the Evidence OS DAG from the same typed `ReviewProtocol` used by the orchestrator. It does not maintain a second hand-written pipeline definition. The derived DAG records:

- required and produced artifacts;
- dependency edges;
- stage order;
- human-gate policy;
- retry policy;
- execution class;
- current stage status;
- checkpointing and reconciliation capabilities;
- the explicit single-replica execution boundary.

A cycle or missing dependency fails closed.

## Core invariants

### One scientific source of truth

The existing `PipelineState`, hash-chained checkpoint journal, scientific run manifest, and scientific run seal remain authoritative. Evidence OS graph snapshots are derived from that exact state and bound back to the corresponding checkpoint through the checkpoint sequence, event hash, and state hash. The graph cannot create or silently mutate scientific decisions independently of the pipeline.

### Immutable evidence objects

An evidence object cannot be edited in place. A material change creates a new version and a `supersedes` edge. Identical scientific content reuses the same object identity. A later checkpoint seeds from the prior graph, retains historical objects, advances only changed logical objects, and moves active roots to their latest versions.

### Secret-safe canonicalization

Raw credential and token fields are redacted before object construction. The graph can include credential references and routing metadata, but never raw access tokens, passwords, client secrets, cookies, or bearer credentials.

### Provenance before confidence

An object may carry a model proposal, human adjudication, deterministic derivation, source excerpt, registry receipt, or system audit provenance. Model confidence is never a substitute for a source locator or an attributable decision.

### Capability honesty

The architecture manifest is executable product metadata, not marketing copy. Each capability is labelled as one of:

- `operational`;
- `operational-human-gated`;
- `partial`;
- `research-only`;
- `external-certification-required`;
- `planned`.

For example, intervention random-effects meta-analysis is operational; RoB 2 is operational but human-gated and still has an official-parity certification boundary; ROBINS-I, ROBINS-E, QUADAS, QUIPS, and COSMIN engines are not represented as complete; HEOS causal modules remain research-only until production contracts and validation are supplied.

## Architecture modules

### Question formulation

Operational typed review families include PICO/PECO/PICOTS and SPIDER-oriented methods, review-type selection, material clarification, attributable resolutions, and deterministic replay. A dedicated production COSMIN question compiler remains planned.

### Search engine

The production graph supports source-specific strategy construction, validation, PRESS attestation, official open APIs, institutional bridge adapters, definitive execution, deduplication, and provenance. Licensed database completeness and vendor-specific browser flows remain live-certification boundaries.

### Screening engine

Title/abstract and full-text decisions are explicit artifacts. Active-learning and model-assisted proposals may support prioritisation, but production exclusions remain governed by recall-sensitive policy, source evidence, and human gates.

### PDF intelligence

LiteParse is the preferred structured parser. Native text and OCR are recorded downgrade paths. Coordinate fidelity is claimed only when valid spatial boxes exist. Dedicated GROBID, figure-semantic, table-reconstruction, and universal supplement-completeness modules remain incomplete or planned.

### Information extraction

Study identity, reports, PICO fields, outcomes, effect estimates, evidence excerpts, adjustment identity, and mechanism fields are projected into separate objects. Crude and adjusted estimands cannot be pooled unless a source-bound compatibility rule authorises them.

### Critical appraisal

RoB 2 is result-level, source-bound, deterministic after signalling input, and attributable when overridden. Unsupported designs fail closed. Additional appraisal tools require their own signalling structures, algorithms, evidence schemas, conformance suites, and human-review controllers.

### Evidence synthesis

The certified intervention vertical uses REML as the primary heterogeneity estimator with DL and Paule-Mandel sensitivity, Wald and HKSJ uncertainty sensitivity, prediction intervals, effect-scale checks, adjustment compatibility, and dependence guards. Other review-family synthesis engines are identified individually rather than routed through a generic meta-analysis.

### Causal evidence engine

The repository contains HEOS research components for causal DAGs, evidence graphs, ontology, refutation, and source transport. Evidence OS exposes these as research-only capabilities. They cannot authorise production causal conclusions until frozen estimands, identification contracts, source schemas, validation corpora, and adjudication policies exist.

### Report generation

Reports, protocol files, search strategies, PRISMA counts, GRADE outputs, verification artifacts, and scientific seals are graph objects. Journal-targeted rendering is a separate capability from scientific content generation and remains partially implemented.

### Verification and API

The API exposes the architecture, workflow, graph, individual objects, model-cost ledger, and a reproducibility bundle. Run-specific surfaces use the same owner and project scope as the main review API.

## REST surfaces

Public discovery:

```text
GET /evidence-os/architecture
GET /evidence-os/openapi
```

Authenticated, owner-and-project-scoped run surfaces:

```text
GET /runs/:runId/evidence-os
GET /runs/:runId/evidence-graph
GET /runs/:runId/evidence-objects/:objectId
GET /runs/:runId/workflow-plan
GET /runs/:runId/cost-ledger
GET /runs/:runId/reproducibility-bundle
```

The reproducibility bundle contains:

- the workflow DAG and hash;
- the latest checkpoint-bound immutable graph and hash;
- model-routing and cost receipts;
- the scientific run manifest;
- the scientific run seal;
- the frozen protocol checksum when available;
- the final report scientific-content hash when available.

## Runtime and orchestration

### Current production baseline

```text
HTTPS frontend
  -> authenticated Evidence OS / Review API
  -> single in-process copy-on-write scheduler
  -> 21-stage orchestrator
  -> hash-chained state checkpoint journal
  -> cumulative content-addressed evidence graph snapshots
  -> graph checkpoint receipt chain
  -> external-action reconciliation ledger
  -> encrypted credential vault
  -> persistent /data volume
```

This is production-safe for one service replica. It is not described as horizontally scalable.

### Checkpoint-bound graph persistence

Every durable state checkpoint is paired with a cumulative Evidence OS snapshot. The state journal remains the recovery authority. The graph layer adds a second, independently verifiable receipt that binds:

```text
run ID
+ checkpoint sequence
+ stage and event
+ attempt
+ checkpoint event hash
+ checkpoint state hash
+ graph hash
+ previous graph hash
```

The persistence layout under the durability root is:

```text
evidence-os/objects/evo-<sha256>.json
runs/<run-id>/evidence-os/graphs/<graph-sha256>.json
runs/<run-id>/evidence-os/checkpoints/<sequence>.json
runs/<run-id>/evidence-os/latest.json
```

The object store is global and content-addressed, while graph snapshots and graph checkpoint receipts are run-scoped. Re-observing identical scientific content at a different wall-clock time reuses the same object ID. A changed logical object advances its version and creates a `supersedes` edge to the prior version.

The `latest.json` file is a convenience pointer, not the authority. If it is missing or damaged, the immutable graph checkpoint receipt chain is scanned and verified. Graph files, objects, roots, edges, summary counts, and receipt hashes all fail closed on tampering.

Checkpoint hashing uses the exact JSON-persisted state representation. This matters because protocol amendments may legitimately contain an undefined prior value; the durable hash is computed after applying the same JSON semantics used on disk, so a state that verifies in memory also verifies after deserialisation.

### Distributed replacement seam

Evidence OS defines interfaces for:

- Temporal, Dagster, Prefect, or Airflow workflow backends;
- Kafka, RabbitMQ, or Redis Streams queues;
- immutable large-object storage;
- durable evidence-object and graph repositories.

A distributed deployment must add all of the following before `replicas > 1` is permitted:

1. a transactional ownership and run store;
2. distributed leases and heartbeats;
3. a durable work queue with idempotency keys;
4. immutable object storage for PDFs, exports, model bundles, figures, and supplements;
5. dead-letter and reconciliation operations;
6. cross-worker checkpoint ordering;
7. distributed rate limiting and provider budgets;
8. consistent role and project authorization;
9. graph snapshot publication transactions across workers;
10. restore and disaster-recovery tests.

The Kubernetes deployment in `deploy/kubernetes` therefore fixes `replicas: 1` and deliberately includes no HorizontalPodAutoscaler.

## Kubernetes topology

The supplied manifests create:

- a dedicated namespace;
- one hardened review-service pod;
- a persistent volume claim mounted at `/data`;
- a ClusterIP service;
- non-root execution;
- read-only root filesystem;
- dropped Linux capabilities;
- liveness and readiness probes;
- secret references for Cognito and the credential master key.

Ingress, TLS termination, managed secret injection, backup scheduling, and vendor-specific services are deployment-environment responsibilities.

## Model routing and cost monitoring

`buildEvidenceCostLedger()` discovers routing receipts recursively from run artifacts and aggregates:

- requested and actual model identities;
- provider;
- request ID;
- input and output tokens;
- latency;
- USD cost when supplied;
- priced and unpriced call counts.

Unpriced calls remain visible. Missing price information is not converted to zero-cost evidence.

## Testing standard

The production test graph covers:

- deterministic object addressing;
- deep immutability;
- secret redaction;
- object supersession across checkpoints;
- edge integrity;
- DAG acyclicity and dependencies;
- runtime duplicate-run exclusion;
- graph projection and clock-stable hashes;
- checkpoint-to-graph event and state-hash binding;
- recovery without the latest graph pointer;
- JSON-persisted checkpoint hashing with undefined amendment values;
- graph, object, state-journal, and receipt tamper detection;
- capability truth status;
- cost aggregation;
- public architecture discovery;
- authenticated graph and object access;
- cross-owner denial.

These tests run alongside the existing server, durability, search, document, adjustment, synthesis, RoB 2, GRADE, publication-bias, registry-universe, and recovery tests.

## What is better than the previous workbench

The previous application organised review tasks and artifacts. Evidence OS adds the missing system-level invariants:

1. the whole review is represented as a DAG;
2. every scientific artifact can be represented as an immutable object;
3. every relationship can be represented as a content-addressed edge;
4. graph history is persisted at durable checkpoints rather than reconstructed only on demand;
5. changed objects advance through explicit versions and supersession edges;
6. graph snapshots are cryptographically bound to the corresponding durable state event;
7. capability status is machine-readable and honest;
8. model cost and routing are auditable;
9. architecture and graph data have stable API surfaces;
10. distributed infrastructure has explicit ports rather than hidden coupling;
11. Kubernetes support is supplied without making a false scalability claim;
12. unsupported appraisal, synthesis, and causal methods remain visible as debt rather than silently approximated.

## Remaining roadmap

Priority order:

1. replace the JSON ownership index with a transactional database;
2. add immutable binary object storage for all PDFs, exports, figures, supplements, and model bundles;
3. implement one distributed workflow backend and one durable queue adapter;
4. certify licensed source adapters and registry browser flows;
5. complete official RoB 2 parity;
6. implement ROBINS-I/E, QUADAS, QUIPS, COSMIN, AMSTAR 2, and ROBIS engines independently;
7. add Bayesian, network, diagnostic, prognostic, and qualitative synthesis engines with conformance corpora;
8. productionise the causal evidence engine under frozen identification and adjudication contracts;
9. add continuous benchmark datasets and prospective holdouts for each review family;
10. implement distributed graph publication transactions before allowing more than one service replica.
