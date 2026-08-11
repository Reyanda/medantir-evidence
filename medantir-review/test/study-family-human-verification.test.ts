import test from 'node:test';
import assert from 'node:assert/strict';
import type { HumanVerificationPort } from '../src/core/ports.js';
import type {
  Agent,
  AgentContext,
  AgentResult,
  HumanVerificationOutcome,
  HumanVerificationPackage,
  HumanVerificationSubmission,
} from '../src/core/types.js';
import {
  StudyFamilyHumanVerificationAgent,
  type StudyFamilyVerificationAcknowledgement,
} from '../src/agents/study-family-human-verification.js';
import { studyFamilyVerificationItemId, type EvidenceBoundStudyFamilyLink } from '../src/agents/study-family-evidence.js';

const record = {
  id: 'report-1',
  title: 'Secondary analysis of a parent trial',
  abstract: 'A secondary analysis requiring parent-trial linkage.',
  authors: ['Example Author'],
  year: 2021,
  sourceDatabases: ['pubmed'],
};

function unresolvedLink(overrides: Partial<EvidenceBoundStudyFamilyLink> = {}): EvidenceBoundStudyFamilyLink {
  return {
    recordId: 'report-1',
    familyId: 'family-report-abc',
    role: 'secondary-analysis',
    registryIds: [],
    linkageBasis: 'singleton-no-registry',
    confidence: 0.5,
    eligibilityDecision: 'uncertain',
    requiresHumanReview: true,
    reasons: ['No unique registry identifier was found in high-specificity evidence.'],
    evidence: [{
      id: 'family-evidence-methods',
      recordId: 'report-1',
      section: 'methods',
      page: 4,
      quote: 'This secondary analysis used participants from the parent randomized trial.',
      source: 'full-text',
      heading: 'Methods',
    }],
    ...overrides,
  };
}

function context(
  links: EvidenceBoundStudyFamilyLink[] = [unresolvedLink()],
  extra: Record<string, unknown> = {},
): AgentContext {
  return {
    state: {
      runId: 'family-human-run',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Family verification', objective: 'Verify parent-study identity.' },
        humanVerification: { enabled: true, mode: 'unblinded', requireAllItems: true },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: {
        uniqueRecords: [record],
        studyFamilyLinks: links,
        ...extra,
      },
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T02:00:00.000Z',
  };
}

function finalReportBase(counter: { calls: number }): Agent {
  return {
    stage: 'human-verify',
    async execute(): Promise<AgentResult> {
      counter.calls += 1;
      return {
        artifacts: {
          finalReport: {
            title: 'Report',
            abstract: 'Abstract',
            prisma: { identified: 1, afterDeduplication: 1, tiabIncluded: 1, fullTextIncluded: 1 },
            sections: { conclusion: 'Conclusion' },
            appendices: {},
          },
        },
      };
    },
  };
}

class CapturingPort implements HumanVerificationPort {
  package?: HumanVerificationPackage;
  constructor(private readonly decide: (input: HumanVerificationPackage) => HumanVerificationSubmission | null) {}
  async review(input: HumanVerificationPackage): Promise<HumanVerificationSubmission | null> {
    this.package = input;
    return this.decide(input);
  }
}

test('unresolved family identity is exposed as an evidence-bound human-verification proposition', async () => {
  const counter = { calls: 0 };
  const result = await new StudyFamilyHumanVerificationAgent(finalReportBase(counter)).execute(context());
  const pkg = result.artifacts.studyFamilyVerificationPackage as HumanVerificationPackage;

  assert.equal(counter.calls, 0);
  assert.ok(result.awaitingHuman);
  assert.equal(pkg.items.length, 1);
  assert.equal(pkg.items[0]?.id, studyFamilyVerificationItemId('report-1'));
  assert.equal(pkg.items[0]?.sourceStage, 'fulltext-screen');
  assert.equal(pkg.items[0]?.label, 'Study-family identity');
  assert.ok(pkg.items[0]?.evidence.some((entry) => entry.id === 'family-evidence-methods'));
  assert.equal(pkg.items[0]?.context?.recordId, 'report-1');
});

test('blinded family verification hides identity and machine metadata but retains source proof', async () => {
  const ctx = context();
  ctx.state.request.humanVerification = { enabled: true, mode: 'blinded', requireAllItems: true };
  const result = await new StudyFamilyHumanVerificationAgent(finalReportBase({ calls: 0 })).execute(ctx);
  const pkg = result.artifacts.studyFamilyVerificationPackage as HumanVerificationPackage;
  const item = pkg.items[0]!;

  assert.equal(pkg.mode, 'blinded');
  assert.equal(item.context, undefined);
  assert.equal(item.machine, undefined);
  assert.ok(item.evidence.some((entry) => /parent randomized trial/i.test(entry.quote)));
});

test('family amendment enters the shared override ledger and rolls back from full-text screening', async () => {
  const counter = { calls: 0 };
  const port = new CapturingPort((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'amend',
      rationale: 'Matched against the ACTT-2 parent registry record.',
      reviewerId: 'reviewer-1',
      decidedAt: '2026-08-10T02:01:00.000Z',
      amendedValue: {
        familyId: 'family-registry-nct04401579',
        role: 'secondary-analysis',
        registryIds: ['NCT04401579'],
      },
    }],
  }));

  const result = await new StudyFamilyHumanVerificationAgent(finalReportBase(counter), port).execute(context());
  const ledger = result.artifacts.humanOverrides as { version: number; entries: Array<{ itemId: string; sourceStage: string; amendedValue: any }> };

  assert.equal(counter.calls, 0);
  assert.equal(result.rework?.fromStage, 'fulltext-screen');
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0]?.itemId, studyFamilyVerificationItemId('report-1'));
  assert.equal(ledger.entries[0]?.sourceStage, 'fulltext-screen');
  assert.equal(ledger.entries[0]?.amendedValue.familyId, 'family-registry-nct04401579');
  assert.deepEqual(ledger.entries[0]?.amendedValue.registryIds, ['NCT04401579']);
});

