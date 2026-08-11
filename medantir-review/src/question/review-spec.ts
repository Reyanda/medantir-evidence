import type {
  RegistrationTarget,
  ReviewRequest,
  ReviewType,
  StageName,
} from '../core/types.js';
import { stableHash } from '../core/utils.js';
import { getReviewTypeProfile } from '../protocols/methodology.js';

export type ReviewSpecFieldSource =
  | 'user-specified'
  | 'protocol-derived'
  | 'reversible-default'
  | 'human-amended'
  | 'unresolved';

export interface ReviewSpecField<T> {
  value?: T;
  source: ReviewSpecFieldSource;
  rationale: string;
}

export interface ReviewSpecValues {
  population: string;
  interventionOrExposure: string;
  comparator: string;
  outcomes: string[];
  eligibleDesigns: string[];
  databases: string[];
  settings: string[];
  ageRange: string;
  dateLimits: { start?: string; end?: string };
  languages: string[];
  greyLiteraturePolicy: string;
  publicationStatusPolicy: string;
  primaryTimepoints: string[];
  secondaryTimepoints: string[];
  effectMeasures: string[];
  subgroups: string[];
  multiplicityRule: string;
  clusterRule: string;
  multiArmRule: string;
  riskOfBiasTools: string[];
  certaintyFramework: string;
  synthesisStrategy: string;
  registrationTargets: RegistrationTarget[];
  livingReviewPolicy: string;
}

export type ReviewSpecFieldName = keyof ReviewSpecValues;

export type ReviewSpec = {
  version: 1;
  reviewType: ReviewType;
  title: string;
  objective: string;
  fields: { [K in ReviewSpecFieldName]: ReviewSpecField<ReviewSpecValues[K]> };
  compiledAt: string;
  hash: string;
};

export interface ReviewSpecInput extends Partial<ReviewSpecValues> {}

export interface ClarificationImpact {
  stage: StageName;
  reason: string;
}

export interface ClarificationAnswerSchema {
  type: 'string' | 'string-array' | 'database-array';
  minItems?: number;
  allowFreeText: true;
}

export interface ClarificationIssue {
  id: string;
  field: ReviewSpecFieldName;
  material: true;
  materialityScore: number;
  earliestAffectedStage: StageName;
  impacts: ClarificationImpact[];
  question: string;
  whyItMatters: string;
  answerSchema: ClarificationAnswerSchema;
  suggestedOptions?: Array<{ label: string; value: unknown; consequence: string }>;
}

export interface ClarificationResolution {
  issueId: string;
  field: ReviewSpecFieldName;
  value: unknown;
  rationale: string;
  actorId: string;
  decidedAt: string;
}

export interface ProtocolAmendment {
  id: string;
  field: ReviewSpecFieldName;
  oldValue: unknown;
  newValue: unknown;
  rationale: string;
  actorId: string;
  decidedAt: string;
  earliestReplayStage: StageName;
  affectedStages: StageName[];
  beforeSpecHash: string;
  afterSpecHash: string;
}

export interface ReviewSpecCompilation {
  status: 'complete' | 'needs-clarification';
  spec: ReviewSpec;
  issues: ClarificationIssue[];
  safeDefaults: ReviewSpecFieldName[];
  unresolvedMaterialFields: ReviewSpecFieldName[];
}

type ExtendedReviewRequest = ReviewRequest & {
  reviewSpec?: ReviewSpecInput;
};

const INTERVENTION_FAMILIES = new Set<ReviewType>([
  'systematic',
  'intervention',
  'rapid',
  'living',
  'network-meta-analysis',
  'adverse-effects',
]);

const STAGE_ORDER: StageName[] = [
  'question',
  'identity',
  'protocol',
  'review-landscape',
  'protocol-draft',
  'search-build',
  'search-test',
  'protocol-finalise',
  'register-protocol',
  'search-execute',
  'deduplicate',
  'tiab-screen',
  'fulltext-retrieve',
  'pdf-to-text',
  'fulltext-screen',
  'extract',
  'risk-of-bias',
  'synthesise',
  'grade',
  'report',
  'human-verify',
];

