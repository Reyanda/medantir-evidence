# Immutable OSF source resolution

SRBench treats an OSF project identifier as **discovery provenance**, not an immutable benchmark object. Qualification requires an explicit file revision plus the SHA-256 and byte length of the exact downloaded bytes.

The OSF workflow is deliberately split into two commands:

1. `benchmark:sr:inventory-osf` discovers stable file IDs, materialized paths and current revision metadata and always emits `qualificationReady: false`.
2. `benchmark:sr:resolve-osf` takes explicitly selected paths/revisions, downloads the exact bytes, verifies their identity, and for `benchmark-gold` persists those bytes into MEDANTIR's immutable content-addressed HOBJ store before emitting a hash-bound `SrQualificationSourceCapture`.

Discovery therefore cannot silently become scientific gold, and a downloaded hash is not called an archive unless the bytes were actually persisted and replay-verified.

## Scientific guardrails

- Every qualification target must specify a revision. There is no implicit `latest` qualification mode.
- A basename is accepted only when it resolves unambiguously; otherwise an exact materialized path is required.
- For the current revision, the resolver may use the file resource's download link.
- For a non-current revision, the resolver requires an explicit version-specific download link from the API response. It does not invent an undocumented WaterButler revision URL.
- Reported version byte length, caller-pinned byte length, caller-pinned SHA-256 and the OSF current-file SHA-256 are checked when available. Any mismatch fails closed.
- `benchmark-gold` OSF byte sources require both explicit archive metadata and an immutable `HistoricalObjectStorePort`. The resolver writes the exact bytes, receives an HOBJ receipt, and verifies object ID, SHA-256 and byte length against the downloaded revision before the capture method may be `content-addressed-archive`.
- Supporting evidence may be resolved without persistence, but is labelled `content-hash-verification`; it cannot mint benchmark qualification receipts.
- Resolution creates a `frozen-unverified`-eligible source capture only. Independent scientific verification is still required before a qualification asset can become `frozen-verified`.
- `sourceRole`, `qualificationUse`, selected path/revision and immutable identities are hash-bound. `supporting-evidence-only` captures cannot mint benchmark qualification receipts.

## Inventory public source files

Run the non-qualifying inventory first:

```bash
SRBENCH_OSF_NODE='H75V4' \
npm run benchmark:sr:inventory-osf
```

The resulting artifact lists materialized paths, stable file IDs, current revisions, current SHA-256/size when OSF exposes them, version endpoints, and current download links. It is explicitly marked `qualificationReady: false` and has its own inventory hash for drift comparison.

Fixture-mode inventory uses the same checked-in API fixture:

```bash
SRBENCH_OSF_NODE='abc12' \
SRBENCH_OSF_FIXTURE_FILE='benchmarks/srbench-v1/fixtures/osf-source-resolver/fixture.json' \
npm run benchmark:sr:inventory-osf
```

## Resolve explicit revisions

Create a request JSON containing the OSF node, candidate/component provenance role, explicit target paths/revisions, capture timestamp and, for benchmark gold, explicit archive semantics:

```json
{
  "nodeId": "abc12",
  "candidateId": "SRQ-OSF-FIXTURE",
  "component": "extraction-truth",
  "sourceRole": "review-materials",
  "qualificationUse": "benchmark-gold",
  "targets": [
    {
      "path": "analysis/report.csv",
      "revision": "2",
      "expectedSha256": "8ddebf2b0a493950f2c91909bd079188f61ee49976298386627c3f3dd77a0b21",
      "expectedByteLength": 14
    }
  ],
  "capturedAt": "2026-08-10T21:30:00Z",
  "archiveMetadata": {
    "role": "extraction-source",
    "accessClass": "public",
    "legalAccessRoute": "OSF public project file"
  }
}
```

Then run:

```bash
SRBENCH_OSF_RESOLVE_FILE='path/to/request.json' \
npm run benchmark:sr:resolve-osf
```

The CLI creates a `FilesystemHistoricalObjectStore` under `artifacts/srbench-qualification/object-store/` by default. Override it with `SRBENCH_OBJECT_STORE_DIR`. Object paths are derived only from validated SHA-256 content digests; source filenames do not determine archive paths.

For permissioned OSF material, `OSF_API_TOKEN` may be supplied. Private or permission-gated material must still be classified according to its scientific role; authentication does not make restricted supporting data benchmark gold.

The commands write resolver/finalization artifacts under `artifacts/srbench-qualification/` by default. `SRBENCH_OSF_OUTPUT_DIR` overrides resolver output location.

## Deterministic offline resolver fixture

A checked-in no-network request/API fixture exercises the complete resolution and archive path:

```bash
SRBENCH_OSF_RESOLVE_FILE='benchmarks/srbench-v1/fixtures/osf-source-resolver/request.json' \
SRBENCH_OSF_FIXTURE_FILE='benchmarks/srbench-v1/fixtures/osf-source-resolver/fixture.json' \
npm run benchmark:sr:resolve-osf
```

Fixture mode replaces only `fetch`; path resolution, revision selection, byte hashing, HOBJ persistence, archive verification and qualification-capture generation are identical to live mode.

## Current qualification targets

### Hamilton sharing review

Keep these OSF roles distinct:

- `7SX8U` — preregistration
- `H75V4` — review/search/extraction materials project
- `U3YRP` — public summary data and code used to reproduce the final findings
- `CA89E` — published-table data
- `STNK3` — restricted IPD request route; supporting evidence only, not benchmark gold

The next live step is to inventory the public H75V4/U3YRP file paths and revisions, resolve and archive the exact required bytes, then independently reproduce the corresponding review stages before minting verification receipts.

### Calorie-reformulation review

`DJ4YF` is the public workspace for manuscript data, codebook and analytic code. The workspace also contains material for a related portion-size review, so exact materialized paths must be selected rather than treating the whole project as one undifferentiated gold object. Exact R/package runtime reconstruction remains a separate qualification requirement.