test('accepted unresolved family proposal is acknowledged and skipped only while the proposal hash is unchanged', async () => {
  const counter = { calls: 0 };
  const port = new CapturingPort((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'accept',
      rationale: 'No parent study can be established from the available evidence; retain as singleton.',
      reviewerId: 'reviewer-2',
      decidedAt: '2026-08-10T02:02:00.000Z',
    }],
  }));
  const first = await new StudyFamilyHumanVerificationAgent(finalReportBase(counter), port).execute(context());
  const acknowledgements = first.artifacts.studyFamilyVerificationAcknowledgements as StudyFamilyVerificationAcknowledgement[];

  assert.equal(counter.calls, 1);
  assert.equal(acknowledgements.length, 1);
  assert.equal(acknowledgements[0]?.recordId, 'report-1');
  assert.ok((first.artifacts.finalReport as any)?.appendices?.studyFamilyVerification);

  const noSecondCallPort = new CapturingPort(() => {
    throw new Error('unchanged acknowledged proposal should not be sent to family verification again');
  });
  const secondCounter = { calls: 0 };
  await new StudyFamilyHumanVerificationAgent(finalReportBase(secondCounter), noSecondCallPort).execute(
    context([unresolvedLink()], { studyFamilyVerificationAcknowledgements: acknowledgements }),
  );
  assert.equal(secondCounter.calls, 1);

  const changed = unresolvedLink({
    reasons: ['New registry evidence changed the study-family proposition.'],
    evidence: [{
      id: 'family-evidence-new',
      recordId: 'report-1',
      section: 'methods',
      page: 5,
      quote: 'New evidence refers to NCT04401579.',
      source: 'full-text',
      heading: 'Methods',
    }],
  });
  const changedPort = new CapturingPort(() => null);
  const changedCounter = { calls: 0 };
  const changedResult = await new StudyFamilyHumanVerificationAgent(finalReportBase(changedCounter), changedPort).execute(
    context([changed], { studyFamilyVerificationAcknowledgements: acknowledgements }),
  );
  assert.equal(changedCounter.calls, 0);
  assert.ok(changedResult.awaitingHuman);
  assert.equal(changedPort.package?.items.length, 1);
});

test('family verification audit survives a later resume through the generic human-verification gate', async () => {
  const familyPort = new CapturingPort((pkg) => ({
    packageId: pkg.id,
    mode: pkg.mode,
    decisions: [{
      itemId: pkg.items[0]!.id,
      verdict: 'accept',
      rationale: 'Available evidence cannot establish a parent family; retain the singleton assignment.',
      reviewerId: 'reviewer-3',
      decidedAt: '2026-08-10T02:03:00.000Z',
    }],
  }));
  const genericPaused: Agent = {
    stage: 'human-verify',
    async execute() {
      return {
        artifacts: { verificationPackage: { id: 'generic-pending' } },
        awaitingHuman: { summary: 'Generic verification still pending.' },
      };
    },
  };
  const first = await new StudyFamilyHumanVerificationAgent(genericPaused, familyPort).execute(context());
  const package1 = first.artifacts.studyFamilyVerificationPackage as HumanVerificationPackage;
  const outcome1 = first.artifacts.studyFamilyVerificationOutcome as HumanVerificationOutcome;
  const acknowledgements = first.artifacts.studyFamilyVerificationAcknowledgements as StudyFamilyVerificationAcknowledgement[];

  assert.ok(first.awaitingHuman);
  assert.equal(outcome1.status, 'accepted');
  assert.equal(acknowledgements.length, 1);

  const forbiddenFamilyPort = new CapturingPort(() => {
    throw new Error('acknowledged family proposal should not reopen on generic-verification resume');
  });
  const resumedCounter = { calls: 0 };
  const resumed = await new StudyFamilyHumanVerificationAgent(finalReportBase(resumedCounter), forbiddenFamilyPort).execute(
    context([unresolvedLink()], {
      studyFamilyVerificationPackage: package1,
      studyFamilyVerificationOutcome: outcome1,
      studyFamilyVerificationAcknowledgements: acknowledgements,
    }),
  );
  const audit = (resumed.artifacts.finalReport as any)?.appendices?.studyFamilyVerification;

  assert.equal(resumedCounter.calls, 1);
  assert.equal(audit?.package?.id, package1.id);
  assert.equal(audit?.outcome?.status, 'accepted');
  assert.equal(audit?.acknowledgements?.[0]?.recordId, 'report-1');
});
