# MEDANTIR Intervention Meta-analysis Engine

## Scope

This module replaces the single common-effect inverse-variance bottleneck for the first production intervention-review vertical.

The deterministic primary analysis is:

- outcome-specific inverse-variance random-effects meta-analysis;
- between-study variance estimated by REML;
- Wald 95% confidence interval as the primary interval;
- 95% prediction interval when at least three independent studies are available;
- all calculations performed on the certified analysis scale (for example log scale for RR/OR/HR).

The engine simultaneously retains method-sensitivity analyses for:

- REML + Wald;
- REML + HKSJ;
- Paule–Mandel + Wald;
- Paule–Mandel + HKSJ;
- DerSimonian–Laird + Wald;
- DerSimonian–Laird + HKSJ.

No LLM computes pooled numerical values.

## Scientific gates before pooling

A result stream is pooled only when:

1. at least two numeric estimates are available;
2. estimates are semantically compatible in outcome, effect measure, and analysis scale;
3. the study identity is unique for each independent estimate;
4. upstream estimand compatibility/dependence guards report no unresolved conflict;
5. all standard errors are finite and positive.

A duplicate study identity is treated as dependence debt, not as an extra independent study.

## Between-study variance

### REML

The production primary estimator minimizes the restricted likelihood profile for tau². Tau² is constrained to be non-negative.

### Paule–Mandel

The implementation solves the generalized Q equation `Q(tau²) = k - 1` using a bracketed deterministic root search.

### DerSimonian–Laird

DL remains available only as a sensitivity estimator. It uses the standard moment estimator constrained at zero.

## Confidence intervals

### Wald

The primary pooled standard error is `sqrt(1 / sum(w_i))` with random-effects weights `w_i = 1/(v_i + tau²)`.

### HKSJ

Hartung–Knapp–Sidik–Jonkman uses the random-effects residual variance scale and a Student-t critical value with `k - 1` degrees of freedom. The Student-t CDF/quantile is implemented deterministically from the regularized incomplete beta function rather than using a model or external statistics service.

The engine emits warnings when HKSJ is used with very few studies or tau²=0 because interval behavior can be unstable or counterintuitive.

## Prediction intervals

A prediction interval is withheld with fewer than three studies.

For eligible analyses, the interval is centered on the pooled effect and incorporates between-study heterogeneity plus uncertainty in the pooled mean. The HKSJ configuration uses the same finite Student-t multiplier used for its confidence interval.

## Heterogeneity

The artifact retains:

- Cochran Q;
- Q degrees of freedom;
- Q-based I²;
- tau² and tau;
- typical within-study variance;
- tau-based I².

The report must not treat a single heterogeneity statistic as a binary test for whether random effects are needed.

## Effect-measure derivation

`effect-measures.ts` provides deterministic derivations for:

- log risk ratio;
- log odds ratio;
- risk difference;
- mean difference;
- Hedges standardized mean difference;
- standard errors derived from reported 95% confidence intervals on the correct analysis scale.

Zero-cell RR/OR calculations require an explicit continuity-correction policy. No correction is silently inserted.

Every derivation carries an input hash, calculation method, transformations and any continuity correction.

## Method sensitivity

The primary result is never the only retained result. `analyseRandomEffectsSensitivity()` stores all six estimator/interval configurations and reports:

- pooled-effect range;
- tau² range;
- whether method choice changes whether the confidence interval crosses the null.

If null-crossing changes across valid methods, the production synthesis wrapper emits an explicit interpretation warning.

## Production wrapper

`InterventionRandomEffectsSynthesisAgent` runs after existing estimand/dependence guards and promotes only compatible independent rows. It emits:

- the standard downstream `synthesis` artifact for compatibility;
- `interventionRandomEffectsAnalyses` with the full outcome-specific primary and sensitivity calculations.

Ratio measures remain on log scale for analysis and are exponentiated only for display.

## Verification

The numerical suite freezes independent benchmark values for:

- Student-t critical values;
- DL tau²;
- Paule–Mandel tau²;
- REML tau²;
- Wald pooled effect and confidence interval;
- HKSJ variance scaling and interval;
- prediction interval;
- Q and I²;
- exact Hedges small-sample correction;
- RR/OR/RD/MD/SMD derivation;
- zero-cell handling;
- duplicate-study refusal;
- mixed-scale withholding.

## Remaining intervention synthesis work

Before the intervention vertical is production-certified, add:

1. multi-arm covariance-aware synthesis rather than simple dependence refusal;
2. cluster-randomized effect/variance corrections using sourced ICCs;
3. rare-event methods and prespecified zero-event behavior;
4. Mantel–Haenszel binary synthesis where appropriate;
5. generic inverse-variance support for adjusted estimates with explicit adjustment-set compatibility;
6. meta-regression and prespecified subgroup analysis;
7. influence/leave-one-out diagnostics;
8. small-study-effect/funnel asymmetry tools with applicability gates;
9. Bayesian random-effects adapter where requested;
10. independent parity tests against trusted R/metafor and RevMan outputs across a frozen benchmark corpus.
