import type {
  Agent,
  AgentContext,
  AgentResult,
  ExtractedStudy,
  SynthesisResult,
} from '../core/types.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type {
  QuantitativeAnalysisScale,
  QuantitativeEffectMeasure,
  QuantitativeExtractionLedgerRow,
} from './provenance-first-extraction.js';
import type { StudyFamilyReportRole } from './study-family-linkage.js';

export type EstimandDimensionStatus = 'resolved' | 'unspecified' | 'ambiguous';

export interface EstimandDimension<T extends string> {
  status: EstimandDimensionStatus;
  value?: T;
  candidates?: T[];
  evidence: string[];
}

export type EstimandAnalysisPopulation =
  | 'intention-to-treat'
  | 'modified-intention-to-treat'
  | 'per-protocol'
  | 'as-treated'
  | 'safety-population';

export type EstimandAdjustment = 'adjusted' | 'unadjusted';
export type EstimandSubgroup = 'overall' | 'subgroup';
export type EstimandEffectTarget = 'total-effect' | 'direct-effect' | 'indirect-effect';

export interface CanonicalEstimand {
  estimandId: string;
  outcome: string;
  effectMeasure: QuantitativeEffectMeasure;
  analysisScale: QuantitativeAnalysisScale;
  interventionOrExposure: string;
  comparator: string;
  population: string;
  timeHorizon: EstimandDimension<string>;
  analysisPopulation: EstimandDimension<EstimandAnalysisPopulation>;
  subgroup: EstimandDimension<EstimandSubgroup> & { label?: string };
  adjustment: EstimandDimension<EstimandAdjustment>;
  effectTarget: EstimandDimension<EstimandEffectTarget>;
  source: {
    recordId: string;
    studyId: string;
    studyFamilyId?: string;
    reportRole?: StudyFamilyReportRole;
    tableId?: string;
    tableHeading?: string;
    rowLabel?: string;
    columnHeader?: string;
    page?: number;
    verbatim?: string;
  };
  unresolvedDimensions: string[];
}

export interface EstimandLedgerRow {
  studyId: string;
  recordId: string;
  studyFamilyId?: string;
  outcome: string;
  status: 'identified' | 'blocked-no-quantitative-estimate';
  estimand?: CanonicalEstimand;
  reason?: string;
}

export type EstimandRelationship = 'same' | 'different' | 'unresolved';

export interface EstimandComparison {
  relationship: EstimandRelationship;
  differingDimensions: string[];
  unresolvedDimensions: string[];
}

type FamilyAwareStudy = ExtractedStudy & {
  studyFamilyId?: string;
  reportRole?: StudyFamilyReportRole;
};

type EstimandAwareOutcome = ExtractedStudy['outcomes'][number] & {
  effectMeasure?: QuantitativeEffectMeasure;
  analysisScale?: QuantitativeAnalysisScale;
  estimandId?: string;
  estimand?: CanonicalEstimand;
};

type NumericEstimandRow = {
  studyId: string;
  recordId: string;
  familyId: string;
  outcome: string;
  effectMeasure: string;
  analysisScale: string;
  estimand: CanonicalEstimand;
};

function sourceEvidence(ledger: QuantitativeExtractionLedgerRow, outcome: string): string[] {
  return [outcome, ledger.rowLabel, ledger.tableHeading, ledger.columnHeader, ledger.verbatim]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function dimension<T extends string>(values: T[], evidence: string[]): EstimandDimension<T> {
  const candidates = unique(values);
  if (candidates.length === 1) return { status: 'resolved', value: candidates[0]!, evidence };
  if (candidates.length > 1) return { status: 'ambiguous', candidates, evidence };
  return { status: 'unspecified', evidence };
}

function canonicalTime(value: string, unit: string): string {
  const n = Number(value);
  const normalizedUnit = unit.toLowerCase();
  if (/^d/.test(normalizedUnit)) return `${n}-day`;
  if (/^w/.test(normalizedUnit)) return `${n}-week`;
  if (/^mo/.test(normalizedUnit)) return `${n}-month`;
  if (/^y/.test(normalizedUnit)) return `${n}-year`;
  if (/^h/.test(normalizedUnit)) return `${n}-hour`;
  return `${n}-${normalizedUnit}`;
}

function timeHorizon(evidence: string[]): EstimandDimension<string> {
  const values: string[] = [];
  const patterns = [
    /\b(?:day|days)\s*(\d{1,4})\b/gi,
    /\b(?:week|weeks)\s*(\d{1,3})\b/gi,
    /\b(?:month|months)\s*(\d{1,3})\b/gi,
    /\b(?:year|years)\s*(\d{1,3})\b/gi,
    /\b(?:hour|hours)\s*(\d{1,4})\b/gi,
  ];
  const reversed = /\b(\d{1,4})\s*[- ]?(hours?|days?|weeks?|months?|years?)\b/gi;
  for (const text of evidence) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const unit = match[0]?.match(/hour|day|week|month|year/i)?.[0];
        if (match[1] && unit) values.push(canonicalTime(match[1], unit));
      }
    }
    reversed.lastIndex = 0;
    for (const match of text.matchAll(reversed)) {
      if (match[1] && match[2]) values.push(canonicalTime(match[1], match[2]));
    }
  }
  return dimension(values, evidence.filter((text) => /\b(?:hour|day|week|month|year)s?\b/i.test(text)));
}

