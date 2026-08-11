import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  Agent,
  AgentContext,
  EvidenceRecord,
  ExtractedStudy,
  ParsedDocument,
  ScreeningDecision,
  SynthesisResult,
} from '../src/core/types.js';
import {
  StudyFamilyAwareExtractionAgent,
  StudyFamilyGuardedSynthesisAgent,
  StudyFamilyLinkageAgent,
  type StudyFamily,
  type StudyFamilyLink,
} from '../src/agents/study-family-linkage.js';

function record(id: string, title: string, abstract = '', keywords: string[] = []): EvidenceRecord {
  return {
    id,
    title,
    abstract,
    authors: ['Example Author'],
    year: 2021,
    sourceDatabases: ['pubmed'],
    keywords,
  };
}

function document(recordId: string, methods: string, results = 'Results were reported.'): ParsedDocument {
  return {
    recordId,
    text: `${methods}\n${results}`,
    pages: [{ page: 1, text: `${methods}\n${results}` }],
    sections: [
      { name: 'methods', heading: 'Methods', pageStart: 1, pageEnd: 1, text: methods },
      { name: 'results', heading: 'Results', pageStart: 1, pageEnd: 1, text: results },
    ],
    extractionMethod: 'native',
  };
}

function decision(recordId: string, value: ScreeningDecision['decision']): ScreeningDecision {
  return { recordId, decision: value, reason: 'fixture', confidence: 0.9, evidence: [] };
}

