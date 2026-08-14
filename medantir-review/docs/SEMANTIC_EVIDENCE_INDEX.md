# MEDANTIR Semantic Evidence Index

## Status

The semantic index is a source-bound, rebuildable projection over MEDANTIR's immutable artifacts and deterministic token documents. It adds hybrid retrieval and navigational clustering without weakening the authority of exact source evidence, extraction contracts, deterministic analysis, or attributable human decisions.

The implementation supports two embedding modes:

- `local`: deterministic, network-free lexical-dense vectors. This is the default and is suitable for reproducible autonomous operation, development, fallback, and lexical-neighbour retrieval. It is not labelled as deep semantic equivalence.
- `openai-compatible`: provider semantic embeddings through a versioned `/v1/embeddings` adapter. This requires a base URL, API key, model, and deployment-specific validation.

## Scientific authority model

```text
Scientific artifact
  -> secret-safe canonical projection
  -> deterministic token document
  -> IMRAD and semantic-role projection
  -> semantic units
  -> rebuildable embeddings
  -> hybrid index and clusters
  -> source-bound search result
```

Tokens, artifact hashes, JSON Pointers, source locators, field contracts, evidence objects, deterministic methods, and human adjudication remain authoritative. A vector, similarity score, or cluster label is never sufficient evidence by itself.

## Semantic units

The projector creates multiple resolutions where source material permits:

- artifact
- section
- passage
- sentence
- claim
- extraction field
- outcome
- estimand
- effect estimate
- mechanism
- study
- table row

Every unit records:

- stable `semu-<sha256>` identity
- artifact and token-document hashes
- exact token IDs
- JSON Pointers
- IMRAD role
- semantic roles
- normalized text and text hash
- study/report source identities where available
- non-secret metadata

Units larger than 12,000 characters are split without crossing their artifact source. The resulting passages retain the source token IDs and parent unit type.

## Embedding identity and reuse

An embedding object is bound to:

```text
semantic unit ID
unit text hash
provider
model and model version
dimensions
normalization
vector hash
```

Embedding vectors are stored in the private semantic snapshot but are not returned by public or owner API responses. Cluster centroids are also withheld; APIs expose hashes, labels, stability, membership, and source-bound units.

When scientific state changes, MEDANTIR reuses vectors whose normalized input text hash is unchanged and whose embedding profile remains compatible. It generates only missing vectors. If the provider changes dimensions or vector-space identity during an incremental extension, the build discards mixed-space reuse and re-embeds the complete index.

The manifest reports generated and reused vector counts and embedding usage receipts.

## Retrieval

Hybrid search combines:

1. metadata filtering before ranking;
2. dense cosine similarity;
3. BM25 lexical relevance;
4. exact-phrase matching;
5. deterministic weighted fusion.

Supported filters include:

- semantic unit type
- IMRAD region
- semantic role
- artifact key
- study ID
- cluster ID

Search results return the complete semantic unit, exact token IDs, JSON Pointers, artifact identity, IMRAD role, source object IDs, component scores, and cluster IDs. They never return raw embedding vectors.

## Clustering

The initial production-safe clustering implementation uses deterministic spherical k-means with farthest-first initialization, grouped by semantic unit type. It produces:

- content-addressed cluster and run IDs
- member unit IDs
- centroid hashes
- top weighted terms
- machine-proposed labels
- within-cluster cosine stability

Cluster labels are navigation aids. They remain `machine-proposed` until a future attributable approval or amendment workflow records a human decision.

## Persistence

File-backed snapshots are stored beneath the existing durability root:

```text
<durability-root>/semantic-index/
  runs/run-<hash>/
    snapshots/<index-hash>.json
    latest.json
```

Snapshot files are private, immutable, content-addressed, and verified after reload. The latest pointer is atomically replaced and reconciles to the run, source state, index hash, and manifest hash. The same scientific index is idempotent: an existing immutable snapshot is reused rather than overwritten.

This storage backend is appropriate for the current single-replica runtime. A horizontally scalable deployment requires a transactional metadata store, object storage, distributed leases, and an access-controlled approximate-nearest-neighbour service.

## API

Public discovery:

```http
GET /evidence-os/semantic-capabilities
GET /evidence-os/openapi
GET /evidence-os/architecture
```

Owner-and-project-scoped routes:

```http
GET  /runs/:runId/semantic-index-manifest
GET  /runs/:runId/semantic-units?offset=0&limit=100
GET  /runs/:runId/semantic-units/:semanticUnitId
GET  /runs/:runId/semantic-clusters
GET  /runs/:runId/semantic-clusters/:clusterId
POST /runs/:runId/semantic-search
POST /runs/:runId/semantic-index/rebuild
```

Example search:

```json
{
  "query": "post-discharge mortality after recovery from severe acute malnutrition",
  "topK": 30,
  "filters": {
    "unitTypes": ["study", "claim", "outcome", "effect-estimate"],
    "imradRoles": ["results", "discussion"]
  },
  "denseWeight": 0.55,
  "lexicalWeight": 0.35,
  "exactPhraseWeight": 0.10
}
```

## Configuration

Autonomous local baseline:

```bash
SEMANTIC_EMBEDDING_MODE=local
SEMANTIC_EMBEDDING_DIMENSIONS=384
SEMANTIC_EMBEDDING_MODEL_VERSION=1
```

Provider semantic mode:

```bash
SEMANTIC_EMBEDDING_MODE=openai-compatible
SEMANTIC_EMBEDDING_BASE_URL=https://provider.example
SEMANTIC_EMBEDDING_API_KEY=secret
SEMANTIC_EMBEDDING_MODEL=validated-model
SEMANTIC_EMBEDDING_MODEL_VERSION=frozen-or-observed-version
SEMANTIC_EMBEDDING_DIMENSIONS=1536
SEMANTIC_EMBEDDING_PROVIDER=provider-name
SEMANTIC_EMBEDDING_BATCH_SIZE=64
```

The service fails closed at startup when provider mode is selected without its required values.

## Workbench

The authenticated web application exposes a `Semantic evidence index` workspace. It can attach to the active project's latest durable run, inspect the index manifest, distinguish the local baseline from provider semantic embeddings, run hybrid searches, filter by unit type and IMRAD role, inspect exact provenance, review clusters, and force a rebuild.

## Current boundaries

- The local vector mode is deterministic lexical-dense retrieval, not a scientific claim of semantic equivalence.
- Provider embeddings require prospective retrieval benchmarks, drift monitoring, and version freezing before production certification.
- The current JSON snapshot and exact cosine scan are single-replica baselines, not large-corpus ANN infrastructure.
- Cluster labels are not authoritative scientific classifications.
- The index does not infer missing evidence or repair absent lawful full text.
- It does not replace PDF parsing, OCR, table reconstruction, figure interpretation, study-family linkage, outcome harmonization, appraisal, synthesis, or verification.
- Access control is enforced before run retrieval; future shared vector infrastructure must preserve project isolation before candidate generation, not only after ranking.

## Certification requirements

Before provider-semantic mode may authorize default production retrieval, complete:

1. frozen embedding model and dimensionality;
2. prospective, held-out search and field-retrieval benchmarks;
3. recall, precision, nDCG, MRR, calibration, and subgroup error analysis;
4. lexical-only and dense-only ablations;
5. adversarial tests for negation, dosage, time point, population, and estimand mismatch;
6. multilingual and acronym robustness where applicable;
7. permission-isolation and inference-leakage testing;
8. model and corpus drift sentinels;
9. cost and latency budgets;
10. attributable approval of deployment thresholds.