function analysisPopulation(evidence: string[]): EstimandDimension<EstimandAnalysisPopulation> {
  const values: EstimandAnalysisPopulation[] = [];
  for (const text of evidence) {
    const value = normaliseText(text);
    if (/\bmodified intention to treat\b|\bmodified intent to treat\b|\bmitt\b/.test(value)) {
      values.push('modified-intention-to-treat');
      continue;
    }
    if (/\bintention to treat\b|\bintent to treat\b|\bitt population\b|\bitt analysis\b/.test(value)) values.push('intention-to-treat');
    if (/\bper protocol\b/.test(value)) values.push('per-protocol');
    if (/\bas treated\b/.test(value)) values.push('as-treated');
    if (/\bsafety population\b|\bsafety set\b/.test(value)) values.push('safety-population');
  }
  return dimension(values, evidence.filter((text) => /intention|intent|\bitt\b|per[- ]protocol|as[- ]treated|safety (?:population|set)/i.test(text)));
}

function subgroupDimension(evidence: string[]): EstimandDimension<EstimandSubgroup> & { label?: string } {
  const overallEvidence = evidence.filter((text) => /\boverall\b|\ball participants\b|\ball patients\b|\bentire cohort\b|\btotal population\b/i.test(text));
  const subgroupEvidence = evidence.filter((text) => /\bsubgroup\b|\bstratum\b|\bstratified\b/i.test(text));
  if (overallEvidence.length > 0 && subgroupEvidence.length > 0) {
    return { status: 'ambiguous', candidates: ['overall', 'subgroup'], evidence: unique([...overallEvidence, ...subgroupEvidence]) };
  }
  if (subgroupEvidence.length > 0) {
    const label = subgroupEvidence[0]!.slice(0, 240);
    return { status: 'resolved', value: 'subgroup', label, evidence: subgroupEvidence };
  }
  if (overallEvidence.length > 0) return { status: 'resolved', value: 'overall', evidence: overallEvidence };
  return { status: 'unspecified', evidence: [] };
}

function adjustmentDimension(evidence: string[]): EstimandDimension<EstimandAdjustment> {
  const values: EstimandAdjustment[] = [];
  for (const text of evidence) {
    const value = normaliseText(text);
    if (/\bunadjusted\b|\bcrude\b/.test(value)) values.push('unadjusted');
    if (/\badjusted\b|\bmultivariable\b|\bmultivariate\b|\bcovariate adjusted\b/.test(value) && !/\bunadjusted\b/.test(value)) values.push('adjusted');
  }
  return dimension(values, evidence.filter((text) => /adjusted|unadjusted|crude|multivariable|multivariate|covariate/i.test(text)));
}

function effectTargetDimension(evidence: string[]): EstimandDimension<EstimandEffectTarget> {
  const values: EstimandEffectTarget[] = [];
  for (const text of evidence) {
    const value = normaliseText(text);
    if (/\bnatural direct effect\b|\bcontrolled direct effect\b|\bdirect effect\b/.test(value)) values.push('direct-effect');
    if (/\bindirect effect\b|\bmediated effect\b|\bmediation effect\b/.test(value)) values.push('indirect-effect');
    if (/\btotal effect\b/.test(value)) values.push('total-effect');
  }
  return dimension(values, evidence.filter((text) => /direct effect|indirect effect|mediated effect|mediation effect|total effect/i.test(text)));
}

