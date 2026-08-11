import { createHash } from 'node:crypto';

export type GradeCertainty = 'high' | 'moderate' | 'low' | 'very-low';
export type GradeDowngradeDomain = 'risk-of-bias' | 'inconsistency' | 'indirectness' | 'imprecision' | 'publication-bias';
export type GradeUpgradeDomain = 'large-effect' | 'dose-response' | 'residual-confounding';
export type GradeConcern = 'no-serious-concern' | 'serious' | 'very-serious' | 'not-assessable';
export type GradeUpgrade = 'none' | 'one-level' | 'two-levels' | 'not-assessable';
export type GradeEvidenceSource = 'deterministic-policy' | 'model-proposed' | 'human' | 'unresolved';

export interface GradeDecisionReceiptBase {
  rationale: string;
  evidenceIds: string[];
  source: GradeEvidenceSource;
  policyId?: string;
  actorId?: string;
  decidedAt?: string;
}

export interface GradeDowngradeDecision extends GradeDecisionReceiptBase {
  domain: GradeDowngradeDomain;
  concern: GradeConcern;
  metrics: Record<string, number | string | boolean | null>;
}

export interface GradeUpgradeDecision extends GradeDecisionReceiptBase {
  domain: GradeUpgradeDomain;
  upgrade: GradeUpgrade;
  metrics: Record<string, number | string | boolean | null>;
}

export interface GradeOutcomeAssessment {
  version: 1;
  assessmentId: string;
  outcome: string;
  population: string;
  interventionOrExposure: string;
  comparator: string;
  startingCertainty: GradeCertainty;
  downgradeDecisions: GradeDowngradeDecision[];
  upgradeDecisions: GradeUpgradeDecision[];
  downgradeLevels: number;
  upgradeLevels: number;
  finalCertainty?: GradeCertainty;
  status: 'complete' | 'incomplete';
  unresolvedDomains: Array<GradeDowngradeDomain | GradeUpgradeDomain>;
  assessmentHash: string;
}

export interface GradePolicyIdentity {
  id: string;
  protocolHash: string;
  version: string;
  rationale: string;
  frozenAt: string;
}

export interface GradeRiskOfBiasPolicy extends GradePolicyIdentity {
  highRiskWeightSerious: number;
  highRiskWeightVerySerious: number;
  someConcernsWeightSerious: number;
  minimumWeightCoverage?: number;
}

export interface GradeInconsistencyPolicy extends GradePolicyIdentity {
  i2Serious: number;
  i2VerySerious: number;
  predictionIntervalDecisionConflictSerious: boolean;
}

export interface GradeImprecisionPolicy extends GradePolicyIdentity {
  nullValue: number;
  benefitThreshold: number;
  harmThreshold: number;
  requiredInformationSize: number;
  verySeriousOisFraction: number;
}

export interface GradeIndirectnessPolicy extends GradePolicyIdentity {
  seriousIfPartialDimensionsAtLeast: number;
  verySeriousIfIndirectDimensionsAtLeast: number;
}

export interface GradePublicationBiasPolicy extends GradePolicyIdentity {
  seriousSignalWeight: number;
  verySeriousSignalWeight: number;
}

export interface GradePolicySet {
  riskOfBias?: GradeRiskOfBiasPolicy;
  inconsistency?: GradeInconsistencyPolicy;
  imprecision?: GradeImprecisionPolicy;
  indirectness?: GradeIndirectnessPolicy;
  publicationBias?: GradePublicationBiasPolicy;
}

export interface GradeRiskOfBiasEvidence {
  studies: Array<{
    studyId: string;
    weight: number;
    judgement: 'low' | 'some-concerns' | 'high';
    evidenceIds: string[];
  }>;
}

export interface GradeInconsistencyEvidence {
  k: number;
  i2: number;
  tauSquared: number;
  predictionInterval?: [number, number];
  nullValue: number;
  benefitThreshold?: number;
  harmThreshold?: number;
  evidenceIds: string[];
}

export interface GradeImprecisionEvidence {
  confidenceInterval: [number, number];
  totalParticipants: number;
  evidenceIds: string[];
}

