import { scientificContentHash } from '../core/canonical-hash.js';

export const HISTORICAL_NUMERIC_TRANSFORM_SCHEMA_VERSION = 'medantir-historical-numeric-transform/1' as const;
export const HISTORICAL_NUMERIC_TRANSFORM_CONTRACT_VERSION = 'historical-numeric-transform-contract/1' as const;

export type HistoricalNumericTransformOperation =
  | 'identity'
  | 'se-to-sd'
  | 'ci95-to-se'
  | 'unit-scale'
  | 'combine-two-groups-mean'
  | 'combine-two-groups-sd'
  | 'change-score-sd'
  | 'custom-documented';

export type HistoricalNumericTransformEpistemicClass =
  | 'direct'
  | 'deterministic-derived'
  | 'assumption-derived';

export interface HistoricalNumericOperand {
  name: string;
  value: number;
  unit?: string;
  sourceObjectId?: string;
  sourceSha256?: string;
  sourceLocator?: string;
  verbatimEvidence?: string;
}

export interface HistoricalNumericTransformationInput {
  transformationId: string;
  operation: HistoricalNumericTransformOperation;
  operands: HistoricalNumericOperand[];
  parameters?: Record<string, number | string | boolean>;
  outputUnit?: string;
  epistemicClass: HistoricalNumericTransformEpistemicClass;
  methodReference?: string;
  originalReviewMethodDocumented: boolean;
}

