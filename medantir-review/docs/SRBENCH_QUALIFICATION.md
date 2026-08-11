# SRBench qualification trust ladder

SRBench separates **benchmark construction** from **benchmark qualification**. A historical review may be useful for development long before it is strong enough to justify model promotion.

The live qualification chain is:

```text
candidate declaration
      ↓
immutable source capture
      ↓
component verification receipt
      ↓
12/12 component gold package
      ↓
candidate-wide independent verification
      ↓
validation-ready candidate
      ↓
corpus promotion gate
      ↓
SRBench case admission
      ↓
repeated multi-review SR100 policy
```

No lower layer may impersonate a higher layer.

## Qualification components

Every published-review candidate has twelve qualification components:

1. protocol
2. search strategy
3. search corpus
4. deduplication truth
5. title/abstract screening truth
6. full-text screening truth
7. included-report corpus
8. extraction truth
9. appraisal truth
10. analysis runtime
11. synthesis targets
12. report source

Each component moves through explicit states:

- `missing`
- `identified`
- `available-unfrozen`
- `frozen-unverified`
- `frozen-verified`

`frozen-unverified` means the immutable source basis has been captured. It does **not** mean the scientific component has been independently reproduced or adjudicated.

## Immutable source captures

`SrQualificationSourceCapture` records:

- candidate ID;
- qualification component;
- immutable source identities;
- selected file paths when applicable;
- provenance role;
- qualification use;
- capture timestamp;
- capture method.

Accepted immutable identities are:

- full 40-character Git commit identities; or
- `HOBJ-<sha256>` content objects with exact byte length.

For byte-based sources, `content-addressed-archive` means the bytes were actually persisted in MEDANTIR's immutable object store, read back, and replay-verified. Hash-only evidence is labelled `content-hash-verification` and cannot be used as benchmark gold.

Promotion is explicit rather than inferred: a source capture must declare `qualificationUse: benchmark-gold` before it can upgrade a component or mint a qualification receipt. An omitted qualification use is not promotable, and `supporting-evidence-only` captures remain supporting evidence.

## Component verification receipts

A `SrQualificationAssetReceipt` certifies one candidate/component only. A component may legitimately require several source artifacts, so the canonical multi-capture minting path can bind several captures, but every one must resolve to the same candidate and component.

Finalization rejects a receipt unless:

- the receipt itself is hash-valid;
- it is bound to at least one immutable source capture under the default policy;
- every cited capture exists;
- every cited capture belongs to the same candidate and component;
- every cited capture is explicitly `benchmark-gold`;
- the receipt's immutable source-identity set exactly equals the union of its bound captures;
- there is at most one component receipt in the finalization input;
- an analysis-runtime receipt includes a bound reproduction preflight with `exactReproductionReady=true`.

This prevents a scientifically valid-looking receipt from borrowing provenance from another review, another stage, or an unrelated source object.

## Candidate-wide independent verification

Twelve component receipts produce a `gold-buildable` candidate, not a promotion-ready one.

A separate `SrQualificationCandidateVerificationReceipt` must bind:

- all twelve component receipt hashes;
- the pre-verification candidate hash;
- an independent verification basis;
- verifier identity;
- verification time.

The receipt is rejected if any component receipt changes, disappears or is replaced. Only a candidate whose candidate-wide verification replays against the exact current component state becomes `validation-ready` and `promotionEligible=true`.

## Corpus promotion gate

The default `MEDANTIR-SRBENCH-QUALIFICATION` gate requires:

- at least **3 validation-ready published-review candidates**;
- at least **3 distinct scientific domains**;
- at least one methodological class, with methodological breadth reported explicitly and available for prospective tightening.

The methodological-class threshold is deliberately not silently raised above the established SR100 three-review/three-domain policy. A future policy can tighten that threshold by versioning the qualification policy.

The qualification gate is hash-bound and included in the live SRBench suite hash when qualification ledgers are configured. It is also authoritative for promotion input: individually admitted cases cannot feed SR100 promotion while the corpus-wide qualification gate is blocked. This keeps the qualification trust boundary intact even if a downstream SR100 policy is later changed.

## Checked-in ledgers

SRBench v1 uses four files:

- `benchmarks/srbench-v1/qualification-candidates.json`
- `benchmarks/srbench-v1/qualification-source-captures.json`
- `benchmarks/srbench-v1/qualification-asset-receipts.json`
- `benchmarks/srbench-v1/qualification-candidate-verifications.json`

The suite config binds all four. Partial ledger configuration fails closed.

The current asset-receipt and candidate-verification ledgers are intentionally empty. Existing immutable COVID-RAT captures therefore replay as `frozen-unverified`; no candidate is promoted merely because source files were found and pinned.

## Commands

Inspect raw candidate buildability:

```bash
npm run benchmark:sr:qualify
```

Apply/check source captures:

```bash
npm run benchmark:sr:capture-sources
```

Finalize the complete qualification trust ladder:

```bash
npm run benchmark:sr:finalize-qualification
```

This writes:

- `artifacts/srbench-qualification/qualification-finalization.json`
- `artifacts/srbench-qualification/qualification-final-corpus.json`
- `artifacts/srbench-qualification/qualification-promotion-gate.json`

For a certification job that must fail unless the promotion gate is satisfied:

```bash
SRBENCH_REQUIRE_QUALIFICATION_GATE=true \
npm run benchmark:sr:finalize-qualification
```

Validate the live SRBench suite, including qualification finalization:

```bash
npm run benchmark:sr:validate
```

The validation receipt records the finalization hash, source-capture hashes, component receipt hashes, candidate verification hashes and promotion-gate result.

## Relationship to model promotion

Qualification answers: **is this published review strong enough to count as promotion evidence?**

SR100 answers: **did this model reproduce the qualified review exactly, repeatedly, across the required set of reviews/domains, with zero critical failures?**

Secure promotion adds another layer: signed qualification proofs, trusted verifier organizations, contamination checks, counterfactual canaries and drift sentinels.

A benchmark score never upgrades missing qualification evidence, and qualification never grants autonomous scientific authority by itself.