function context(artifacts: Record<string, unknown>): AgentContext {
  return {
    state: {
      runId: 'run-family',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: {
          title: 'Test review',
          objective: 'Test study family identity.',
          population: 'hospitalized adults',
          interventionOrExposure: 'baricitinib',
          outcomes: ['time to recovery', 'mortality'],
        },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts,
      audit: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    now: () => '2026-08-10T00:00:00.000Z',
  };
}

function fullTextBase(decisions: ScreeningDecision[], included: ParsedDocument[]): Agent {
  return {
    stage: 'fulltext-screen',
    async execute() {
      return { artifacts: { fullTextDecisions: decisions, includedDocuments: included } };
    },
  };
}

test('primary and secondary reports sharing one registry ID become one study family without sharing eligibility', async () => {
  const primary = record('primary', 'Baricitinib trial', '', ['NCT04401579']);
  const secondary = record('secondary', 'Secondary analysis of ACTT-2');
  const primaryDoc = document(
    'primary',
    'Eligible patients in NCT04401579 were randomly assigned to baricitinib or placebo.',
  );
  const secondaryDoc = document(
    'secondary',
    'This secondary analysis of NCT04401579 evaluated a biomarker among participants from the parent trial.',
  );
  const decisions = [decision('primary', 'include'), decision('secondary', 'uncertain')];
  const agent = new StudyFamilyLinkageAgent(fullTextBase(decisions, [primaryDoc]));
  const result = await agent.execute(context({
    uniqueRecords: [primary, secondary],
    parsedDocuments: [primaryDoc, secondaryDoc],
  }));

  const links = result.artifacts.studyFamilyLinks as StudyFamilyLink[];
  const families = result.artifacts.studyFamilies as StudyFamily[];
  const primaryLink = links.find((link) => link.recordId === 'primary')!;
  const secondaryLink = links.find((link) => link.recordId === 'secondary')!;

  assert.equal(primaryLink.familyId, secondaryLink.familyId);
  assert.equal(primaryLink.role, 'primary-results');
  assert.equal(secondaryLink.role, 'secondary-analysis');
  assert.equal(primaryLink.eligibilityDecision, 'include');
  assert.equal(secondaryLink.eligibilityDecision, 'uncertain');
  assert.equal(families.length, 1);
  assert.deepEqual(families[0]?.memberReportIds, ['primary', 'secondary']);
  assert.deepEqual(families[0]?.primaryReportIds, ['primary']);
});

test('multiple registry identifiers fail closed to a singleton family requiring human review', async () => {
  const ambiguous = record('ambiguous', 'Companion report');
  const ambiguousDoc = document(
    'ambiguous',
    'Participants were drawn from NCT04401579 and NCT04280705 for a pooled secondary analysis.',
  );
  const agent = new StudyFamilyLinkageAgent(fullTextBase([decision('ambiguous', 'uncertain')], []));
  const result = await agent.execute(context({ uniqueRecords: [ambiguous], parsedDocuments: [ambiguousDoc] }));
  const links = result.artifacts.studyFamilyLinks as StudyFamilyLink[];

  assert.equal(links[0]?.linkageBasis, 'ambiguous-multiple-registry-ids');
  assert.equal(links[0]?.requiresHumanReview, true);
  assert.equal(links[0]?.registryIds.length, 2);
  assert.match(links[0]?.familyId ?? '', /^family-report-/);
});

function extractedStudy(studyId: string, reportId: string, outcome = 'time to recovery', effect = 0.2): ExtractedStudy {
  return {
    studyId,
    reportIds: [reportId],
    design: 'randomised controlled trial',
    population: 'Adults',
    interventionOrExposure: 'Treatment',
    comparator: 'Control',
    outcomes: [{ name: outcome, effect, standardError: 0.1 }],
    mechanisms: [],
    funding: 'Not reported',
    rationale: 'Rationale',
    objectives: ['Objective'],
    resultsSummary: 'Results',
    discussionSummary: 'Discussion',
    limitations: [],
    sectionEvidence: { rationale: [], objectives: [], results: [], discussion: [], limitations: [] },
    fieldEvidence: {},
    sourceQuotes: [],
  };
}

test('family-aware extraction preserves report-level study IDs while attaching family identity', async () => {
  const base: Agent = {
    stage: 'extract',
    async execute() {
      return { artifacts: { extractedStudies: [extractedStudy('study-primary', 'primary')] } };
    },
  };
  const links: StudyFamilyLink[] = [{
    recordId: 'primary',
    familyId: 'family-registry-nct04401579',
    role: 'primary-results',
    registryIds: ['NCT04401579'],
    linkageBasis: 'single-registry-id',
    confidence: 0.99,
    eligibilityDecision: 'include',
    requiresHumanReview: false,
    reasons: ['fixture'],
  }];
  const result = await new StudyFamilyAwareExtractionAgent(base).execute(context({ studyFamilyLinks: links }));
  const study = (result.artifacts.extractedStudies as Array<ExtractedStudy & { studyFamilyId?: string; reportRole?: string }>)[0]!;

  assert.equal(study.studyId, 'study-primary');
  assert.equal(study.reportIds[0], 'primary');
  assert.equal(study.studyFamilyId, 'family-registry-nct04401579');
  assert.equal(study.reportRole, 'primary-results');
});

function synthesisBase(): Agent {
  return {
    stage: 'synthesise',
    async execute() {
      const synthesis: SynthesisResult = {
        mode: 'meta-analysis',
        status: 'computed',
        includedStudies: 2,
        pooledEffect: 0.2,
        standardError: 0.05,
        narrative: 'Base pool.',
      };
      return { artifacts: { synthesis } };
    },
  };
}

test('two numerical reports from the same family and outcome cannot be pooled automatically', async () => {
  const a = Object.assign(extractedStudy('study-a', 'report-a', 'mortality', 0.1), {
    studyFamilyId: 'family-registry-nct04401579',
  });
  const b = Object.assign(extractedStudy('study-b', 'report-b', 'mortality', 0.2), {
    studyFamilyId: 'family-registry-nct04401579',
  });
  const result = await new StudyFamilyGuardedSynthesisAgent(synthesisBase()).execute(context({ extractedStudies: [a, b] }));
  const synthesis = result.artifacts.synthesis as SynthesisResult;
  const conflicts = result.artifacts.studyFamilySynthesisConflicts as unknown[];

  assert.equal(synthesis.status, 'narrative');
  assert.equal(synthesis.pooledEffect, undefined);
  assert.equal(conflicts.length, 1);
  assert.match(synthesis.narrative, /same outcome\/measure\/analysis scale|same outcome/i);
});

test('reports from one family contributing different outcomes do not trigger the duplicate-family guard', async () => {
  const a = Object.assign(extractedStudy('study-a', 'report-a', 'time to recovery', 0.1), {
    studyFamilyId: 'family-registry-nct04401579',
  });
  const b = Object.assign(extractedStudy('study-b', 'report-b', 'mortality', 0.2), {
    studyFamilyId: 'family-registry-nct04401579',
  });
  const result = await new StudyFamilyGuardedSynthesisAgent(synthesisBase()).execute(context({ extractedStudies: [a, b] }));
  const synthesis = result.artifacts.synthesis as SynthesisResult;
  const conflicts = result.artifacts.studyFamilySynthesisConflicts as unknown[];

  assert.equal(synthesis.status, 'computed');
  assert.equal(conflicts.length, 0);
});
