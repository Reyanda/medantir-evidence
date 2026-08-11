import type { HumanVerificationPackage } from '../src/core/types.js';
import { SubmittedHumanVerificationPort } from '../src/adapters/mock.js';
import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';
import { resumeMockPipeline, runMockPipeline } from '../src/engine.js';

const recordsByDatabase = {
  PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
  MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
};

const pending = await runMockPipeline(
  {
    ...fixtureRequest,
    humanVerification: { enabled: true, mode: 'blinded' },
  },
  recordsByDatabase,
  { humanVerificationPort: null },
);

const verificationPackage = pending.artifacts.verificationPackage as HumanVerificationPackage;
console.log(`Verification package ${verificationPackage.id} contains ${verificationPackage.items.length} decisions.`);

const submission = {
  packageId: verificationPackage.id,
  mode: verificationPackage.mode,
  decisions: verificationPackage.items.map((item) => ({
    itemId: item.id,
    verdict: 'accept' as const,
    rationale: `The cited evidence supports ${item.label}.`,
    reviewerId: 'example-reviewer',
  })),
};

const completed = await resumeMockPipeline(
  pending,
  recordsByDatabase,
  new SubmittedHumanVerificationPort(submission),
);

console.log(JSON.stringify({
  runId: completed.runId,
  verificationStatus: completed.stages['human-verify'].status,
  outcome: completed.artifacts.verificationOutcome,
  reportTitle: (completed.artifacts.finalReport as { title: string }).title,
}, null, 2));