function fingerprintDimension<T extends string>(value: EstimandDimension<T>): unknown {
  if (value.status === 'resolved') return { status: value.status, value: value.value };
  if (value.status === 'ambiguous') return { status: value.status, candidates: value.candidates };
  return { status: value.status };
}

function fingerprintSubgroup(value: EstimandDimension<EstimandSubgroup> & { label?: string }): unknown {
  if (value.status === 'resolved') {
    return {
      status: value.status,
      value: value.value,
      ...(value.value === 'subgroup' ? { label: value.label ? normaliseText(value.label) : null } : {}),
    };
  }
  if (value.status === 'ambiguous') return { status: value.status, candidates: value.candidates };
  return { status: value.status };
}

function buildEstimand(
  study: FamilyAwareStudy,
  outcome: EstimandAwareOutcome,
  ledger: QuantitativeExtractionLedgerRow,
): CanonicalEstimand {
  if (!outcome.effectMeasure || !outcome.analysisScale) {
    throw new Error(`Estimand identity requires typed effect measure and analysis scale for ${study.studyId} / ${outcome.name}.`);
  }
  const evidence = sourceEvidence(ledger, outcome.name);
  const time = timeHorizon(evidence);
  const population = analysisPopulation(evidence);
  const subgroup = subgroupDimension(evidence);
  const adjustment = adjustmentDimension(evidence);
  const effectTarget = effectTargetDimension(evidence);
  const interventionOrExposure = normaliseText(study.interventionOrExposure);
  const comparator = normaliseText(study.comparator);
  const targetPopulation = normaliseText(study.population);
  const normalizedOutcome = normaliseText(outcome.name);
  const unresolvedDimensions = [
    ['timeHorizon', time],
    ['analysisPopulation', population],
    ['subgroup', subgroup],
    ['adjustment', adjustment],
    ['effectTarget', effectTarget],
  ].filter(([, value]) => (value as EstimandDimension<string>).status !== 'resolved').map(([name]) => String(name));
  if (subgroup.status === 'resolved' && subgroup.value === 'subgroup' && !subgroup.label?.trim()) {
    unresolvedDimensions.push('subgroupLabel');
  }

  const identity = {
    outcome: normalizedOutcome,
    effectMeasure: outcome.effectMeasure,
    analysisScale: outcome.analysisScale,
    interventionOrExposure,
    comparator,
    population: targetPopulation,
    timeHorizon: fingerprintDimension(time),
    analysisPopulation: fingerprintDimension(population),
    subgroup: fingerprintSubgroup(subgroup),
    adjustment: fingerprintDimension(adjustment),
    effectTarget: fingerprintDimension(effectTarget),
  };

  return {
    estimandId: `estimand-${stableHash(identity).slice(0, 24)}`,
    outcome: outcome.name,
    effectMeasure: outcome.effectMeasure,
    analysisScale: outcome.analysisScale,
    interventionOrExposure,
    comparator,
    population: targetPopulation,
    timeHorizon: time,
    analysisPopulation: population,
    subgroup,
    adjustment,
    effectTarget,
    source: {
      recordId: ledger.recordId,
      studyId: study.studyId,
      ...(study.studyFamilyId ? { studyFamilyId: study.studyFamilyId } : {}),
      ...(study.reportRole ? { reportRole: study.reportRole } : {}),
      ...(ledger.tableId ? { tableId: ledger.tableId } : {}),
      ...(ledger.tableHeading ? { tableHeading: ledger.tableHeading } : {}),
      ...(ledger.rowLabel ? { rowLabel: ledger.rowLabel } : {}),
      ...(ledger.columnHeader ? { columnHeader: ledger.columnHeader } : {}),
      ...(ledger.page ? { page: ledger.page } : {}),
      ...(ledger.verbatim ? { verbatim: ledger.verbatim } : {}),
    },
    unresolvedDimensions,
  };
}

function compareDimension<T extends string>(
  name: string,
  left: EstimandDimension<T>,
  right: EstimandDimension<T>,
  differing: string[],
  unresolved: string[],
): void {
  if (left.status === 'resolved' && right.status === 'resolved') {
    if (left.value !== right.value) differing.push(name);
    return;
  }
  if (left.status === 'ambiguous' || right.status === 'ambiguous') {
    unresolved.push(name);
    return;
  }
  if (left.status !== right.status) {
    unresolved.push(name);
    return;
  }
  if (left.status === 'unspecified') unresolved.push(name);
}

