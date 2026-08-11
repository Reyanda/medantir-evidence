# MEDANTIR Durable Review Orchestration

This implements Workstream B of `docs/AUTONOMOUS_SR_IMPLEMENTATION_PLAN.md` for the first production intervention-review vertical.

## Objective

A systematic review can run for hours or days and interact with databases, browsers, model providers, document parsers, registries, and humans. Process memory is therefore not an acceptable scientific state store.

MEDANTIR's durability contract is:

> After every authoritative pipeline transition, a hash-verified checkpoint must be committed before the engine relies on that transition as durable scientific state; every external side effect must additionally have a deterministic action identity and replay policy.

## Checkpoint boundary

`PipelineCheckpointPort` is storage-agnostic. The orchestrator supplies the complete state, stage, event, attempt, and transition timestamp. The storage backend owns serialization, idempotency, locking, and monotonic sequence allocation so a restarted orchestrator never guesses storage sequence state.

`FileCheckpointStore` persists:

```text
<durability-root>/runs/<run-id>/
  snapshot.json
  journal/
    000000000001.json
    000000000002.json
    ...
```

Each journal event contains sequence, stage/event/attempt identity, previous-event hash, complete state hash, recoverable state, and event hash. The journal is append-only and hash chained. The snapshot is only a fast index; journal state remains authoritative and can recover independently after snapshot loss/corruption.

Writes use private directories, exclusive temporary files, file `fsync`, atomic rename, and directory `fsync` where the platform supports it. Per-run locks serialize writers and stale locks are reclaimable.

## Orchestrator checkpoints

The orchestrator durably records:

- `started` **before** agent execution;
- clarification/human waiting states;
- human rework;
- cognitive rollback;
- human/cognitive gates;
- successful validated stage completion;
- failed attempts;
- terminal failure;
- external-action reconciliation blocks.

Durability failure is not a scientific retry. Failure to commit `started` prevents the scientific agent from executing. Failure to persist after computation fails fast rather than automatically executing the scientific agent again.

## External-action exactly-once boundary

State checkpoints alone cannot answer whether an external action completed before a crash. MEDANTIR therefore assigns every external action a deterministic ID derived from:

```text
run + stage + action kind + operation key + request hash
```

The `ExternalActionCoordinator` supports two explicit replay policies.

### `safe-repeat`

For repeatable read operations such as bibliographic search/export. A successful response is durably cached and reused. If an unfinished/failed read has no successful receipt, the exact read may be executed again.

Search uses one action identity **per database strategy**, so if database A succeeds and database B fails, a restarted search reuses A's receipt and executes only unfinished B.

### `require-reconciliation`

For mutating operations such as protocol registration. A mutation that may have been dispatched but lacks a local success receipt becomes `uncertain`. It is never automatically repeated.

Before replay, the adapter must establish one of:

- `completed`: remote state proves the action already succeeded; MEDANTIR mints the local recovered receipt without replay;
- `not-found`: remote state proves the action was not applied; one execution is allowed;
- `uncertain`: the remote system cannot prove either case; the run remains blocked for reconciliation.

A reconciliation requirement is an auditable `awaiting-human`/blocked state, not a scientific failure and not a normal retry.

## Registry reconciliation

### GitHub

GitHub registration writes the MEDANTIR action identity into commit/release metadata. Recovery checks every protocol file against the exact expected bytes. If a release is required, the expected tag must exist and carry the protocol checksum.

- zero protocol files -> `not-found`;
- all exact files plus required release -> `completed`;
- partial files, content mismatch, or missing/inconsistent release -> `uncertain`.

### Zenodo

Zenodo deposits carry the protocol checksum and MEDANTIR action marker in metadata. One exact marked completed deposit can be reconciled. Multiple matches, incomplete publication, or failed API reconciliation are `uncertain`.

Absence of a marked deposit is deliberately **not** treated as `not-found`, because a process may have died after creating an unmarked blank draft. This prevents duplicate deposits.

### PROSPERO and OSF

The deterministic action ID is propagated through the authenticated browser bridge. Until the bridge/remote source can prove completion through a reconciliation operation, an interrupted mutation remains blocked rather than being replayed blindly.

## Server recovery

Live review-server runs automatically use a durability runtime containing:

- `FileCheckpointStore`;
- `FileExternalActionLedger`;
- `ExternalActionCoordinator`.

On process restart, the server loads the latest hash-verified durable state. A stage that was `running` is changed back to `pending` and its interrupted attempt is returned to the retry budget because process death is not scientific failure. Completed upstream stages and artifacts remain intact.

The first authenticated poll resumes a recovered run. Registry actions remain protected by mutation reconciliation, while repeatable database searches use their per-source durable receipts.

Mock/hermetic server mode remains separate from production durability unless a test explicitly constructs a durability runtime.

## Verification requirements

The durability suite now targets:

- ordered checkpoint hash chain;
- snapshot-independent recovery;
- tamper detection;
- path traversal rejection;
- storage-owned sequence continuation across process/store instances;
- checkpoint-before-execute ordering;
- fail-fast persistence semantics;
- process-interruption retry-budget restoration;
- server restart recovery;
- per-database search receipt reuse;
- safe-repeat failure recovery;
- mutation uncertainty blocking;
- reconciliation recovery without mutation replay;
- proven `not-found` authorization of one retry;
- GitHub exact/absent/partial/mismatch remote reconciliation;
- Zenodo exact/ambiguous reconciliation;
- reconciliation-required orchestration without normal retry.

## Remaining durability work

1. implement a bridge `register_reconcile` command for PROSPERO/OSF where remote state can be reliably inspected;
2. persist run ownership metadata in a transactional store rather than the legacy `runs.json` index;
3. move large evidence bodies/artifacts to immutable content-addressed storage while keeping hashes/locators in `PipelineState`;
4. add leases/heartbeats for horizontally scaled workers;
5. add dead-letter queues and failure-class-aware scheduling;
6. add crash injection across every external-action boundary and every authoritative pipeline transition;
7. add a database/object-store implementation of the checkpoint and external-action ledger ports.
