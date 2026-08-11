import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResearcherIdentity, ReviewRequest, SearchStrategy, SearchStrategyTestReport } from '../src/core/types.js';
import { supportedReviewTypes, buildMethodologyPlan } from '../src/protocols/methodology.js';
import { createProtocolDraft, renderProtocolMarkdown } from '../src/protocols/protocol-template-library.js';

const outputDir = join(process.cwd(), 'docs', 'protocol-templates');
await mkdir(outputDir, { recursive: true });

const identity: ResearcherIdentity = {
  displayName: '[Protocol guarantor]',
  authenticated: false,
  authenticationProvider: 'none',
  scopes: [],
};

const indexRows: string[] = [];
for (const reviewType of supportedReviewTypes) {
  const request: ReviewRequest = {
    reviewType,
    databases: ['PubMed', 'MEDLINE (Ovid)', 'Embase (Ovid)', '[Add review-specific databases]'],
    autoApproveHumanGates: false,
    dualScreening: true,
    question: {
      title: `[Insert ${reviewType} review title]`,
      objective: '[State the primary objective in one answerable sentence.]',
      population: '[Define population, setting, context or biological system.]',
      interventionOrExposure: '[Define intervention, exposure, test, prognostic factor, model, phenomenon or concept.]',
      comparator: '[Define comparator or explain why it is not applicable.]',
      outcomes: ['[Primary outcome or finding]', '[Secondary outcome or finding]'],
      concepts: ['[Key mechanism, context, implementation or equity concept]'],
    },
    protocolDevelopment: {
      anticipatedStartDate: '[YYYY-MM-DD]',
      anticipatedCompletionDate: '[YYYY-MM-DD]',
      funder: '[Funder or no external funding]',
      conflictsOfInterest: '[Declare interests]',
      searchPeerReviewRequired: true,
      protocolVersion: '1.0',
      patientPublicInvolvement: '[Describe involvement or justify absence]',
      disseminationPlan: '[Describe publication, policy and open-science outputs]',
      dataManagementPlan: '[Describe storage, provenance, access, retention and sharing]',
    },
    registration: {
      enabled: true,
      targets: ['prospero', 'osf', 'zenodo', 'github'],
      submissionMode: 'prepare-only',
      requireAuthenticatedOrcid: true,
    },
  };
  const draft = createProtocolDraft(request, buildMethodologyPlan(request), identity, '2026-07-13T00:00:00.000Z');
  const strategies: SearchStrategy[] = [{
    database: '[Database]',
    platform: '[Platform]',
    query: '[Paste the complete tested database-specific strategy here]',
    generatedAt: '2026-07-13T00:00:00.000Z',
  }];
  const tests: SearchStrategyTestReport = {
    status: 'warning',
    results: [{
      database: '[Database]',
      platform: '[Platform]',
      syntaxValid: false,
      conceptsCovered: [],
      conceptsMissing: ['[Complete testing before registration]'],
      warnings: ['Template only: execute syntax, known-item, export and result-count tests.'],
      errors: [],
      testedAt: '2026-07-13T00:00:00.000Z',
      testedQuery: strategies[0]!.query,
    }],
    peerReviewRequired: true,
    peerReviewStatus: 'pending',
    completedAt: '2026-07-13T00:00:00.000Z',
  };
  const filename = `${reviewType}.md`;
  await writeFile(join(outputDir, filename), renderProtocolMarkdown(draft, strategies, tests), 'utf8');
  indexRows.push(`- [${reviewType}](./protocol-templates/${filename})`);
}

const index = `# Evidence Review Protocol Template Library\n\nThese templates are generated from the same typed protocol library used by the engine. They must be completed, tested, peer reviewed where required, human approved and prospectively registered before definitive screening or extraction.\n\n${indexRows.join('\n')}\n`;
await writeFile(join(process.cwd(), 'docs', 'PROTOCOL_TEMPLATE_LIBRARY.md'), index, 'utf8');
console.log(`Generated ${supportedReviewTypes.length} protocol templates in ${outputDir}`);