export function compareEstimands(left: CanonicalEstimand, right: CanonicalEstimand): EstimandComparison {
  const differing: string[] = [];
  const unresolved: string[] = [];
  if (normaliseText(left.outcome) !== normaliseText(right.outcome)) differing.push('outcome');
  if (left.effectMeasure !== right.effectMeasure) differing.push('effectMeasure');
  if (left.analysisScale !== right.analysisScale) differing.push('analysisScale');
  if (left.interventionOrExposure !== right.interventionOrExposure) differing.push('interventionOrExposure');
  if (left.comparator !== right.comparator) differing.push('comparator');
  if (left.population !== right.population) differing.push('population');
  compareDimension('timeHorizon', left.timeHorizon, right.timeHorizon, differing, unresolved);
  compareDimension('analysisPopulation', left.analysisPopulation, right.analysisPopulation, differing, unresolved);
  compareDimension('subgroup', left.subgroup, right.subgroup, differing, unresolved);
  if (
    left.subgroup.status === 'resolved'
    && right.subgroup.status === 'resolved'
    && left.subgroup.value === 'subgroup'
    && right.subgroup.value === 'subgroup'
  ) {
    const leftLabel = left.subgroup.label ? normaliseText(left.subgroup.label) : '';
    const rightLabel = right.subgroup.label ? normaliseText(right.subgroup.label) : '';
    if (!leftLabel || !rightLabel) unresolved.push('subgroupLabel');
    else if (leftLabel !== rightLabel) differing.push('subgroupLabel');
  }
  compareDimension('adjustment', left.adjustment, right.adjustment, differing, unresolved);
  compareDimension('effectTarget', left.effectTarget, right.effectTarget, differing, unresolved);

  if (differing.length > 0) return { relationship: 'different', differingDimensions: differing, unresolvedDimensions: unresolved };
  if (unresolved.length > 0) return { relationship: 'unresolved', differingDimensions: [], unresolvedDimensions: unresolved };
  return { relationship: 'same', differingDimensions: [], unresolvedDimensions: [] };
}

export class EstimandIdentityExtractionAgent implements Agent {
  readonly stage = 'extract' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = result.artifacts.extractedStudies as FamilyAwareStudy[] | undefined;
    const quantitativeLedger = result.artifacts.quantitativeExtractionLedger as QuantitativeExtractionLedgerRow[] | undefined;
    if (!studies || !quantitativeLedger) {
      throw new Error('Estimand identity requires family-aware extracted studies and the quantitative provenance ledger.');
    }
    const ledgerByStudyOutcome = new Map(
      quantitativeLedger
        .filter((entry) => entry.status === 'extracted')
        .map((entry) => [`${entry.studyId}|${normaliseText(entry.outcome)}`, entry]),
    );
    const estimandLedger: EstimandLedgerRow[] = [];

    const enriched = studies.map((study) => {
      const outcomes = study.outcomes.map((rawOutcome) => {
        const outcome = rawOutcome as EstimandAwareOutcome;
        if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number') return outcome;
        const ledger = ledgerByStudyOutcome.get(`${study.studyId}|${normaliseText(outcome.name)}`);
        if (!ledger) {
          estimandLedger.push({
            studyId: study.studyId,
            recordId: study.reportIds[0] ?? study.studyId,
            ...(study.studyFamilyId ? { studyFamilyId: study.studyFamilyId } : {}),
            outcome: outcome.name,
            status: 'blocked-no-quantitative-estimate',
            reason: 'Numeric outcome has no provenance-bound quantitative ledger row; estimand identity cannot be reconstructed.',
          });
          return outcome;
        }
        const estimand = buildEstimand(study, outcome, ledger);
        estimandLedger.push({
          studyId: study.studyId,
          recordId: ledger.recordId,
          ...(study.studyFamilyId ? { studyFamilyId: study.studyFamilyId } : {}),
          outcome: outcome.name,
          status: 'identified',
          estimand,
        });
        return { ...outcome, estimandId: estimand.estimandId, estimand };
      });
      return { ...study, outcomes };
    });

