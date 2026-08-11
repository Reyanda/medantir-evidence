import type {
  EvidenceStream,
  QuestionFramework,
  ReviewModule,
  ReviewPlan,
  ReviewRequest,
  ReviewType,
  SynthesisMode,
} from '../core/types.js';

export interface ReviewTypeProfile {
  reviewType: ReviewType;
  questionFramework: QuestionFramework;
  reportingStandards: string[];
  protocolStandards: string[];
  searchStandards: string[];
  appraisalTools: string[];
  certaintyFramework: ReviewPlan['certaintyFramework'];
  synthesisMode: SynthesisMode;
  requiredModules: ReviewModule[];
  evidenceStreams: EvidenceStream[];
  methodologyWarnings: string[];
}

const commonModules: ReviewModule[] = [
  'existing-review-surveillance',
  'primary-study-search',
  'citation-chaining',
  'deduplication',
  'screening',
  'full-text-retrieval',
  'section-aware-extraction',
  'study-family-linkage',
  'human-verification',
];

const quantitativeModules: ReviewModule[] = [
  ...commonModules,
  'risk-of-bias',
  'quantitative-synthesis',
  'certainty-assessment',
  'equity-analysis',
];

const qualitativeModules: ReviewModule[] = [
  ...commonModules,
  'risk-of-bias',
  'qualitative-synthesis',
  'certainty-assessment',
  'equity-analysis',
];

function profile(
  reviewType: ReviewType,
  input: Omit<ReviewTypeProfile, 'reviewType'>,
): ReviewTypeProfile {
  return { reviewType, ...input };
}

