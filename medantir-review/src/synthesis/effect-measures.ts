import { createHash } from 'node:crypto';

export type BinaryEffectMeasure = 'RR' | 'OR' | 'RD';
export type ContinuousEffectMeasure = 'MD' | 'SMD';
export type ContinuityCorrectionPolicy = 'none' | 'constant-0.5-if-any-zero';

export interface DerivedEffectEstimate {
  measure: BinaryEffectMeasure | ContinuousEffectMeasure;
  analysisScale: 'log' | 'identity';
  effect: number;
  standardError: number;
  displayEffect: number;
  derivation: {
    method: string;
    inputHash: string;
    inputs: Record<string, number | string>;
    transformations: string[];
    continuityCorrectionApplied?: number;
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function count(name: string, value: number, allowZero = true): void {
  finite(name, value);
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${name} must be an integer ${allowZero ? '>= 0' : '> 0'}`);
}

function positive(name: string, value: number): void {
  finite(name, value);
  if (!(value > 0)) throw new Error(`${name} must be > 0`);
}

function binaryCells(input: {
  interventionEvents: number;
  interventionTotal: number;
  comparatorEvents: number;
  comparatorTotal: number;
  continuityCorrection?: ContinuityCorrectionPolicy;
}) {
  count('interventionEvents', input.interventionEvents);
  count('interventionTotal', input.interventionTotal, false);
  count('comparatorEvents', input.comparatorEvents);
  count('comparatorTotal', input.comparatorTotal, false);
  if (input.interventionEvents > input.interventionTotal) throw new Error('interventionEvents cannot exceed interventionTotal');
  if (input.comparatorEvents > input.comparatorTotal) throw new Error('comparatorEvents cannot exceed comparatorTotal');
  const raw = {
    a: input.interventionEvents,
    b: input.interventionTotal - input.interventionEvents,
    c: input.comparatorEvents,
    d: input.comparatorTotal - input.comparatorEvents,
  };
  const policy = input.continuityCorrection ?? 'none';
  const anyZero = Object.values(raw).some((value) => value === 0);
  if (!anyZero) return { ...raw, correction: 0, policy };
  if (policy === 'none') return { ...raw, correction: 0, policy };
  if (policy === 'constant-0.5-if-any-zero') {
    return { a: raw.a + 0.5, b: raw.b + 0.5, c: raw.c + 0.5, d: raw.d + 0.5, correction: 0.5, policy };
  }
  throw new Error(`Unsupported continuity correction policy ${String(policy)}`);
}

export function deriveBinaryEffect(input: {
  measure: BinaryEffectMeasure;
  interventionEvents: number;
  interventionTotal: number;
  comparatorEvents: number;
  comparatorTotal: number;
  continuityCorrection?: ContinuityCorrectionPolicy;
}): DerivedEffectEstimate {
  const cells = binaryCells(input);
  const { a, b, c, d } = cells;
  const n1 = a + b;
  const n0 = c + d;
  const transformations: string[] = [];
  let effect: number;
  let standardError: number;
  let analysisScale: 'log' | 'identity';
  let displayEffect: number;

  if (input.measure === 'RR') {
    if (a === 0 || c === 0) throw new Error('RR is undefined with a zero event arm unless an explicit continuity-correction policy is selected');
    const p1 = a / n1;
    const p0 = c / n0;
    effect = Math.log(p1 / p0);
    standardError = Math.sqrt((1 / a) - (1 / n1) + (1 / c) - (1 / n0));
    analysisScale = 'log';
    displayEffect = Math.exp(effect);
    transformations.push('risk ratio -> natural logarithm for inverse-variance analysis');
  } else if (input.measure === 'OR') {
    if ([a, b, c, d].some((value) => value === 0)) throw new Error('OR is undefined with a zero 2x2 cell unless an explicit continuity-correction policy is selected');
    effect = Math.log((a * d) / (b * c));
    standardError = Math.sqrt((1 / a) + (1 / b) + (1 / c) + (1 / d));
    analysisScale = 'log';
    displayEffect = Math.exp(effect);
    transformations.push('odds ratio -> natural logarithm for inverse-variance analysis');
  } else {
    // Risk difference can be calculated without a continuity correction. If the
    // caller selected a correction it is intentionally applied to the 2x2 table
    // and recorded in the derivation receipt.
    const p1 = a / n1;
    const p0 = c / n0;
    effect = p1 - p0;
    standardError = Math.sqrt((p1 * (1 - p1) / n1) + (p0 * (1 - p0) / n0));
    analysisScale = 'identity';
    displayEffect = effect;
    transformations.push('risk difference retained on identity scale');
  }
  if (!(standardError > 0) || !Number.isFinite(standardError)) throw new Error(`${input.measure} standard error is non-positive or non-finite`);

  const inputs = {
    interventionEvents: input.interventionEvents,
    interventionTotal: input.interventionTotal,
    comparatorEvents: input.comparatorEvents,
    comparatorTotal: input.comparatorTotal,
    continuityCorrection: input.continuityCorrection ?? 'none',
  } as const;
  return {
    measure: input.measure,
    analysisScale,
    effect,
    standardError,
    displayEffect,
    derivation: {
      method: input.measure === 'RR'
        ? 'log risk ratio with large-sample inverse-variance standard error'
        : input.measure === 'OR'
          ? 'log odds ratio with Woolf inverse-variance standard error'
          : 'risk difference with independent-binomial standard error',
      inputHash: hash(inputs),
      inputs,
      transformations,
      ...(cells.correction > 0 ? { continuityCorrectionApplied: cells.correction } : {}),
    },
  };
}

function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  let x = 0.99999999999980993;
  const shifted = z - 1;
  for (let i = 0; i < coefficients.length; i += 1) x += coefficients[i]! / (shifted + i + 1);
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function hedgesCorrection(df: number): number {
  if (!(df > 1)) throw new Error('SMD Hedges correction requires total degrees of freedom > 1');
  return Math.exp(logGamma(df / 2) - 0.5 * Math.log(df / 2) - logGamma((df - 1) / 2));
}

export function deriveContinuousEffect(input: {
  measure: ContinuousEffectMeasure;
  interventionMean: number;
  interventionSd: number;
  interventionN: number;
  comparatorMean: number;
  comparatorSd: number;
  comparatorN: number;
}): DerivedEffectEstimate {
  finite('interventionMean', input.interventionMean);
  finite('comparatorMean', input.comparatorMean);
  positive('interventionSd', input.interventionSd);
  positive('comparatorSd', input.comparatorSd);
  count('interventionN', input.interventionN, false);
  count('comparatorN', input.comparatorN, false);
  if (input.interventionN < 2 || input.comparatorN < 2) throw new Error('Continuous-effect calculation requires at least two participants per group');

  const inputs = {
    interventionMean: input.interventionMean,
    interventionSd: input.interventionSd,
    interventionN: input.interventionN,
    comparatorMean: input.comparatorMean,
    comparatorSd: input.comparatorSd,
    comparatorN: input.comparatorN,
  };
  if (input.measure === 'MD') {
    const effect = input.interventionMean - input.comparatorMean;
    const standardError = Math.sqrt(
      (input.interventionSd ** 2 / input.interventionN)
      + (input.comparatorSd ** 2 / input.comparatorN),
    );
    return {
      measure: 'MD',
      analysisScale: 'identity',
      effect,
      standardError,
      displayEffect: effect,
      derivation: {
        method: 'mean difference with independent-group standard error',
        inputHash: hash(inputs),
        inputs,
        transformations: ['intervention mean - comparator mean'],
      },
    };
  }

  const df = input.interventionN + input.comparatorN - 2;
  const pooledSd = Math.sqrt(
    (((input.interventionN - 1) * input.interventionSd ** 2)
      + ((input.comparatorN - 1) * input.comparatorSd ** 2)) / df,
  );
  if (!(pooledSd > 0)) throw new Error('SMD pooled standard deviation must be > 0');
  const cohenD = (input.interventionMean - input.comparatorMean) / pooledSd;
  const j = hedgesCorrection(df);
  const effect = j * cohenD;
  const variance = (j ** 2) * (
    ((input.interventionN + input.comparatorN) / (input.interventionN * input.comparatorN))
    + ((cohenD ** 2) / (2 * df))
  );
  const standardError = Math.sqrt(variance);
  if (!(standardError > 0) || !Number.isFinite(standardError)) throw new Error('SMD standard error is non-positive or non-finite');
  return {
    measure: 'SMD',
    analysisScale: 'identity',
    effect,
    standardError,
    displayEffect: effect,
    derivation: {
      method: 'Hedges g using exact gamma-function small-sample correction and independent-group variance',
      inputHash: hash(inputs),
      inputs: { ...inputs, degreesOfFreedom: df, pooledSd, hedgesCorrection: j, cohenD },
      transformations: ['pooled within-group SD', 'Cohen d', 'exact Hedges small-sample correction'],
    },
  };
}

export function deriveEffectFromConfidenceInterval(input: {
  measure: BinaryEffectMeasure | ContinuousEffectMeasure | 'HR';
  reportedEffect: number;
  confidenceLow: number;
  confidenceHigh: number;
  confidenceLevel?: 0.95;
}): DerivedEffectEstimate {
  const level = input.confidenceLevel ?? 0.95;
  if (level !== 0.95) throw new Error('Only 95% confidence-interval SE derivation is currently certified');
  finite('reportedEffect', input.reportedEffect);
  finite('confidenceLow', input.confidenceLow);
  finite('confidenceHigh', input.confidenceHigh);
  if (!(input.confidenceHigh > input.confidenceLow)) throw new Error('confidenceHigh must exceed confidenceLow');
  const ratioMeasure = input.measure === 'RR' || input.measure === 'OR' || input.measure === 'HR';
  if (ratioMeasure && (!(input.reportedEffect > 0) || !(input.confidenceLow > 0) || !(input.confidenceHigh > 0))) {
    throw new Error(`${input.measure} effect and confidence limits must be > 0`);
  }
  const z = 1.959963984540054;
  const effect = ratioMeasure ? Math.log(input.reportedEffect) : input.reportedEffect;
  const lower = ratioMeasure ? Math.log(input.confidenceLow) : input.confidenceLow;
  const upper = ratioMeasure ? Math.log(input.confidenceHigh) : input.confidenceHigh;
  const standardError = (upper - lower) / (2 * z);
  if (!(standardError > 0) || !Number.isFinite(standardError)) throw new Error('Derived standard error is invalid');
  const inputs = {
    reportedEffect: input.reportedEffect,
    confidenceLow: input.confidenceLow,
    confidenceHigh: input.confidenceHigh,
    confidenceLevel: level,
  };
  return {
    measure: input.measure as BinaryEffectMeasure | ContinuousEffectMeasure,
    analysisScale: ratioMeasure ? 'log' : 'identity',
    effect,
    standardError,
    displayEffect: ratioMeasure ? Math.exp(effect) : effect,
    derivation: {
      method: 'standard error derived from symmetric 95% confidence interval on the certified analysis scale',
      inputHash: hash(inputs),
      inputs,
      transformations: ratioMeasure
        ? ['reported ratio and limits -> natural-log scale', 'SE = (log upper - log lower)/(2*1.95996398454)']
        : ['SE = (upper - lower)/(2*1.95996398454)'],
    },
  };
}