export type DirectnessRating = 'direct' | 'partial' | 'indirect';
export interface GradeIndirectnessEvidence {
  population: DirectnessRating;
  interventionOrExposure: DirectnessRating;
  comparator: DirectnessRating;
  outcome: DirectnessRating;
  setting?: DirectnessRating;
  followUp?: DirectnessRating;
  evidenceIds: string[];
}

export interface GradePublicationBiasEvidence {
  signals: Array<{
    id: string;
    description: string;
    strength: number;
    evidenceIds: string[];
  }>;
}

function canonical(value: unknown): string {
  if (value === undefined) return '"__MEDANTIR_UNDEFINED__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function validatePolicy(policy: GradePolicyIdentity): void {
  if (!policy.id.trim() || !policy.protocolHash.trim() || !policy.version.trim() || !policy.rationale.trim()) {
    throw new Error('GRADE policy requires id, protocolHash, version and rationale');
  }
  if (!Number.isFinite(Date.parse(policy.frozenAt))) throw new Error('GRADE policy requires a valid frozenAt timestamp');
}

function validateReceipt(receipt: GradeDecisionReceiptBase): void {
  if (!receipt.rationale.trim()) throw new Error('GRADE decision requires a rationale');
  if (receipt.source === 'deterministic-policy') {
    if (!receipt.policyId?.trim()) throw new Error('Deterministic GRADE decision requires policyId');
    return;
  }
  if (receipt.source === 'unresolved') {
    if (receipt.policyId !== undefined || receipt.actorId !== undefined || receipt.decidedAt !== undefined) {
      throw new Error('Unresolved GRADE decision cannot claim policy or actor authority');
    }
    return;
  }
  if (!receipt.actorId?.trim()) throw new Error(`${receipt.source} GRADE decision requires actorId`);
  if (!receipt.decidedAt || !Number.isFinite(Date.parse(receipt.decidedAt))) {
    throw new Error(`${receipt.source} GRADE decision requires a valid decidedAt timestamp`);
  }
}

function clampWeight(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('GRADE evidence weight must be finite and >= 0');
  return value;
}

function decision(
  domain: GradeDowngradeDomain,
  concern: GradeConcern,
  rationale: string,
  evidenceIds: string[],
  metrics: GradeDowngradeDecision['metrics'],
  policyId?: string,
): GradeDowngradeDecision {
  return {
    domain,
    concern,
    rationale,
    evidenceIds: [...new Set(evidenceIds)],
    metrics,
    source: policyId ? 'deterministic-policy' : 'unresolved',
    ...(policyId ? { policyId } : {}),
  };
}

export function evaluateGradeRiskOfBias(
  evidence: GradeRiskOfBiasEvidence,
  policy?: GradeRiskOfBiasPolicy,
): GradeDowngradeDecision {
  const evidenceIds = evidence.studies.flatMap((study) => study.evidenceIds);
  if (!policy) return decision('risk-of-bias', 'not-assessable', 'No frozen risk-of-bias weighting policy is available.', evidenceIds, { studyCount: evidence.studies.length });
  validatePolicy(policy);
  if (!(policy.highRiskWeightSerious >= 0 && policy.highRiskWeightSerious <= 1)
    || !(policy.highRiskWeightVerySerious >= policy.highRiskWeightSerious && policy.highRiskWeightVerySerious <= 1)
    || !(policy.someConcernsWeightSerious >= 0 && policy.someConcernsWeightSerious <= 1)) {
    throw new Error('GRADE RoB thresholds are invalid');
  }
  const minimumCoverage = policy.minimumWeightCoverage ?? 0.999;
  if (!(minimumCoverage > 0 && minimumCoverage <= 1)) throw new Error('GRADE RoB minimumWeightCoverage must be within (0,1]');
  const weights = evidence.studies.map((study) => ({ ...study, weight: clampWeight(study.weight) }));
  const coveredWeight = weights.reduce((sum, study) => sum + study.weight, 0);
  if (!(coveredWeight > 0)) {
    return decision('risk-of-bias', 'not-assessable', 'No positive synthesis weights are available for outcome-level risk-of-bias assessment.', evidenceIds, { studyCount: weights.length, coveredWeight }, policy.id);
  }
  if (coveredWeight < minimumCoverage || coveredWeight > 1.001) {
    return decision(
      'risk-of-bias',
      'not-assessable',
      `Risk-of-bias assessments cover ${(coveredWeight * 100).toFixed(2)}% of synthesis weight; complete outcome-level weight coverage is required before grading this domain.`,
      evidenceIds,
      { studyCount: weights.length, coveredWeight, minimumWeightCoverage: minimumCoverage },
      policy.id,
    );
  }
  const high = weights.filter((study) => study.judgement === 'high').reduce((sum, study) => sum + study.weight, 0) / coveredWeight;
  const some = weights.filter((study) => study.judgement === 'some-concerns').reduce((sum, study) => sum + study.weight, 0) / coveredWeight;
  const concern: GradeConcern = high >= policy.highRiskWeightVerySerious
    ? 'very-serious'
    : high >= policy.highRiskWeightSerious || some >= policy.someConcernsWeightSerious
      ? 'serious'
      : 'no-serious-concern';
  return decision(
    'risk-of-bias', concern,
    `Weighted high-risk contribution=${high.toFixed(4)} and some-concerns contribution=${some.toFixed(4)} with ${(coveredWeight * 100).toFixed(2)}% synthesis-weight coverage.`,
    evidenceIds,
    { highRiskWeight: high, someConcernsWeight: some, studyCount: weights.length, coveredWeight },
    policy.id,
  );
}

