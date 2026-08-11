# MEDANTIR Rare-event Binary Synthesis

Rare-event analysis is a method-selection problem, not a licence to add 0.5 to every zero cell.

## Implemented methods

- Mantel–Haenszel risk ratio (MH-RR);
- Mantel–Haenszel odds ratio (MH-OR) with Robins–Breslow–Greenland variance;
- Peto odds ratio with explicit applicability diagnostics.

## Zero-event policy

### Single-zero studies

MH RR/OR retain single-zero studies directly where the pooled estimator remains defined. No arbitrary continuity correction is inserted.

### Double-zero studies

Studies with zero events in both arms are retained in the review/audit ledger but contribute no relative-effect information to RR/OR/Peto pooling. They are never silently deleted from the scientific record.

If every study is double-zero, MEDANTIR refuses to manufacture a relative-effect estimate.

### Individual inverse-variance RR/OR

When an individual study effect must be derived before generic inverse-variance synthesis, zero cells require an explicitly selected continuity-correction policy. The correction and input table are recorded in the derivation receipt.

## Peto applicability

Peto OR is never selected merely because events are sparse. The returned artifact reports:

- maximum observed event rate;
- maximum allocation imbalance;
- approximate absolute log-OR magnitude;
- whether prespecified rare-event, balance and small-effect criteria are met;
- warnings for every criterion that is not met.

The method therefore remains an explicit protocol choice/sensitivity method rather than a hidden fallback.

## Dependence

Duplicate study identities are rejected before rare-event pooling. Multi-arm/shared-control evidence must first pass the covariance/dependence pathway rather than appearing as independent strata.

## Remaining work

- integrate raw 2×2 event tables into provenance-first extraction;
- add exact protocol-level method-selection rules for rare-event primary/sensitivity analyses;
- freeze parity examples against RevMan/metafor or another trusted deterministic implementation;
- evaluate treatment-arm continuity corrections and other prespecified corrections where scientifically justified;
- connect risk-difference handling of double-zero studies only with explicit warnings about weighting/variance behavior.