export const reviewTypeProfiles: Record<ReviewType, ReviewTypeProfile> = {
  systematic: profile('systematic', {
    questionFramework: 'PECO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['PRISMA-P'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['RoB 2', 'ROBINS-I', 'ROBINS-E where applicable'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure'],
    methodologyWarnings: ['Select a narrower review family whenever diagnostic, prognosis, prediction, prevalence, qualitative, or economic methods are required.'],
  }),
  intervention: profile('intervention', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['PRISMA-P', 'Cochrane intervention review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['RoB 2', 'ROBINS-I'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention'],
    methodologyWarnings: [],
  }),
  'diagnostic-accuracy': profile('diagnostic-accuracy', {
    questionFramework: 'PIRD',
    reportingStandards: ['PRISMA-DTA', 'PRISMA-S'],
    protocolStandards: ['Cochrane diagnostic test accuracy methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['QUADAS-2', 'QUADAS-C for comparative accuracy'],
    certaintyFramework: 'GRADE-DTA',
    synthesisMode: 'diagnostic-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['diagnostic'],
    methodologyWarnings: ['Use paired sensitivity and specificity models; generic univariate pooling is invalid.'],
  }),
  'overall-prognosis': profile('overall-prognosis', {
    questionFramework: 'PICOTS',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['Cochrane prognosis methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['QUIPS adapted for overall prognosis', 'JBI cohort appraisal where justified'],
    certaintyFramework: 'GRADE-prognosis',
    synthesisMode: 'prognostic-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['prognostic'],
    methodologyWarnings: ['Prespecify time origin, prediction horizon, competing events, and absolute-risk scale.'],
  }),
  'prognostic-factor': profile('prognostic-factor', {
    questionFramework: 'PICOTS',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['Cochrane prognosis methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['QUIPS'],
    certaintyFramework: 'GRADE-prognosis',
    synthesisMode: 'prognostic-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['prognostic'],
    methodologyWarnings: ['Do not combine adjusted and unadjusted estimates without a prespecified harmonisation rule.'],
  }),
  'prediction-model': profile('prediction-model', {
    questionFramework: 'PICOTS',
    reportingStandards: ['TRIPOD-SRMA', 'PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['Cochrane prognosis and prediction model methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['PROBAST', 'PROBAST-AI where applicable'],
    certaintyFramework: 'GRADE-prognosis',
    synthesisMode: 'prediction-model-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['prediction-model'],
    methodologyWarnings: ['Separate model development, external validation, updating, calibration, and discrimination.'],
  }),
  'prevalence-incidence': profile('prevalence-incidence', {
    questionFramework: 'CoCoPop',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['JBI prevalence and incidence review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['JBI prevalence critical appraisal checklist'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'prevalence-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['prevalence-incidence'],
    methodologyWarnings: ['Prespecify denominator, sampling frame, case definition, transformation, and time window.'],
  }),
  qualitative: profile('qualitative', {
    questionFramework: 'SPIDER',
    reportingStandards: ['ENTREQ', 'PRISMA-S'],
    protocolStandards: ['Cochrane-Campbell qualitative evidence synthesis methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['CASP qualitative checklist', 'JBI qualitative appraisal'],
    certaintyFramework: 'GRADE-CERQual',
    synthesisMode: 'qualitative',
    requiredModules: qualitativeModules,
    evidenceStreams: ['qualitative'],
    methodologyWarnings: ['Choose thematic synthesis, framework synthesis, or meta-ethnography before extraction begins.'],
  }),
  'mixed-methods': profile('mixed-methods', {
    questionFramework: 'SPICE',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'ENTREQ for qualitative components'],
    protocolStandards: ['JBI mixed methods review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['MMAT', 'design-specific tools for each evidence stream'],
    certaintyFramework: 'GRADE-CERQual',
    synthesisMode: 'mixed-methods',
    requiredModules: [...new Set([...quantitativeModules, ...qualitativeModules])],
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'qualitative', 'implementation'],
    methodologyWarnings: ['Declare whether synthesis is convergent integrated or convergent segregated.'],
  }),
  scoping: profile('scoping', {
    questionFramework: 'PCC',
    reportingStandards: ['PRISMA-ScR', 'PRISMA-S'],
    protocolStandards: ['JBI scoping review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: [],
    certaintyFramework: 'none',
    synthesisMode: 'mapping',
    requiredModules: commonModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure', 'qualitative', 'secondary-review'],
    methodologyWarnings: ['Critical appraisal is optional and must not be implied when it was not performed.'],
  }),
  rapid: profile('rapid', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA-RR', 'PRISMA-S'],
    protocolStandards: ['WHO rapid review guide'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['RoB 2', 'ROBINS-I', 'design-specific appraisal'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'narrative',
    requiredModules: quantitativeModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure'],
    methodologyWarnings: ['Every methodological abbreviation must be declared, justified, and tested for likely bias.'],
  }),
  umbrella: profile('umbrella', {
    questionFramework: 'PCC',
    reportingStandards: ['PRIOR', 'PRISMA-S'],
    protocolStandards: ['JBI umbrella review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['ROBIS', 'AMSTAR 2'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'umbrella',
    requiredModules: [...commonModules, 'risk-of-bias', 'certainty-assessment'],
    evidenceStreams: ['secondary-review'],
    methodologyWarnings: ['Quantify primary-study overlap and avoid double counting review-level estimates.'],
  }),
  living: profile('living', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'living review update statement'],
    protocolStandards: ['Cochrane living systematic review methods'],
    searchStandards: ['PRISMA-S', 'continuous surveillance specification'],
    appraisalTools: ['RoB 2', 'ROBINS-I'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'living',
    requiredModules: [...quantitativeModules, 'living-surveillance'],
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure'],
    methodologyWarnings: ['Define surveillance frequency, trigger thresholds, versioning, and retirement criteria.'],
  }),
  'network-meta-analysis': profile('network-meta-analysis', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA-NMA', 'PRISMA-S'],
    protocolStandards: ['Cochrane network meta-analysis methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['RoB 2', 'ROBINS-I', 'CINeMA domains'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'network-meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention'],
    methodologyWarnings: ['Check network connectivity, transitivity, coherence, and multi-arm correlation.'],
  }),
  'adverse-effects': profile('adverse-effects', {
    questionFramework: 'PECO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S'],
    protocolStandards: ['Cochrane adverse effects methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['RoB 2', 'ROBINS-I', 'ROBINS-E where applicable'],
    certaintyFramework: 'GRADE',
    synthesisMode: 'meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure'],
    methodologyWarnings: ['Include harms-specific terminology, spontaneous reports where eligible, and rare-event methods.'],
  }),
  economic: profile('economic', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'CHEERS 2022 for included evaluations'],
    protocolStandards: ['Cochrane and JBI economic evidence methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['JBI economic evaluation checklist', 'CHEC-list'],
    certaintyFramework: 'none',
    synthesisMode: 'economic',
    requiredModules: [...commonModules, 'risk-of-bias', 'economic-synthesis', 'equity-analysis'],
    evidenceStreams: ['economic'],
    methodologyWarnings: ['Normalise currency, price year, perspective, time horizon, discounting, and model structure before comparison.'],
  }),
  implementation: profile('implementation', {
    questionFramework: 'SPICE',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'ENTREQ where qualitative evidence is synthesised'],
    protocolStandards: ['JBI mixed methods review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['MMAT', 'JBI design-specific tools'],
    certaintyFramework: 'GRADE-CERQual',
    synthesisMode: 'mixed-methods',
    requiredModules: [...new Set([...quantitativeModules, ...qualitativeModules])],
    evidenceStreams: ['implementation', 'qualitative', 'non-randomised-intervention'],
    methodologyWarnings: ['Separate implementation outcomes, determinants, strategies, mechanisms, and context.'],
  }),
  mechanistic: profile('mechanistic', {
    questionFramework: 'mechanism-context-outcome',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'SWiM'],
    protocolStandards: ['mechanistic evidence synthesis protocol'],
    searchStandards: ['PRISMA-S', 'citation chaining specification'],
    appraisalTools: ['mechanistic credibility domains', 'ROBINS-I where applicable'],
    certaintyFramework: 'none',
    synthesisMode: 'mechanistic',
    requiredModules: [...commonModules, 'risk-of-bias', 'qualitative-synthesis'],
    evidenceStreams: ['mechanistic', 'animal', 'exposure'],
    methodologyWarnings: ['Map evidence to explicit causal steps and distinguish mechanism evidence from effect evidence.'],
  }),
  animal: profile('animal', {
    questionFramework: 'PICO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'ARRIVE 2.0'],
    protocolStandards: ['SYRCLE animal review methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['SYRCLE risk of bias'],
    certaintyFramework: 'none',
    synthesisMode: 'meta-analysis',
    requiredModules: [...commonModules, 'risk-of-bias', 'quantitative-synthesis'],
    evidenceStreams: ['animal'],
    methodologyWarnings: ['Model species, strain, sex, unit-of-analysis, clustering, and translational indirectness.'],
  }),
  environmental: profile('environmental', {
    questionFramework: 'PECO',
    reportingStandards: ['PRISMA 2020', 'PRISMA-S', 'ROSES where applicable'],
    protocolStandards: ['OHAT handbook', 'Navigation Guide methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: ['OHAT risk of bias', 'Navigation Guide risk of bias'],
    certaintyFramework: 'OHAT',
    synthesisMode: 'meta-analysis',
    requiredModules: quantitativeModules,
    evidenceStreams: ['environmental', 'exposure', 'animal', 'mechanistic'],
    methodologyWarnings: ['Integrate human, animal, and mechanistic streams without collapsing their distinct bias structures.'],
  }),
  'evidence-map': profile('evidence-map', {
    questionFramework: 'PCC',
    reportingStandards: ['PRISMA-ScR', 'PRISMA-S', 'ROSES where applicable'],
    protocolStandards: ['Campbell evidence and gap map methods'],
    searchStandards: ['PRISMA-S', 'PRESS 2015'],
    appraisalTools: [],
    certaintyFramework: 'none',
    synthesisMode: 'mapping',
    requiredModules: commonModules,
    evidenceStreams: ['randomised', 'non-randomised-intervention', 'exposure', 'qualitative', 'secondary-review'],
    methodologyWarnings: ['Mapping dimensions and coding ontology must be frozen before bulk classification.'],
  }),
};

export const supportedReviewTypes = Object.freeze(Object.keys(reviewTypeProfiles) as ReviewType[]);

export function getReviewTypeProfile(reviewType: ReviewType): ReviewTypeProfile {
  return reviewTypeProfiles[reviewType];
}

function defaultEligibility(request: ReviewRequest, profileValue: ReviewTypeProfile): ReviewPlan['eligibility'] {
  const question = request.question;
  const include = [
    question.population ?? 'Relevant population, setting, or biological system',
    question.interventionOrExposure ?? 'Relevant intervention, exposure, test, prognostic factor, or phenomenon',
    ...(question.outcomes ?? []),
    ...(question.concepts ?? []),
    `Evidence stream: ${profileValue.evidenceStreams.join(', ')}`,
  ];

  if (request.reviewType === 'scoping' || request.reviewType === 'evidence-map') {
    return {
      include: [question.population ?? 'Relevant population or context', ...(question.concepts ?? []), 'Evidence relevant to the stated mapping objective'],
      exclude: ['Clearly unrelated population, context, or concept', 'No usable evidence object'],
    };
  }

  if (request.reviewType === 'qualitative') {
    return {
      include: [question.population ?? 'Relevant sample', ...(question.concepts ?? []), 'Primary qualitative findings with participant interpretation'],
      exclude: ['No primary qualitative findings', 'Editorial or commentary without analysable data'],
    };
  }

  return {
    include,
    exclude: ['Clearly unrelated question domain', 'No eligible evidence stream', 'No extractable result relevant to the prespecified objective'],
  };
}

export function buildMethodologyPlan(request: ReviewRequest): ReviewPlan {
  const selected = getReviewTypeProfile(request.reviewType);
  const inferredFramework = request.reviewType === 'systematic'
    ? request.question.interventionOrExposure && request.question.comparator
      ? 'PICO'
      : 'PECO'
    : selected.questionFramework;

  return {
    reviewType: request.reviewType,
    questionFramework: inferredFramework,
    reportingStandards: [...selected.reportingStandards],
    protocolStandards: [...selected.protocolStandards],
    searchStandards: [...selected.searchStandards],
    appraisalTools: [...selected.appraisalTools],
    certaintyFramework: selected.certaintyFramework,
    synthesisMode: selected.synthesisMode,
    commissionStrategy: request.preferredCommissionStrategy ?? (request.reviewType === 'living' ? 'living-update' : 'de-novo'),
    requiredModules: [...selected.requiredModules],
    evidenceStreams: [...selected.evidenceStreams],
    eligibility: defaultEligibility(request, selected),
    methodologyWarnings: [...selected.methodologyWarnings],
  };
}
