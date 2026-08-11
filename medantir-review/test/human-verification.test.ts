import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ExtractedStudy,
  HumanVerificationPackage,
  HumanVerificationSubmission,
} from '../src/core/types.js';
import { SubmittedHumanVerificationPort } from '../src/adapters/mock.js';
import { resumeMockPipeline, runMockPipeline } from '../src/engine.js';
import { fixtureRecords, fixtureRequest } from '../src/fixtures.js';

const recordsByDatabase = {
  PubMed: fixtureRecords.filter((record) => record.sourceDatabases.includes('PubMed')),
  MEDLINE: fixtureRecords.filter((record) => record.sourceDatabases.includes('MEDLINE')),
};

function acceptAll(input: HumanVerificationPackage): HumanVerificationSubmission {
  return {
    packageId: input.id,
    mode: input.mode,
    decisions: input.items.map((item) => ({
      itemId: item.id,
      verdict: 'accept' as const,
      rationale: `Verified against the cited evidence for ${item.label}.`,
      reviewerId: 'reviewer-1',
    })),
  };
}

test('extraction captures evidence from rationale, objectives, results, discussion, and limitations', async () => {
  const state = await runMockPipeline(fixtureRequest, recordsByDatabase);
  const studies = state.artifacts.extractedStudies as ExtractedStudy[];
  assert.ok(studies.length > 0);
  for (const study of studies) {
    assert.ok(study.sectionEvidence.rationale.length > 0);
    assert.ok(study.sectionEvidence.objectives.length > 0);
    assert.ok(study.sectionEvidence.results.length > 0);
    assert.ok(study.sectionEvidence.discussion.length > 0);
    assert.ok(study.sectionEvidence.limitations.length > 0);
    assert.notEqual(study.rationale, 'Not explicitly reported');
    assert.notEqual(study.resultsSummary, 'Not explicitly reported');
  }
});

test('blinded verification hides identity and model metadata but retains proof', async () => {
  const request = {
    ...fixtureRequest,
    humanVerification: { enabled: true, mode: 'blinded' as const },
  };
  const state = await runMockPipeline(request, recordsByDatabase, { humanVerificationPort: null });
  assert.equal(state.stages['human-verify'].status, 'awaiting-human');
  assert.equal(state.artifacts.finalReport, undefined);
  const verificationPackage = state.artifacts.verificationPackage as HumanVerificationPackage;
  assert.equal(verificationPackage.mode, 'blinded');
  assert.ok(verificationPackage.items.length > 0);
  assert.ok(verificationPackage.items.every((item) => item.context === undefined));
  assert.ok(verificationPackage.items.every((item) => item.machine === undefined));
  assert.ok(verificationPackage.items.every((item) => item.evidence.length > 0));
  const extractionCore = verificationPackage.items.find((item) => item.id.endsWith(':core'));
  assert.ok(extractionCore);
  assert.deepEqual(extractionCore.evidenceCoverage, {
    rationale: true,
    objectives: true,
    results: true,
    discussion: true,
    limitations: true,
  });
});

test('unblinded verification exposes provenance and model metadata', async () => {
  const request = {
    ...fixtureRequest,
    humanVerification: { enabled: true, mode: 'unblinded' as const },
  };
  const state = await runMockPipeline(request, recordsByDatabase, { humanVerificationPort: null });
  const verificationPackage = state.artifacts.verificationPackage as HumanVerificationPackage;
  const tiabItem = verificationPackage.items.find((item) => item.category === 'tiab-screening');
  assert.ok(tiabItem?.context?.title);
  assert.ok(tiabItem?.context?.authors?.length);
  assert.equal(tiabItem?.machine?.agent, 'TiabScreeningAgent');
  assert.equal(typeof tiabItem?.machine?.confidence, 'number');
});

test('accepting every evidence-bound decision finalises the report', async () => {
  const initial = await runMockPipeline(fixtureRequest, recordsByDatabase, { humanVerificationPort: null });
  const verificationPackage = initial.artifacts.verificationPackage as HumanVerificationPackage;
  const completed = await resumeMockPipeline(
    initial,
    recordsByDatabase,
    new SubmittedHumanVerificationPort(acceptAll(verificationPackage)),
  );
  assert.equal(completed.stages['human-verify'].status, 'passed');
  assert.ok(completed.artifacts.finalReport);
  const outcome = completed.artifacts.verificationOutcome as { status: string; accepted: number };
  assert.equal(outcome.status, 'accepted');
  assert.equal(outcome.accepted, verificationPackage.items.length);
});

test('a human amendment rolls the pipeline back, applies the override, and requires re-verification', async () => {
  const initial = await runMockPipeline(fixtureRequest, recordsByDatabase, { humanVerificationPort: null });
  const verificationPackage = initial.artifacts.verificationPackage as HumanVerificationPackage;
  const target = verificationPackage.items.find((item) => item.id.includes('extract:study-pubmed-1:rationale'));
  assert.ok(target);
  const submission = acceptAll(verificationPackage);
  submission.decisions = submission.decisions.map((decision) =>
    decision.itemId === target.id
      ? {
          ...decision,
          verdict: 'amend' as const,
          rationale: 'The rationale needs a more precise human transcription.',
          amendedValue: 'Human-corrected rationale grounded in the introduction.',
        }
      : decision,
  );

  const reworked = await resumeMockPipeline(
    initial,
    recordsByDatabase,
    new SubmittedHumanVerificationPort(submission),
  );
  assert.equal(reworked.stages['human-verify'].status, 'awaiting-human');
  assert.equal(reworked.artifacts.finalReport, undefined);
  const studies = reworked.artifacts.extractedStudies as ExtractedStudy[];
  const amendedStudy = studies.find((study) => study.studyId === 'study-pubmed-1');
  assert.equal(amendedStudy?.rationale, 'Human-corrected rationale grounded in the introduction.');
  assert.ok(reworked.audit.some((event) => event.event === 'human-rework-requested'));
});

test('a rejected decision cannot silently close the review', async () => {
  const initial = await runMockPipeline(fixtureRequest, recordsByDatabase, { humanVerificationPort: null });
  const verificationPackage = initial.artifacts.verificationPackage as HumanVerificationPackage;
  const submission = acceptAll(verificationPackage);
  const first = submission.decisions[0];
  assert.ok(first);
  submission.decisions[0] = {
    ...first,
    verdict: 'reject',
    rationale: 'The cited evidence does not support this decision.',
  };
  const rejected = await resumeMockPipeline(
    initial,
    recordsByDatabase,
    new SubmittedHumanVerificationPort(submission),
  );
  assert.equal(rejected.stages['human-verify'].status, 'awaiting-human');
  assert.equal(rejected.artifacts.finalReport, undefined);
  const outcome = rejected.artifacts.verificationOutcome as { status: string; rejected: number };
  assert.equal(outcome.status, 'changes-requested');
  assert.equal(outcome.rejected, 1);
});
