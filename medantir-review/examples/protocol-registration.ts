import type { ReviewRequest } from '../src/core/types.js';
import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';
import { runMockPipeline } from '../src/engine.js';

const request: ReviewRequest = {
  ...fixtureRequest,
  protocolDevelopment: {
    authors: [{
      givenName: 'Geoffrey',
      familyName: 'Manda',
      affiliation: 'Evidence Review Programme',
      orcid: '0000-0002-1825-0097',
      corresponding: true,
      roles: ['Guarantor', 'Conceptualisation', 'Methodology'],
    }],
    anticipatedStartDate: '2026-08-01',
    anticipatedCompletionDate: '2027-02-28',
    searchPeerReviewRequired: true,
    searchPeerReviewCompleted: true,
    protocolVersion: '1.0.0',
  },
  registration: {
    enabled: true,
    targets: ['prospero', 'osf', 'zenodo', 'github'],
    submissionMode: 'prepare-only' as const,
    requireAuthenticatedOrcid: true,
    github: { owner: 'example', repository: 'evidence-review-protocol' },
  },
};

const state = await runMockPipeline(request, {
  PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
  MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
});

const protocol = state.artifacts.protocolPackage as {
  checksum: string;
  files: Array<{ path: string }>;
};
const receipts = state.artifacts.registrationReceipts as Array<{
  target: string;
  status: string;
  message: string;
}>;

console.log(JSON.stringify({
  runId: state.runId,
  protocolChecksum: protocol.checksum,
  protocolFiles: protocol.files.map((file) => file.path),
  registrationReceipts: receipts,
}, null, 2));