const MATERIALITY: Partial<Record<ReviewSpecFieldName, ClarificationImpact[]>> = {
  population: [
    { stage: 'question', reason: 'Defines the target population and question identity.' },
    { stage: 'search-build', reason: 'Changes retrieval concepts and recall.' },
    { stage: 'tiab-screen', reason: 'Changes title/abstract eligibility.' },
    { stage: 'fulltext-screen', reason: 'Changes final study eligibility.' },
    { stage: 'extract', reason: 'Changes which participant data are relevant.' },
  ],
  interventionOrExposure: [
    { stage: 'question', reason: 'Defines the intervention/exposure under review.' },
    { stage: 'search-build', reason: 'Changes intervention concept blocks.' },
    { stage: 'fulltext-screen', reason: 'Changes eligible intervention arms/exposures.' },
    { stage: 'extract', reason: 'Changes arm and exposure extraction.' },
  ],
  comparator: [
    { stage: 'question', reason: 'Changes the scientific contrast.' },
    { stage: 'fulltext-screen', reason: 'Changes eligible comparator groups.' },
    { stage: 'extract', reason: 'Changes which contrast is extracted.' },
    { stage: 'synthesise', reason: 'Changes estimand compatibility and pooling.' },
  ],
  outcomes: [
    { stage: 'question', reason: 'Defines which effects the review is intended to estimate.' },
    { stage: 'fulltext-screen', reason: 'May alter eligibility when outcome reporting is required.' },
    { stage: 'extract', reason: 'Determines outcome extraction.' },
    { stage: 'synthesise', reason: 'Determines analysis streams.' },
    { stage: 'grade', reason: 'Certainty is outcome-specific.' },
  ],
  eligibleDesigns: [
    { stage: 'protocol', reason: 'Study design eligibility is a protocol-level scientific decision.' },
    { stage: 'search-build', reason: 'May change validated design filters or concepts.' },
    { stage: 'tiab-screen', reason: 'Changes screening eligibility.' },
    { stage: 'risk-of-bias', reason: 'Determines the valid appraisal tool.' },
  ],
  databases: [
    { stage: 'search-build', reason: 'Source selection determines which database-specific strategies must exist.' },
    { stage: 'search-execute', reason: 'Changes the evidence universe searched.' },
  ],
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}

function cleanStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value.map(cleanString).filter((item): item is string => Boolean(item)))];
  return values.length ? values : undefined;
}

function field<T>(value: T | undefined, source: ReviewSpecFieldSource, rationale: string): ReviewSpecField<T> {
  return value === undefined ? { source, rationale } : { value, source, rationale };
}

function firstStage(impacts: ClarificationImpact[]): StageName {
  return impacts.reduce((earliest, impact) => {
    return STAGE_ORDER.indexOf(impact.stage) < STAGE_ORDER.indexOf(earliest) ? impact.stage : earliest;
  }, impacts[0]?.stage ?? 'question');
}

function issue(
  reviewType: ReviewType,
  fieldName: ReviewSpecFieldName,
  title: string,
  question: string,
  whyItMatters: string,
  answerSchema: ClarificationAnswerSchema,
  suggestedOptions?: ClarificationIssue['suggestedOptions'],
): ClarificationIssue {
  const impacts = MATERIALITY[fieldName] ?? [{ stage: 'protocol', reason: `The ${fieldName} decision can alter the protocol.` }];
  const earliestAffectedStage = firstStage(impacts);
  return {
    id: `clar-${stableHash({ reviewType, fieldName, title }).slice(0, 20)}`,
    field: fieldName,
    material: true,
    materialityScore: Math.min(1, 0.55 + impacts.length * 0.08),
    earliestAffectedStage,
    impacts,
    question,
    whyItMatters,
    answerSchema,
    ...(suggestedOptions ? { suggestedOptions } : {}),
  };
}

function resolutionFor(
  resolutions: ClarificationResolution[],
  fieldName: ReviewSpecFieldName,
): ClarificationResolution | undefined {
  return [...resolutions]
    .reverse()
    .find((resolution) => resolution.field === fieldName);
}