function decisionRegions(interval: [number, number], policy: GradeImprecisionPolicy): Set<'benefit' | 'trivial' | 'harm'> {
  const [low, high] = interval;
  const regions = new Set<'benefit' | 'trivial' | 'harm'>();
  if (low < policy.benefitThreshold) regions.add('benefit');
  if (high > policy.harmThreshold) regions.add('harm');
  if (high >= policy.benefitThreshold && low <= policy.harmThreshold) regions.add('trivial');
  return regions;
}

export function evaluateGradeImprecision(evidence: GradeImprecisionEvidence, policy?: GradeImprecisionPolicy): GradeDowngradeDecision {
  if (!policy) return decision('imprecision', 'not-assessable', 'No frozen imprecision/OIS policy is available.', evidence.evidenceIds, { totalParticipants: evidence.totalParticipants });
  validatePolicy(policy);
  if (!(policy.benefitThreshold < policy.nullValue && policy.nullValue < policy.harmThreshold)) throw new Error('GRADE imprecision thresholds must satisfy benefit < null < harm');
  if (!(policy.requiredInformationSize > 0) || !(policy.verySeriousOisFraction > 0 && policy.verySeriousOisFraction <= 1)) throw new Error('GRADE OIS policy is invalid');
  const [low, high] = evidence.confidenceInterval;
  if (!(Number.isFinite(low) && Number.isFinite(high) && high > low)) throw new Error('GRADE confidence interval is invalid');
  if (!Number.isFinite(evidence.totalParticipants) || evidence.totalParticipants < 0) throw new Error('GRADE totalParticipants is invalid');
  const regions = decisionRegions(evidence.confidenceInterval, policy);
  const oisFraction = evidence.totalParticipants / policy.requiredInformationSize;
  const benefitAndHarm = regions.has('benefit') && regions.has('harm');
  let concern: GradeConcern = 'no-serious-concern';
  if (benefitAndHarm || oisFraction < policy.verySeriousOisFraction) concern = 'very-serious';
  else if (regions.size > 1 || oisFraction < 1) concern = 'serious';
  return decision(
    'imprecision', concern,
    `95% CI spans decision region(s) ${[...regions].join(', ')}; information-size fraction=${oisFraction.toFixed(4)}.`,
    evidence.evidenceIds,
    {
      ciLow: low, ciHigh: high, nullValue: policy.nullValue,
      benefitThreshold: policy.benefitThreshold, harmThreshold: policy.harmThreshold,
      totalParticipants: evidence.totalParticipants, requiredInformationSize: policy.requiredInformationSize,
      oisFraction, decisionRegionCount: regions.size, benefitAndHarm,
    },
    policy.id,
  );
}

