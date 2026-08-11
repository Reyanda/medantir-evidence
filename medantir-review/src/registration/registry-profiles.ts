import type {
  RegistrationConfig,
  RegistrationPlan,
  RegistrationTarget,
  RegistryEligibilityDecision,
  ResearcherIdentity,
  ReviewRequest,
  ReviewType,
} from '../core/types.js';

const prosperoEligibleTypes = new Set<ReviewType>([
  'systematic',
  'intervention',
  'diagnostic-accuracy',
  'overall-prognosis',
  'prognostic-factor',
  'prediction-model',
  'prevalence-incidence',
  'qualitative',
  'mixed-methods',
  'rapid',
  'umbrella',
  'living',
  'network-meta-analysis',
  'adverse-effects',
  'economic',
  'implementation',
  'environmental',
]);

function targetDecision(
  target: RegistrationTarget,
  request: ReviewRequest,
  identity: ResearcherIdentity,
): RegistryEligibilityDecision {
  if (target === 'prospero') {
    const healthRelevance = Boolean(request.question.population || request.question.outcomes?.length || request.question.interventionOrExposure);
    const typeEligible = prosperoEligibleTypes.has(request.reviewType);
    const identityEligible = request.registration?.requireAuthenticatedOrcid !== true || identity.authenticated;
    return {
      target,
      eligible: healthRelevance && typeEligible && identityEligible,
      role: 'prospective-registry',
      rationale: [
        healthRelevance ? 'The question contains a health-relevant population, exposure/intervention or outcome.' : 'Direct health relevance could not be established.',
        typeEligible ? `The ${request.reviewType} family is routed to prospective systematic-review registration.` : `${request.reviewType} is not routed to PROSPERO by the engine; use OSF as the primary registration route unless current PROSPERO eligibility confirms otherwise.`,
        identityEligible ? 'Identity requirements are satisfied.' : 'An authenticated ORCID identity is required by the configured policy.',
        'Final eligibility remains subject to the current PROSPERO form and CRD rules at submission time.',
      ],
      requiredAuthentication: 'orcid',
      submissionRoute: 'browser',
    };
  }
  if (target === 'osf') {
    return {
      target,
      eligible: true,
      role: 'general-registration',
      rationale: ['OSF can preserve a time-stamped registration across review families and can provide a DOI for public registrations.'],
      requiredAuthentication: 'oauth',
      submissionRoute: 'hybrid',
    };
  }
  if (target === 'zenodo') {
    return {
      target,
      eligible: true,
      role: 'archival-doi',
      rationale: ['Zenodo is used as an archival research-output deposit and DOI layer, not as a substitute for prospective review registration.'],
      requiredAuthentication: 'token',
      submissionRoute: 'api',
    };
  }
  return {
    target,
    eligible: Boolean(request.registration?.github?.owner && request.registration.github.repository),
    role: 'version-control',
    rationale: request.registration?.github?.owner && request.registration.github.repository
      ? ['GitHub will version protocol files, search strategies, code, amendments and release metadata.']
      : ['GitHub owner and repository are required.'],
    requiredAuthentication: 'github-app',
    submissionRoute: 'api',
  };
}

export function buildRegistrationPlan(
  request: ReviewRequest,
  identity: ResearcherIdentity,
  now: string,
): RegistrationPlan {
  const config: RegistrationConfig = request.registration ?? {};
  const enabled = config.enabled === true;
  const defaults: RegistrationTarget[] = ['prospero', 'osf', 'zenodo', 'github'];
  const selectedTargets: RegistrationTarget[] = enabled
    ? [...new Set<RegistrationTarget>(config.targets ?? defaults)]
    : [];
  const eligibility = selectedTargets.map((target) => targetDecision(target, request, identity));
  const warnings = eligibility.filter((decision) => !decision.eligible).map((decision) => `${decision.target}: ${decision.rationale.join(' ')}`);
  if (enabled && selectedTargets.length === 0) warnings.push('Registration was enabled but no target was selected.');
  return {
    enabled,
    submissionMode: config.submissionMode ?? 'prepare-only',
    selectedTargets,
    eligibility,
    requiresHumanApproval: enabled,
    warnings,
    createdAt: now,
  };
}