export interface HistoricalNumericTransformationReceipt extends HistoricalNumericTransformationInput {
  contractVersion: typeof HISTORICAL_NUMERIC_TRANSFORM_CONTRACT_VERSION;
  algorithmContractHash: string;
  outputValue: number;
  replayExact: boolean;
  originalMethodProvenance: 'documented' | 'undocumented';
  transformationHash: string;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function operandMap(operands: HistoricalNumericOperand[]): Map<string, HistoricalNumericOperand> {
  const map = new Map<string, HistoricalNumericOperand>();
  for (const operand of operands) {
    const name = clean(operand.name);
    if (!name) throw new Error('Historical numeric transformation operand requires a name.');
    if (map.has(name)) throw new Error(`Historical numeric transformation duplicates operand '${name}'.`);
    finite(operand.value, `Operand '${name}'`);
    map.set(name, { ...operand, name });
  }
  return map;
}

function required(map: Map<string, HistoricalNumericOperand>, name: string): number {
  const operand = map.get(name);
  if (!operand) throw new Error(`Historical numeric transformation requires operand '${name}'.`);
  return operand.value;
}

function parameter(input: HistoricalNumericTransformationInput, name: string): number {
  const value = input.parameters?.[name];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Historical numeric transformation requires numeric parameter '${name}'.`);
  return value;
}

function calculate(input: HistoricalNumericTransformationInput): number {
  const operands = operandMap(input.operands);
  switch (input.operation) {
    case 'identity':
      return required(operands, 'value');
    case 'se-to-sd': {
      const se = required(operands, 'se');
      const n = required(operands, 'n');
      if (n <= 0) throw new Error('SE-to-SD requires n > 0.');
      return se * Math.sqrt(n);
    }
    case 'ci95-to-se': {
      const lower = required(operands, 'lower');
      const upper = required(operands, 'upper');
      if (!(upper > lower)) throw new Error('CI-to-SE requires upper > lower.');
      return (upper - lower) / (2 * 1.959963984540054);
    }
    case 'unit-scale':
      return required(operands, 'value') * parameter(input, 'factor');
    case 'combine-two-groups-mean': {
      const n1 = required(operands, 'n1');
      const n2 = required(operands, 'n2');
      const mean1 = required(operands, 'mean1');
      const mean2 = required(operands, 'mean2');
      if (n1 <= 0 || n2 <= 0) throw new Error('Combined mean requires positive group sizes.');
      return ((n1 * mean1) + (n2 * mean2)) / (n1 + n2);
    }
    case 'combine-two-groups-sd': {
      const n1 = required(operands, 'n1');
      const n2 = required(operands, 'n2');
      const mean1 = required(operands, 'mean1');
      const mean2 = required(operands, 'mean2');
      const sd1 = required(operands, 'sd1');
      const sd2 = required(operands, 'sd2');
      if (n1 <= 1 || n2 <= 1 || sd1 < 0 || sd2 < 0) throw new Error('Combined SD requires n1,n2 > 1 and non-negative SDs.');
      const mean = ((n1 * mean1) + (n2 * mean2)) / (n1 + n2);
      const numerator = ((n1 - 1) * sd1 * sd1)
        + ((n2 - 1) * sd2 * sd2)
        + (n1 * (mean1 - mean) ** 2)
        + (n2 * (mean2 - mean) ** 2);
      return Math.sqrt(numerator / (n1 + n2 - 1));
    }
    case 'change-score-sd': {
      const baselineSd = required(operands, 'baselineSd');
      const finalSd = required(operands, 'finalSd');
      const correlation = parameter(input, 'correlation');
      if (baselineSd < 0 || finalSd < 0) throw new Error('Change-score SD requires non-negative SDs.');
      if (correlation < -1 || correlation > 1) throw new Error('Change-score correlation must lie in [-1,1].');
      const variance = (baselineSd ** 2) + (finalSd ** 2) - (2 * correlation * baselineSd * finalSd);
      if (variance < -1e-12) throw new Error('Change-score SD produced a negative variance.');
      return Math.sqrt(Math.max(0, variance));
    }
    case 'custom-documented': {
      const output = input.parameters?.outputValue;
      if (typeof output !== 'number' || !Number.isFinite(output)) {
        throw new Error('custom-documented transformation requires numeric parameters.outputValue.');
      }
      if (!input.methodReference?.trim()) throw new Error('custom-documented transformation requires methodReference.');
      return output;
    }
  }
}

function algorithmContract(operation: HistoricalNumericTransformOperation): unknown {
  return {
    contractVersion: HISTORICAL_NUMERIC_TRANSFORM_CONTRACT_VERSION,
    operation,
    formulas: {
      identity: 'value',
      'se-to-sd': 'SE*sqrt(n)',
      'ci95-to-se': '(upper-lower)/(2*1.959963984540054)',
      'unit-scale': 'value*factor',
      'combine-two-groups-mean': '(n1*mean1+n2*mean2)/(n1+n2)',
      'combine-two-groups-sd': 'sqrt(((n1-1)sd1^2+(n2-1)sd2^2+n1(mean1-M)^2+n2(mean2-M)^2)/(n1+n2-1))',
      'change-score-sd': 'sqrt(SDb^2+SDf^2-2*r*SDb*SDf)',
      'custom-documented': 'explicit documented output; methodReference required',
    }[operation],
  };
}

export function historicalNumericTransformationContractHash(operation: HistoricalNumericTransformOperation): string {
  return scientificContentHash(algorithmContract(operation));
}

export function executeHistoricalNumericTransformation(
  input: HistoricalNumericTransformationInput,
): HistoricalNumericTransformationReceipt {
  const transformationId = clean(input.transformationId);
  if (!transformationId) throw new Error('Historical numeric transformation requires transformationId.');
  if (input.epistemicClass === 'direct' && input.operation !== 'identity') {
    throw new Error(`Direct numeric provenance may only use identity transformation, not '${input.operation}'.`);
  }
  if (input.epistemicClass === 'assumption-derived' && input.operation !== 'change-score-sd' && input.operation !== 'custom-documented') {
    throw new Error(`Assumption-derived transformation '${input.operation}' is not an assumption-bearing operation.`);
  }
  if ((input.epistemicClass === 'assumption-derived' || input.operation === 'custom-documented') && !input.methodReference?.trim()) {
    throw new Error(`${input.epistemicClass} transformation '${transformationId}' requires a method reference.`);
  }
  const outputValue = finite(calculate(input), `Transformation '${transformationId}' output`);
  const algorithmContractHash = historicalNumericTransformationContractHash(input.operation);
  const normalized: HistoricalNumericTransformationInput = {
    ...input,
    transformationId,
    operands: input.operands.map((operand) => ({
      ...operand,
      name: clean(operand.name),
      ...(operand.unit?.trim() ? { unit: clean(operand.unit) } : {}),
      ...(operand.sourceLocator?.trim() ? { sourceLocator: clean(operand.sourceLocator) } : {}),
      ...(operand.verbatimEvidence?.trim() ? { verbatimEvidence: clean(operand.verbatimEvidence) } : {}),
    })),
    ...(input.methodReference?.trim() ? { methodReference: clean(input.methodReference) } : {}),
  };
  const withoutHash = {
    ...normalized,
    contractVersion: HISTORICAL_NUMERIC_TRANSFORM_CONTRACT_VERSION,
    algorithmContractHash,
    outputValue,
    replayExact: true,
    originalMethodProvenance: input.originalReviewMethodDocumented ? 'documented' as const : 'undocumented' as const,
  };
  return { ...withoutHash, transformationHash: scientificContentHash(withoutHash) };
}