export function evaluateGradeInconsistency(evidence: GradeInconsistencyEvidence, policy?: GradeInconsistencyPolicy): GradeDowngradeDecision {
  if (!policy) return decision('inconsistency', 'not-assessable', 'No frozen inconsistency policy is available.', evidence.evidenceIds, { k: evidence.k, i2: evidence.i2, tauSquared: evidence.tauSquared });
  validatePolicy(policy);
  if (!(policy.i2Serious >= 0 && policy.i2Serious <= 100)
    || !(policy.i2VerySerious >= policy.i2Serious && policy.i2VerySerious <= 100)) throw new Error('GRADE inconsistency I² thresholds are invalid');
  if (!Number.isInteger(evidence.k) || evidence.k < 1 || !Number.isFinite(evidence.i2) || evidence.i2 < 0 || evidence.i2 > 100
    || !Number.isFinite(evidence.tauSquared) || evidence.tauSquared < 0) throw new Error('GRADE inconsistency metrics are invalid');
  let predictionConflict = false;
  if (evidence.predictionInterval) {
    const [low, high] = evidence.predictionInterval;
    const benefit = evidence.benefitThreshold ?? evidence.nullValue;
    const harm = evidence.harmThreshold ?? evidence.nullValue;
    predictionConflict = low < benefit && high > harm;
  }
  let concern: GradeConcern = evidence.i2 >= policy.i2VerySerious ? 'very-serious' : evidence.i2 >= policy.i2Serious ? 'serious' : 'no-serious-concern';
  if (policy.predictionIntervalDecisionConflictSerious && predictionConflict && concern === 'no-serious-concern') concern = 'serious';
  return decision(
    'inconsistency', concern,
    `I²=${evidence.i2.toFixed(1)}%, tau²=${evidence.tauSquared.toPrecision(4)}${evidence.predictionInterval ? `, prediction interval=${evidence.predictionInterval[0].toPrecision(4)} to ${evidence.predictionInterval[1].toPrecision(4)}` : ''}.`,
    evidence.evidenceIds,
    { k: evidence.k, i2: evidence.i2, tauSquared: evidence.tauSquared, predictionConflict },
    policy.id,
  );
}

export function evaluateGradeIndirectness(evidence: GradeIndirectnessEvidence, policy?: GradeIndirectnessPolicy): GradeDowngradeDecision {
  const ratings = [evidence.population, evidence.interventionOrExposure, evidence.comparator, evidence.outcome, evidence.setting, evidence.followUp]
    .filter((value): value is DirectnessRating => Boolean(value));
  if (!policy) return decision('indirectness', 'not-assessable', 'No frozen PICO/directness policy is available.', evidence.evidenceIds, { dimensions: ratings.length });
  validatePolicy(policy);
  if (!(policy.seriousIfPartialDimensionsAtLeast >= 1) || !(policy.verySeriousIfIndirectDimensionsAtLeast >= 1)) throw new Error('GRADE indirectness thresholds are invalid');
  const partial = ratings.filter((value) => value === 'partial').length;
  const indirect = ratings.filter((value) => value === 'indirect').length;
  const concern: GradeConcern = indirect >= policy.verySeriousIfIndirectDimensionsAtLeast
    ? 'very-serious'
    : indirect > 0 || partial >= policy.seriousIfPartialDimensionsAtLeast
      ? 'serious'
      : 'no-serious-concern';
  return decision(
    'indirectness', concern,
    `${partial} partial and ${indirect} indirect target-domain dimension(s) were identified.`,
    evidence.evidenceIds,
    { partialDimensions: partial, indirectDimensions: indirect, totalDimensions: ratings.length },
    policy.id,
  );
}

export function evaluateGradePublicationBias(evidence: GradePublicationBiasEvidence, policy?: GradePublicationBiasPolicy): GradeDowngradeDecision {
  const evidenceIds = evidence.signals.flatMap((signal) => signal.evidenceIds);
  if (!policy) return decision('publication-bias', 'not-assessable', 'No frozen publication-bias signal policy is available.', evidenceIds, { signalCount: evidence.signals.length });
  validatePolicy(policy);
  if (!(policy.seriousSignalWeight >= 0) || !(policy.verySeriousSignalWeight >= policy.seriousSignalWeight)) throw new Error('GRADE publication-bias signal thresholds are invalid');
  let totalStrength = 0;
  for (const signal of evidence.signals) {
    if (!signal.id.trim() || !signal.description.trim() || !Number.isFinite(signal.strength) || signal.strength < 0) throw new Error('GRADE publication-bias signal is invalid');
    totalStrength += signal.strength;
  }
  const concern: GradeConcern = totalStrength >= policy.verySeriousSignalWeight
    ? 'very-serious'
    : totalStrength >= policy.seriousSignalWeight
      ? 'serious'
      : 'no-serious-concern';
  return decision(
    'publication-bias', concern,
    `${evidence.signals.length} prespecified publication-bias signal(s) produced total strength ${totalStrength.toFixed(4)}.`,
    evidenceIds,
    { signalCount: evidence.signals.length, totalSignalStrength: totalStrength },
    policy.id,
  );
}