function overrideOrResolution<T>(
  input: ReviewSpecInput,
  resolutions: ClarificationResolution[],
  fieldName: ReviewSpecFieldName,
  cleaner: (value: unknown) => T | undefined,
): { value?: T; source?: ReviewSpecFieldSource; rationale?: string } {
  const resolution = resolutionFor(resolutions, fieldName);
  if (resolution) {
    const value = cleaner(resolution.value);
    if (value !== undefined) {
      return {
        value,
        source: 'human-amended',
        rationale: `Resolved by ${resolution.actorId}: ${resolution.rationale}`,
      };
    }
  }
  const candidate = cleaner(input[fieldName]);
  if (candidate !== undefined) {
    return { value: candidate, source: 'user-specified', rationale: 'Explicitly supplied in reviewSpec input.' };
  }
  return {};
}

function buildHashableSpec(spec: Omit<ReviewSpec, 'compiledAt' | 'hash'>): unknown {
  return spec;
}

export function validateClarificationResolution(issueToResolve: ClarificationIssue, resolution: ClarificationResolution): void {
  if (resolution.issueId !== issueToResolve.id) throw new Error('Clarification resolution issueId does not match the requested issue');
  if (resolution.field !== issueToResolve.field) throw new Error('Clarification resolution field does not match the requested issue');
  if (!resolution.actorId.trim()) throw new Error('Clarification resolution requires an attributable actorId');
  if (!resolution.rationale.trim()) throw new Error('Clarification resolution requires a rationale');
  if (!Number.isFinite(Date.parse(resolution.decidedAt))) throw new Error('Clarification resolution requires a valid decidedAt timestamp');
  const value = resolution.value;
  if (issueToResolve.answerSchema.type === 'string' && !cleanString(value)) throw new Error('Clarification answer must be a non-empty string');
  if ((issueToResolve.answerSchema.type === 'string-array' || issueToResolve.answerSchema.type === 'database-array') && !cleanStrings(value)) {
    throw new Error('Clarification answer must be a non-empty string array');
  }
}