    const identified = estimandLedger.filter((entry) => entry.status === 'identified');
    const fullyResolved = identified.filter((entry) => entry.estimand?.unresolvedDimensions.length === 0).length;
    const warnings = [...(result.warnings ?? [])];
    const partial = identified.length - fullyResolved;
    if (partial > 0) warnings.push(`${partial} numeric estimate(s) have partially unresolved estimand identity; unknown dimensions remain explicit verification debt.`);

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        extractedStudies: enriched,
        estimandLedger,
        estimandIdentityQuality: {
          numericEstimates: identified.length,
          fullyResolved,
          partiallyResolved: partial,
          blockedWithoutQuantitativeLedger: estimandLedger.length - identified.length,
          reportIdentitySeparated: true,
          studyFamilyIdentitySeparated: true,
          unresolvedDimensionsAreNeverImputed: true,
        },
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }
}

function numericEstimandRows(studies: FamilyAwareStudy[]): NumericEstimandRow[] {
  return studies.flatMap((study) => study.outcomes.flatMap((rawOutcome) => {
    const outcome = rawOutcome as EstimandAwareOutcome;
    if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !outcome.estimand) return [];
    return [{
      studyId: study.studyId,
      recordId: study.reportIds[0] ?? study.studyId,
      familyId: study.studyFamilyId ?? `unlinked:${study.studyId}`,
      outcome: outcome.name,
      effectMeasure: outcome.effectMeasure ?? 'untyped',
      analysisScale: outcome.analysisScale ?? 'identity',
      estimand: outcome.estimand,
    }];
  }));
}

export interface EstimandSynthesisConflict {
  kind: 'same-family-distinctness-unproven' | 'cross-study-estimand-mismatch';
  familyId?: string;
  outcome: string;
  reportIds: string[];
  studyIds: string[];
  estimandIds: string[];
  relationship: EstimandRelationship;
  differingDimensions: string[];
  unresolvedDimensions: string[];
}

function pairwise<T>(values: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) pairs.push([values[i]!, values[j]!]);
  }
  return pairs;
}

function synthesisConflicts(rows: NumericEstimandRow[]): {
  familyConflicts: EstimandSynthesisConflict[];
  crossStudyConflicts: EstimandSynthesisConflict[];
  verificationDebt: EstimandSynthesisConflict[];
} {
  const familyConflicts: EstimandSynthesisConflict[] = [];
  const crossStudyConflicts: EstimandSynthesisConflict[] = [];
  const verificationDebt: EstimandSynthesisConflict[] = [];

  const familyGroups = new Map<string, NumericEstimandRow[]>();
  for (const row of rows) {
    const key = [row.familyId, normaliseText(row.outcome), row.effectMeasure, row.analysisScale].join('|');
    const values = familyGroups.get(key) ?? [];
    values.push(row);
    familyGroups.set(key, values);
  }
  for (const group of familyGroups.values()) {
    if (group.length < 2) continue;
    for (const [left, right] of pairwise(group)) {
      const comparison = compareEstimands(left.estimand, right.estimand);
      if (comparison.relationship === 'different') continue;
      familyConflicts.push({
        kind: 'same-family-distinctness-unproven',
        familyId: left.familyId,
        outcome: left.outcome,
        reportIds: [left.recordId, right.recordId].sort(),
        studyIds: [left.studyId, right.studyId].sort(),
        estimandIds: [left.estimand.estimandId, right.estimand.estimandId].sort(),
        relationship: comparison.relationship,
        differingDimensions: comparison.differingDimensions,
        unresolvedDimensions: comparison.unresolvedDimensions,
      });
    }
  }

  const outcomeGroups = new Map<string, NumericEstimandRow[]>();
  for (const row of rows) {
    const key = [normaliseText(row.outcome), row.effectMeasure, row.analysisScale].join('|');
    const values = outcomeGroups.get(key) ?? [];
    values.push(row);
    outcomeGroups.set(key, values);
  }
  for (const group of outcomeGroups.values()) {
    if (group.length < 2) continue;
    for (const [left, right] of pairwise(group)) {
      if (left.familyId === right.familyId) continue;
      const comparison = compareEstimands(left.estimand, right.estimand);
      const conflict: EstimandSynthesisConflict = {
        kind: 'cross-study-estimand-mismatch',
        outcome: left.outcome,
        reportIds: [left.recordId, right.recordId].sort(),
        studyIds: [left.studyId, right.studyId].sort(),
        estimandIds: [left.estimand.estimandId, right.estimand.estimandId].sort(),
        relationship: comparison.relationship,
        differingDimensions: comparison.differingDimensions,
        unresolvedDimensions: comparison.unresolvedDimensions,
      };
      if (comparison.relationship === 'different') crossStudyConflicts.push(conflict);
      else if (comparison.relationship === 'unresolved') verificationDebt.push(conflict);
    }
  }

  return { familyConflicts, crossStudyConflicts, verificationDebt };
}