function levels(certainty: GradeCertainty): number {
  return certainty === 'high' ? 3 : certainty === 'moderate' ? 2 : certainty === 'low' ? 1 : 0;
}

function certaintyFromLevels(value: number): GradeCertainty {
  return value >= 3 ? 'high' : value === 2 ? 'moderate' : value === 1 ? 'low' : 'very-low';
}

function downgradeValue(concern: GradeConcern): number {
  return concern === 'serious' ? 1 : concern === 'very-serious' ? 2 : 0;
}

function upgradeValue(upgrade: GradeUpgrade): number {
  return upgrade === 'one-level' ? 1 : upgrade === 'two-levels' ? 2 : 0;
}

export function assessGradeOutcome(input: {
  outcome: string;
  population: string;
  interventionOrExposure: string;
  comparator: string;
  startingCertainty: GradeCertainty;
  downgradeDecisions: GradeDowngradeDecision[];
  upgradeDecisions?: GradeUpgradeDecision[];
}): GradeOutcomeAssessment {
  if (!input.outcome.trim() || !input.population.trim() || !input.interventionOrExposure.trim() || !input.comparator.trim()) {
    throw new Error('GRADE outcome assessment requires outcome/PICO identity');
  }
  const downgradeDomains = new Set<GradeDowngradeDomain>();
  for (const item of input.downgradeDecisions) {
    validateReceipt(item);
    if (downgradeDomains.has(item.domain)) throw new Error(`Duplicate GRADE downgrade domain ${item.domain}`);
    downgradeDomains.add(item.domain);
  }
  const required: GradeDowngradeDomain[] = ['risk-of-bias', 'inconsistency', 'indirectness', 'imprecision', 'publication-bias'];
  const upgrades = input.upgradeDecisions ?? [];
  const upgradeDomains = new Set<GradeUpgradeDomain>();
  for (const item of upgrades) {
    validateReceipt(item);
    if (upgradeDomains.has(item.domain)) throw new Error(`Duplicate GRADE upgrade domain ${item.domain}`);
    upgradeDomains.add(item.domain);
  }
  const unresolvedDomains = [
    ...required.filter((domain) => !downgradeDomains.has(domain)),
    ...input.downgradeDecisions.filter((item) => item.concern === 'not-assessable').map((item) => item.domain),
    ...upgrades.filter((item) => item.upgrade === 'not-assessable').map((item) => item.domain),
  ] as Array<GradeDowngradeDomain | GradeUpgradeDomain>;
  const uniqueUnresolved = [...new Set(unresolvedDomains)];
  const downgradeLevels = input.downgradeDecisions.reduce((total, item) => total + downgradeValue(item.concern), 0);
  const upgradeLevels = upgrades.reduce((total, item) => total + upgradeValue(item.upgrade), 0);
  const complete = uniqueUnresolved.length === 0;
  const finalLevel = Math.max(0, Math.min(3, levels(input.startingCertainty) - downgradeLevels + upgradeLevels));
  const hashable = {
    version: 1 as const,
    outcome: input.outcome.trim(),
    population: input.population.trim(),
    interventionOrExposure: input.interventionOrExposure.trim(),
    comparator: input.comparator.trim(),
    startingCertainty: input.startingCertainty,
    downgradeDecisions: input.downgradeDecisions,
    upgradeDecisions: upgrades,
    downgradeLevels,
    upgradeLevels,
    ...(complete ? { finalCertainty: certaintyFromLevels(finalLevel) } : {}),
    status: complete ? 'complete' as const : 'incomplete' as const,
    unresolvedDomains: uniqueUnresolved,
  };
  return {
    ...hashable,
    assessmentId: `grade-${hash({ outcome: hashable.outcome, population: hashable.population, interventionOrExposure: hashable.interventionOrExposure, comparator: hashable.comparator }).slice(0, 24)}`,
    assessmentHash: hash(hashable),
  };
}