export function compileReviewSpec(
  request: ReviewRequest,
  options: { resolutions?: ClarificationResolution[]; now?: string } = {},
): ReviewSpecCompilation {
  const extended = request as ExtendedReviewRequest;
  const input = extended.reviewSpec ?? {};
  const resolutions = options.resolutions ?? [];
  const now = options.now ?? new Date().toISOString();
  const profile = getReviewTypeProfile(request.reviewType);
  const q = request.question;
  const interventionFamily = INTERVENTION_FAMILIES.has(request.reviewType);
  const issues: ClarificationIssue[] = [];
  const safeDefaults: ReviewSpecFieldName[] = [];

  const populationResolved = overrideOrResolution(input, resolutions, 'population', cleanString);
  const population = populationResolved.value ?? cleanString(q.population);
  const populationField = population
    ? field(population, populationResolved.source ?? 'user-specified', populationResolved.rationale ?? 'Supplied in the research question.')
    : field<string>(undefined, 'unresolved', 'Population cannot be inferred without changing eligibility.');
  if (!population) {
    issues.push(issue(request.reviewType, 'population', q.title, 'Which population should be eligible for this review?', 'Population changes retrieval, screening, extraction, and applicability.', { type: 'string', allowFreeText: true }));
  }

  const interventionResolved = overrideOrResolution(input, resolutions, 'interventionOrExposure', cleanString);
  const intervention = interventionResolved.value ?? cleanString(q.interventionOrExposure);
  const interventionField = intervention
    ? field(intervention, interventionResolved.source ?? 'user-specified', interventionResolved.rationale ?? 'Supplied in the research question.')
    : field<string>(undefined, 'unresolved', 'Intervention/exposure cannot be invented safely.');
  if (interventionFamily && !intervention) {
    issues.push(issue(request.reviewType, 'interventionOrExposure', q.title, 'Which intervention or exposure should the review evaluate?', 'Changing the intervention changes the search universe, eligible arms, and estimand.', { type: 'string', allowFreeText: true }));
  }

  const comparatorResolved = overrideOrResolution(input, resolutions, 'comparator', cleanString);
  const comparator = comparatorResolved.value ?? cleanString(q.comparator);
  const comparatorField = comparator
    ? field(comparator, comparatorResolved.source ?? 'user-specified', comparatorResolved.rationale ?? 'Supplied in the research question.')
    : interventionFamily
      ? field<string>(undefined, 'unresolved', 'Comparator choice is scientifically material for intervention-effect reviews.')
      : field('Not structurally required for this review family', 'protocol-derived', `Comparator is not mandatory for ${request.reviewType}.`);
  if (interventionFamily && !comparator) {
    issues.push(issue(
      request.reviewType,
      'comparator',
      q.title,
      'Which comparator groups should be eligible?',
      'Comparator choice changes study eligibility and the causal contrast that will be synthesized.',
      { type: 'string', allowFreeText: true },
      [
        { label: 'Any eligible comparator', value: 'Any eligible comparator, including placebo, no intervention, usual care, or active comparator', consequence: 'Broadest comparator eligibility; contrasts remain separate unless estimands are compatible.' },
        { label: 'Placebo/usual care/no intervention', value: 'Placebo, usual care, or no intervention only', consequence: 'Excludes active-comparator-only studies.' },
        { label: 'Active comparator only', value: 'Active comparator only', consequence: 'Excludes placebo/no-intervention contrasts.' },
      ],
    ));
  }

  const outcomesResolved = overrideOrResolution(input, resolutions, 'outcomes', cleanStrings);
  const outcomes = outcomesResolved.value ?? cleanStrings(q.outcomes);
  const outcomesField = outcomes
    ? field(outcomes, outcomesResolved.source ?? 'user-specified', outcomesResolved.rationale ?? 'Supplied in the research question.')
    : field<string[]>(undefined, 'unresolved', 'Outcomes cannot be fabricated from the intervention or title.');
  if (interventionFamily && !outcomes) {
    issues.push(issue(request.reviewType, 'outcomes', q.title, 'Which outcomes should the review evaluate?', 'Outcomes define extraction streams, synthesis, certainty assessment, and conclusions.', { type: 'string-array', minItems: 1, allowFreeText: true }));
  }

  const designResolved = overrideOrResolution(input, resolutions, 'eligibleDesigns', cleanStrings);
  const designs = designResolved.value ?? cleanStrings(q.studyDesigns);
  const designField = designs
    ? field(designs, designResolved.source ?? 'user-specified', designResolved.rationale ?? 'Supplied in the research question.')
    : interventionFamily
      ? field<string[]>(undefined, 'unresolved', 'Study-design eligibility affects both causal interpretation and appraisal method.')
      : field(profile.evidenceStreams, 'protocol-derived', `Derived from the ${request.reviewType} methodology profile.`);
  if (interventionFamily && !designs) {
    issues.push(issue(
      request.reviewType,
      'eligibleDesigns',
      q.title,
      'Which study designs should be eligible?',
      'Including randomized and non-randomized studies changes screening, bias assessment, and synthesis strategy.',
      { type: 'string-array', minItems: 1, allowFreeText: true },
      [
        { label: 'Randomized trials only', value: ['randomised controlled trial'], consequence: 'Highest internal-validity intervention evidence; excludes non-randomized intervention studies.' },
        { label: 'Randomized and non-randomized intervention studies', value: ['randomised controlled trial', 'non-randomised intervention study'], consequence: 'Broader evidence base requiring design-specific bias assessment and careful synthesis separation.' },
      ],
    ));
  }

  const dbResolved = overrideOrResolution(input, resolutions, 'databases', cleanStrings);
  const databases = dbResolved.value ?? cleanStrings(request.databases);
  const databaseField = databases
    ? field(databases, dbResolved.source ?? 'user-specified', dbResolved.rationale ?? 'Supplied in ReviewRequest.databases.')
    : field<string[]>(undefined, 'unresolved', 'A systematic review cannot define its evidence universe without at least one source.');
  if (!databases) {
    issues.push(issue(request.reviewType, 'databases', q.title, 'Which bibliographic databases and registries should be searched?', 'Database selection changes source coverage and reproducibility.', { type: 'database-array', minItems: 1, allowFreeText: true }));
  }

  const settingsResolved = overrideOrResolution(input, resolutions, 'settings', cleanStrings);
  const settingsField = settingsResolved.value
    ? field(settingsResolved.value, settingsResolved.source!, settingsResolved.rationale!)
    : field(['All settings meeting the population and intervention criteria'], 'reversible-default', 'No setting restriction broadens rather than narrows eligibility and can be changed before screening.');
  if (!settingsResolved.value) safeDefaults.push('settings');

  const ageResolved = overrideOrResolution(input, resolutions, 'ageRange', cleanString);
  const ageField = ageResolved.value
    ? field(ageResolved.value, ageResolved.source!, ageResolved.rationale!)
    : field('As defined by the population criterion; no additional age exclusion', 'reversible-default', 'Avoids silently excluding age groups beyond the stated population.');
  if (!ageResolved.value) safeDefaults.push('ageRange');

  const dateInput = input.dateLimits;
  const dateResolution = resolutionFor(resolutions, 'dateLimits');
  const dateValue = dateResolution && typeof dateResolution.value === 'object' && dateResolution.value !== null
    ? dateResolution.value as ReviewSpecValues['dateLimits']
    : dateInput;
  const dateField = dateValue && (dateValue.start || dateValue.end)
    ? field({ ...(dateValue.start ? { start: dateValue.start } : {}), ...(dateValue.end ? { end: dateValue.end } : {}) }, dateResolution ? 'human-amended' : 'user-specified', dateResolution?.rationale ?? 'Explicit date limits supplied.')
    : field({}, 'reversible-default', 'No date restriction maximizes recall and does not silently exclude older or newer evidence.');
  if (!dateValue?.start && !dateValue?.end) safeDefaults.push('dateLimits');

  const languageResolved = overrideOrResolution(input, resolutions, 'languages', cleanStrings);
  const languageField = languageResolved.value
    ? field(languageResolved.value, languageResolved.source!, languageResolved.rationale!)
    : field(['all languages'], 'reversible-default', 'No language restriction avoids language-based evidence exclusion.');
  if (!languageResolved.value) safeDefaults.push('languages');

  const greyResolved = overrideOrResolution(input, resolutions, 'greyLiteraturePolicy', cleanString);
  const greyField = greyResolved.value
    ? field(greyResolved.value, greyResolved.source!, greyResolved.rationale!)
    : field('Include eligible grey and unpublished evidence when lawfully discoverable and retrievable', 'reversible-default', 'Broad inclusion reduces publication-status bias; access failures remain explicit.');
  if (!greyResolved.value) safeDefaults.push('greyLiteraturePolicy');

  const publicationResolved = overrideOrResolution(input, resolutions, 'publicationStatusPolicy', cleanString);
  const publicationField = publicationResolved.value
    ? field(publicationResolved.value, publicationResolved.source!, publicationResolved.rationale!)
    : field('No exclusion solely by publication status', 'reversible-default', 'Avoids silently excluding preprints, registries, theses, or unpublished eligible evidence.');
  if (!publicationResolved.value) safeDefaults.push('publicationStatusPolicy');

  const primaryTimeResolved = overrideOrResolution(input, resolutions, 'primaryTimepoints', cleanStrings);
  const primaryTimeField = primaryTimeResolved.value
    ? field(primaryTimeResolved.value, primaryTimeResolved.source!, primaryTimeResolved.rationale!)
    : field(['All eligible timepoints retained as distinct estimands until a hierarchy is protocol-locked'], 'reversible-default', 'Prevents cross-timepoint pooling while preserving recall.');
  if (!primaryTimeResolved.value) safeDefaults.push('primaryTimepoints');

  const secondaryTimeResolved = overrideOrResolution(input, resolutions, 'secondaryTimepoints', cleanStrings);
  const secondaryTimeField = secondaryTimeResolved.value
    ? field(secondaryTimeResolved.value, secondaryTimeResolved.source!, secondaryTimeResolved.rationale!)
    : field([], 'reversible-default', 'No additional secondary-timepoint restriction is imposed.');
  if (!secondaryTimeResolved.value) safeDefaults.push('secondaryTimepoints');

  const effectResolved = overrideOrResolution(input, resolutions, 'effectMeasures', cleanStrings);
  const effectField = effectResolved.value
    ? field(effectResolved.value, effectResolved.source!, effectResolved.rationale!)
    : field(['Outcome- and design-appropriate canonical effect measure; preserve reported scale and record every conversion'], 'protocol-derived', 'Effect measure can be derived deterministically from outcome type and prespecified analysis rules without narrowing eligibility.');

  const subgroupResolved = overrideOrResolution(input, resolutions, 'subgroups', cleanStrings);
  const subgroupField = subgroupResolved.value
    ? field(subgroupResolved.value, subgroupResolved.source!, subgroupResolved.rationale!)
    : field([], 'reversible-default', 'No subgroup is silently promoted to a mandatory eligibility restriction.');
  if (!subgroupResolved.value) safeDefaults.push('subgroups');

  const multiplicityResolved = overrideOrResolution(input, resolutions, 'multiplicityRule', cleanString);
  const multiplicityField = multiplicityResolved.value
    ? field(multiplicityResolved.value, multiplicityResolved.source!, multiplicityResolved.rationale!)
    : field('Keep distinct outcomes, scales, analyses, and timepoints separate until an explicit hierarchy selects one estimand per prespecified contrast', 'protocol-derived', 'Prevents data-driven selection and double counting.');

  const clusterResolved = overrideOrResolution(input, resolutions, 'clusterRule', cleanString);
  const clusterField = clusterResolved.value
    ? field(clusterResolved.value, clusterResolved.source!, clusterResolved.rationale!)
    : field('Use cluster-adjusted estimates; otherwise derive an adjustment only from reported or explicitly sourced ICC information', 'protocol-derived', 'Avoids treating clustered observations as independent.');

  const multiArmResolved = overrideOrResolution(input, resolutions, 'multiArmRule', cleanString);
  const multiArmField = multiArmResolved.value
    ? field(multiArmResolved.value, multiArmResolved.source!, multiArmResolved.rationale!)
    : field('Preserve shared-arm dependence; combine or split shared comparator information only with a deterministic dependence-aware rule', 'protocol-derived', 'Prevents double counting participants in multi-arm studies.');

  const robResolved = overrideOrResolution(input, resolutions, 'riskOfBiasTools', cleanStrings);
  const robField = robResolved.value
    ? field(robResolved.value, robResolved.source!, robResolved.rationale!)
    : field(profile.appraisalTools, 'protocol-derived', `Derived from the ${request.reviewType} methodology profile.`);

  const certaintyResolved = overrideOrResolution(input, resolutions, 'certaintyFramework', cleanString);
  const certaintyField = certaintyResolved.value
    ? field(certaintyResolved.value, certaintyResolved.source!, certaintyResolved.rationale!)
    : field(profile.certaintyFramework, 'protocol-derived', `Derived from the ${request.reviewType} methodology profile.`);

  const synthesisResolved = overrideOrResolution(input, resolutions, 'synthesisStrategy', cleanString);
  const synthesisField = synthesisResolved.value
    ? field(synthesisResolved.value, synthesisResolved.source!, synthesisResolved.rationale!)
    : field(profile.synthesisMode, 'protocol-derived', `Derived from the ${request.reviewType} methodology profile; quantitative pooling remains conditional on compatibility gates.`);

  const registrationInput = input.registrationTargets ?? request.registration?.targets;
  const registrationResolution = resolutionFor(resolutions, 'registrationTargets');
  const registrationValue = registrationResolution ? registrationResolution.value : registrationInput;
  const registrationTargets = Array.isArray(registrationValue)
    ? [...new Set(registrationValue.filter((value): value is RegistrationTarget => ['prospero', 'osf', 'zenodo', 'github'].includes(String(value))))]
    : [];
  const registrationField = field(registrationTargets, registrationResolution ? 'human-amended' : registrationInput ? 'user-specified' : 'reversible-default', registrationResolution?.rationale ?? (registrationInput ? 'Explicit registration targets supplied.' : 'No registration target is silently selected; registration stage may request authentication/target choice.'));
  if (!registrationInput && !registrationResolution) safeDefaults.push('registrationTargets');

  const livingResolved = overrideOrResolution(input, resolutions, 'livingReviewPolicy', cleanString);
  const livingField = livingResolved.value
    ? field(livingResolved.value, livingResolved.source!, livingResolved.rationale!)
    : request.reviewType === 'living'
      ? field<string>(undefined, 'unresolved', 'Living review surveillance frequency and trigger thresholds require an explicit policy.')
      : field('Not a living review', 'protocol-derived', `Review type is ${request.reviewType}.`);

  const fields: ReviewSpec['fields'] = {
    population: populationField,
    interventionOrExposure: interventionField,
    comparator: comparatorField,
    outcomes: outcomesField,
    eligibleDesigns: designField,
    databases: databaseField,
    settings: settingsField,
    ageRange: ageField,
    dateLimits: dateField,
    languages: languageField,
    greyLiteraturePolicy: greyField,
    publicationStatusPolicy: publicationField,
    primaryTimepoints: primaryTimeField,
    secondaryTimepoints: secondaryTimeField,
    effectMeasures: effectField,
    subgroups: subgroupField,
    multiplicityRule: multiplicityField,
    clusterRule: clusterField,
    multiArmRule: multiArmField,
    riskOfBiasTools: robField,
    certaintyFramework: certaintyField,
    synthesisStrategy: synthesisField,
    registrationTargets: registrationField,
    livingReviewPolicy: livingField,
  };

  if (request.reviewType === 'living' && !livingResolved.value) {
    const impacts: ClarificationImpact[] = [
      { stage: 'protocol', reason: 'Defines surveillance frequency, update triggers, retirement, and versioning.' },
      { stage: 'search-execute', reason: 'Determines recurring search cadence.' },
    ];
    issues.push({
      id: `clar-${stableHash({ reviewType: request.reviewType, fieldName: 'livingReviewPolicy', title: q.title }).slice(0, 20)}`,
      field: 'livingReviewPolicy',
      material: true,
      materialityScore: 0.9,
      earliestAffectedStage: firstStage(impacts),
      impacts,
      question: 'What surveillance cadence and conclusion-change trigger should govern this living review?',
      whyItMatters: 'A living review cannot operate safely without explicit update and retirement rules.',
      answerSchema: { type: 'string', allowFreeText: true },
    });
  }

  const hashless: Omit<ReviewSpec, 'compiledAt' | 'hash'> = {
    version: 1,
    reviewType: request.reviewType,
    title: q.title.trim(),
    objective: q.objective.trim(),
    fields,
  };
  const spec: ReviewSpec = {
    ...hashless,
    compiledAt: now,
    hash: stableHash(buildHashableSpec(hashless)),
  };
  const unresolvedMaterialFields = issues.map((candidate) => candidate.field);
  return {
    status: issues.length ? 'needs-clarification' : 'complete',
    spec,
    issues,
    safeDefaults: [...new Set(safeDefaults)],
    unresolvedMaterialFields: [...new Set(unresolvedMaterialFields)],
  };
}