function withheldSynthesis(
  base: SynthesisResult,
  studies: FamilyAwareStudy[],
  reason: string,
  warnings: string[],
): SynthesisResult {
  return {
    mode: base.mode,
    status: 'narrative',
    includedStudies: studies.length,
    narrative: reason,
    capabilityWarnings: [...(base.capabilityWarnings ?? []), ...warnings],
    ...(base.evidence ? { evidence: base.evidence } : {}),
  };
}

export class EstimandAwareSynthesisAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const studies = context.state.artifacts.extractedStudies as FamilyAwareStudy[] | undefined;
    const synthesis = result.artifacts.synthesis as SynthesisResult | undefined;
    if (!studies || !synthesis) return result;

    const conflicts = synthesisConflicts(numericEstimandRows(studies));
    const warnings = [...(result.warnings ?? [])];
    for (const conflict of conflicts.familyConflicts) {
      warnings.push(
        `Study family ${conflict.familyId} contributes multiple '${conflict.outcome}' estimates whose distinct estimands are not proven (${conflict.relationship}; unresolved: ${conflict.unresolvedDimensions.join(', ') || 'none'}). Pooling is blocked pending estimand adjudication.`,
      );
    }
    for (const conflict of conflicts.crossStudyConflicts) {
      warnings.push(
        `Outcome '${conflict.outcome}' contains demonstrably different estimands across independent studies (${conflict.differingDimensions.join(', ')}); cross-estimand pooling is prohibited.`,
      );
    }
    for (const debt of conflicts.verificationDebt) {
      warnings.push(
        `Outcome '${debt.outcome}' has unresolved cross-study estimand dimensions (${debt.unresolvedDimensions.join(', ')}); retained as explicit VERIFY debt.`,
      );
    }

    const artifacts = {
      ...result.artifacts,
      studyFamilySynthesisConflicts: conflicts.familyConflicts,
      estimandSynthesisConflicts: conflicts.crossStudyConflicts,
      estimandVerificationDebt: conflicts.verificationDebt,
    };

    if (conflicts.familyConflicts.length > 0) {
      return {
        ...result,
        artifacts: {
          ...artifacts,
          synthesis: withheldSynthesis(
            synthesis,
            studies,
            'Quantitative pooling was withheld because at least one participant-study family contributes multiple numerical reports whose estimand distinctness is not proven. Select/adjudicate the estimand-bearing report before pooling.',
            warnings,
          ),
        },
        warnings,
      };
    }
    if (conflicts.crossStudyConflicts.length > 0) {
      return {
        ...result,
        artifacts: {
          ...artifacts,
          synthesis: withheldSynthesis(
            synthesis,
            studies,
            'Quantitative pooling was withheld because the same named outcome contains demonstrably different estimands across independent studies. Separate estimand streams before meta-analysis.',
            warnings,
          ),
        },
        warnings,
      };
    }

    return { ...result, artifacts, ...(warnings.length > 0 ? { warnings } : {}) };
  }
}

export class EstimandReportAgent implements Agent {
  readonly stage = 'report' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const draft = result.artifacts.draftReport as { appendices?: Record<string, unknown> } | undefined;
    if (!draft) return result;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        draftReport: {
          ...draft,
          appendices: {
            ...(draft.appendices ?? {}),
            estimandLedger: context.state.artifacts.estimandLedger ?? [],
            estimandIdentityQuality: context.state.artifacts.estimandIdentityQuality ?? null,
            estimandSynthesisConflicts: context.state.artifacts.estimandSynthesisConflicts ?? [],
            estimandVerificationDebt: context.state.artifacts.estimandVerificationDebt ?? [],
          },
        },
      },
    };
  }
}
