import type {
  ProtocolDraft,
  RegistrationTarget,
  ReviewRequest,
  SearchStrategy,
  SearchStrategyTestReport,
} from '../core/types.js';

export interface RegistrySubmissionDocument {
  target: RegistrationTarget;
  purpose: string;
  fields: Record<string, unknown>;
  unresolvedFields: string[];
  requiresHumanConfirmation: string[];
}

function authorFields(draft: ProtocolDraft): Array<Record<string, unknown>> {
  return draft.authors.map((author) => ({
    givenName: author.givenName,
    familyName: author.familyName,
    email: author.email ?? null,
    affiliation: author.affiliation ?? null,
    orcid: author.orcid ?? null,
    roles: author.roles ?? [],
    corresponding: author.corresponding ?? false,
  }));
}

function section(draft: ProtocolDraft, id: string): string {
  return draft.sections.find((item) => item.id === id)?.content ?? '';
}

function searchFields(strategies: SearchStrategy[], tests: SearchStrategyTestReport): Array<Record<string, unknown>> {
  return strategies.map((strategy) => ({
    database: strategy.database,
    platform: strategy.platform,
    query: strategy.query,
    generatedAt: strategy.generatedAt,
    test: tests.results.find((result) => result.database === strategy.database) ?? null,
  }));
}

export function buildRegistrySubmissionDocuments(
  request: ReviewRequest,
  draft: ProtocolDraft,
  strategies: SearchStrategy[],
  tests: SearchStrategyTestReport,
  checksum: string,
): RegistrySubmissionDocument[] {
  const authors = authorFields(draft);
  const searches = searchFields(strategies, tests);
  const common = {
    protocolTitle: draft.title,
    reviewType: draft.reviewType,
    protocolVersion: draft.version,
    protocolChecksum: checksum,
    reviewQuestion: request.question,
    authors,
    anticipatedStartDate: request.protocolDevelopment?.anticipatedStartDate ?? null,
    anticipatedCompletionDate: request.protocolDevelopment?.anticipatedCompletionDate ?? null,
    funding: request.protocolDevelopment?.funder ?? null,
    grantNumber: request.protocolDevelopment?.grantNumber ?? null,
    conflictsOfInterest: request.protocolDevelopment?.conflictsOfInterest ?? null,
    searchPeerReviewStatus: tests.peerReviewStatus,
  };

  const prospero: RegistrySubmissionDocument = {
    target: 'prospero',
    purpose: 'Prospective systematic-review registry field map. Current form eligibility and wording must be confirmed at submission.',
    fields: {
      ...common,
      reviewStatus: 'Protocol finalised; definitive searching must not commence until the registration gate passes.',
      healthConditionOrDomain: request.question.population ?? request.question.title,
      reviewObjective: request.question.objective,
      population: request.question.population ?? null,
      interventionOrExposure: request.question.interventionOrExposure ?? null,
      comparator: request.question.comparator ?? null,
      mainOutcomes: request.question.outcomes ?? [],
      studyDesigns: request.question.studyDesigns ?? [],
      informationSources: request.databases,
      fullSearchStrategies: searches,
      eligibilityCriteria: section(draft, 'eligibility'),
      dataExtraction: section(draft, 'data-collection'),
      riskOfBias: section(draft, 'risk-of-bias'),
      synthesis: section(draft, 'synthesis'),
      dissemination: request.protocolDevelopment?.disseminationPlan ?? null,
    },
    unresolvedFields: [
      'Current PROSPERO subject category and country-specific form fields',
      'Named author approval status in the live registry',
      'Any fields introduced after this software release',
    ],
    requiresHumanConfirmation: [
      'Eligibility under the current PROSPERO scope',
      'Review stage remains prospectively eligible',
      'All named authors approve the submitted record',
    ],
  };

  const osf: RegistrySubmissionDocument = {
    target: 'osf',
    purpose: 'OSF registration/preregistration package for cross-review preservation and contributor approval.',
    fields: {
      ...common,
      registrationSchemaId: request.registration?.osf?.registrationSchemaId ?? null,
      projectId: request.registration?.osf?.projectId ?? null,
      providerId: request.registration?.osf?.providerId ?? null,
      description: request.question.objective,
      registrationResponses: Object.fromEntries(draft.sections.map((item) => [item.heading, item.content])),
      attachedFiles: [
        'protocol/PROTOCOL.md',
        'protocol/protocol.json',
        'protocol/search-strategies.json',
        'protocol/search-test-report.json',
      ],
      publicOnApproval: request.registration?.publicOnApproval ?? true,
      embargoMonths: request.registration?.embargoMonths ?? 0,
    },
    unresolvedFields: [
      'Live registry and registration-schema identifiers',
      'Contributor approval state',
      'Provider-specific metadata fields',
    ],
    requiresHumanConfirmation: [
      'Selected OSF schema matches the protocol purpose',
      'Visibility or embargo choice is appropriate',
      'Contributor list and permissions are correct',
    ],
  };

  const zenodo: RegistrySubmissionDocument = {
    target: 'zenodo',
    purpose: 'Archival research-output deposit and DOI metadata; not a substitute for prospective registration.',
    fields: {
      title: draft.title,
      upload_type: 'publication',
      publication_type: 'report',
      description: `Prospective ${draft.reviewType} protocol package. Checksum: ${checksum}.`,
      creators: authors.map((author) => ({
        name: `${String(author.familyName)}, ${String(author.givenName)}`,
        affiliation: author.affiliation,
        orcid: author.orcid,
      })),
      access_right: request.registration?.publicOnApproval === false ? 'restricted' : 'open',
      license: 'cc-by-4.0',
      keywords: ['evidence synthesis', 'review protocol', draft.reviewType],
      community: request.registration?.zenodo?.community ?? null,
      sandbox: request.registration?.zenodo?.sandbox ?? false,
    },
    unresolvedFields: ['Community curation outcome', 'DOI assigned after publication'],
    requiresHumanConfirmation: ['License and access setting', 'Publication versus draft-deposit action'],
  };

  const github: RegistrySubmissionDocument = {
    target: 'github',
    purpose: 'Version-control and release package for protocol, searches, code, amendments and citation metadata.',
    fields: {
      ...common,
      owner: request.registration?.github?.owner ?? null,
      repository: request.registration?.github?.repository ?? null,
      branch: request.registration?.github?.branch ?? 'main',
      releaseTag: request.registration?.github?.releaseTag ?? `protocol-v${draft.version}`,
      createRelease: request.registration?.github?.createRelease ?? false,
      files: [
        'protocol/PROTOCOL.md',
        'protocol/protocol.json',
        'protocol/search-strategies.json',
        'protocol/search-test-report.json',
        'CITATION.cff',
        '.zenodo.json',
      ],
    },
    unresolvedFields: ['Repository protection rules', 'GitHub App installation and permissions'],
    requiresHumanConfirmation: ['Repository and branch are correct', 'Release should be public', 'No confidential data are included'],
  };

  return [prospero, osf, zenodo, github];
}