export function createProtocolAmendments(
  before: ReviewSpec,
  after: ReviewSpec,
  resolutions: ClarificationResolution[],
): ProtocolAmendment[] {
  const amendments: ProtocolAmendment[] = [];
  for (const resolution of resolutions) {
    const fieldName = resolution.field;
    const oldValue = before.fields[fieldName].value;
    const newValue = after.fields[fieldName].value;
    if (stableHash(oldValue) === stableHash(newValue)) continue;
    const impacts = MATERIALITY[fieldName] ?? [{ stage: 'protocol', reason: `The ${fieldName} decision alters the protocol.` }];
    amendments.push({
      id: `amend-${stableHash({ issueId: resolution.issueId, fieldName, before: before.hash, after: after.hash }).slice(0, 20)}`,
      field: fieldName,
      oldValue,
      newValue,
      rationale: resolution.rationale,
      actorId: resolution.actorId,
      decidedAt: resolution.decidedAt,
      earliestReplayStage: firstStage(impacts),
      affectedStages: impacts.map((impact) => impact.stage),
      beforeSpecHash: before.hash,
      afterSpecHash: after.hash,
    });
  }
  return amendments;
}

export function earliestReplayStage(amendments: ProtocolAmendment[]): StageName | undefined {
  if (!amendments.length) return undefined;
  return amendments
    .map((amendment) => amendment.earliestReplayStage)
    .reduce((earliest, stage) => STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(earliest) ? stage : earliest);
}
