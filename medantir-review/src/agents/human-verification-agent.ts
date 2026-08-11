import type { HumanVerificationPort } from '../core/ports.js';
import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceExcerpt,
  EvidenceRecord,
  ExtractedStudy,
  FinalReport,
  GradeAssessment,
  HumanOverrideEntry,
  HumanOverrideLedger,
  HumanVerificationDecision,
  HumanVerificationOutcome,
  HumanVerificationPackage,
  HumanVerificationSubmission,
  RequiredEvidenceSection,
  RiskOfBiasAssessment,
  ScreeningDecision,
  StageName,
  SynthesisResult,
  VerificationItem,
  VerificationMode,
} from '../core/types.js';
import { nowIso, stableHash } from '../core/utils.js';

const defaultRequiredSections: RequiredEvidenceSection[] = [
  'rationale',
  'objectives',
  'results',
  'discussion',
  'limitations',
];

const stageOrder: StageName[] = [
  'question', 'protocol', 'search-build', 'search-execute', 'deduplicate', 'tiab-screen',
  'fulltext-retrieve', 'pdf-to-text', 'fulltext-screen', 'extract', 'risk-of-bias',
  'synthesise', 'grade', 'report', 'human-verify',
];

function artifact<T>(context: AgentContext, key: string): T {
  if (!(key in context.state.artifacts)) throw new Error(`Artifact '${key}' not found`);
  return context.state.artifacts[key] as T;
}

function evidenceCoverage(
  evidence: EvidenceExcerpt[],
): Record<RequiredEvidenceSection, boolean> {
  return {
    rationale: evidence.some((entry) => entry.section === 'rationale'),
    objectives: evidence.some((entry) => entry.section === 'objectives'),
    results: evidence.some((entry) => entry.section === 'results'),
    discussion: evidence.some((entry) => entry.section === 'discussion'),
    limitations: evidence.some((entry) => entry.section === 'limitations'),
  };
}

function subjectCode(value: string): string {
  return `BLD-${stableHash(value).slice(0, 8).toUpperCase()}`;
}

function createItem(input: Omit<VerificationItem, 'evidenceCoverage'>): VerificationItem {
  return { ...input, evidenceCoverage: evidenceCoverage(input.evidence) };
}

function withVisibility(item: VerificationItem, mode: VerificationMode): VerificationItem {
  if (mode === 'unblinded') return item;
  const { context: _context, machine: _machine, ...blinded } = item;
  return blinded;
}

function excerptsForStudy(study: ExtractedStudy): EvidenceExcerpt[] {
  return defaultRequiredSections.flatMap((section) => study.sectionEvidence[section]);
}

function decisionEvidence(decision: ScreeningDecision): EvidenceExcerpt[] {
  return decision.evidenceExcerpts ?? decision.evidence.map((quote, index) => ({
    id: `legacy:${decision.recordId}:${index}`,
    recordId: decision.recordId,
    section: 'other' as const,
    page: 0,
    quote,
    source: 'derived' as const,
  }));
}

function recordContext(record: EvidenceRecord | undefined, study?: ExtractedStudy): NonNullable<VerificationItem['context']> {
  return {
    ...(record ? {
      recordId: record.id,
      title: record.title,
      authors: record.authors,
      ...(record.journal ? { journal: record.journal } : {}),
      sourceDatabases: record.sourceDatabases,
    } : {}),
    ...(study ? { studyId: study.studyId, funding: study.funding } : {}),
  };
}

function buildItems(context: AgentContext, mode: VerificationMode): VerificationItem[] {
  const records = artifact<EvidenceRecord[]>(context, 'uniqueRecords');
  const recordById = new Map(records.map((record) => [record.id, record]));
  const tiab = artifact<ScreeningDecision[]>(context, 'tiabDecisions');
  const fulltext = artifact<ScreeningDecision[]>(context, 'fullTextDecisions');
  const studies = artifact<ExtractedStudy[]>(context, 'extractedStudies');
  const rob = context.state.artifacts.riskOfBias as RiskOfBiasAssessment[] | undefined;
  const grade = context.state.artifacts.grade as GradeAssessment[] | undefined;
  const synthesis = artifact<SynthesisResult>(context, 'synthesis');
  const draft = artifact<FinalReport>(context, 'draftReport');
  const items: VerificationItem[] = [];

  for (const decision of tiab) {
    const record = recordById.get(decision.recordId);
    items.push(withVisibility(createItem({
      id: `tiab:${decision.recordId}`,
      category: 'tiab-screening',
      sourceStage: 'tiab-screen',
      subjectCode: subjectCode(decision.recordId),
      label: 'Title and abstract eligibility',
      proposition: `The record should be ${decision.decision}d at title and abstract screening.`,
      proposedValue: { decision: decision.decision, reason: decision.reason },
      rationale: [decision.reason],
      evidence: decisionEvidence(decision),
      context: recordContext(record),
      machine: { agent: 'TiabScreeningAgent', confidence: decision.confidence },
    }), mode));
  }

  for (const decision of fulltext) {
    const record = recordById.get(decision.recordId);
    items.push(withVisibility(createItem({
      id: `fulltext:${decision.recordId}`,
      category: 'fulltext-screening',
      sourceStage: 'fulltext-screen',
      subjectCode: subjectCode(decision.recordId),
      label: 'Full-text eligibility',
      proposition: `The full text should be ${decision.decision}d.`,
      proposedValue: { decision: decision.decision, reason: decision.reason },
      rationale: [decision.reason],
      evidence: decisionEvidence(decision),
      context: recordContext(record),
      machine: { agent: 'FullTextScreeningAgent', confidence: decision.confidence },
    }), mode));
  }

  for (const study of studies) {
    const record = recordById.get(study.reportIds[0] ?? '');
    const allStudyEvidence = excerptsForStudy(study);
    const coreValue = {
      design: study.design,
      population: study.population,
      interventionOrExposure: study.interventionOrExposure,
      comparator: study.comparator,
      mechanisms: study.mechanisms,
      funding: study.funding,
    };
    items.push(withVisibility(createItem({
      id: `extract:${study.studyId}:core`,
      category: 'extraction',
      sourceStage: 'extract',
      subjectCode: subjectCode(study.studyId),
      label: 'Core study extraction',
      proposition: 'The structured study characteristics accurately represent the source report.',
      proposedValue: coreValue,
      rationale: ['Core characteristics were extracted from methods and interpreted against the complete evidence bundle.'],
      evidence: [...(study.fieldEvidence.core ?? []), ...allStudyEvidence],
      context: recordContext(record, study),
      machine: { agent: 'ExtractionAgent' },
    }), mode));

    const narrativeFields: Array<{
      key: RequiredEvidenceSection;
      label: string;
      value: unknown;
    }> = [
      { key: 'rationale', label: 'Study rationale', value: study.rationale },
      { key: 'objectives', label: 'Study objectives', value: study.objectives },
      { key: 'results', label: 'Study results', value: study.resultsSummary },
      { key: 'discussion', label: 'Study discussion and interpretation', value: study.discussionSummary },
      { key: 'limitations', label: 'Study limitations', value: study.limitations },
    ];
    for (const field of narrativeFields) {
      items.push(withVisibility(createItem({
        id: `extract:${study.studyId}:${field.key}`,
        category: 'extraction',
        sourceStage: 'extract',
        subjectCode: subjectCode(study.studyId),
        label: field.label,
        proposition: `The extracted ${field.key} accurately reflects the authors' report.`,
        proposedValue: field.value,
        rationale: [`The value is grounded in the ${field.key} section rather than inferred from the abstract alone.`],
        evidence: study.sectionEvidence[field.key],
        context: recordContext(record, study),
        machine: { agent: 'ExtractionAgent' },
      }), mode));
    }

    for (const outcome of study.outcomes) {
      items.push(withVisibility(createItem({
        id: `extract:${study.studyId}:outcome:${stableHash(outcome.name).slice(0, 10)}`,
        category: 'extraction',
        sourceStage: 'extract',
        subjectCode: subjectCode(study.studyId),
        label: `Outcome extraction: ${outcome.name}`,
        proposition: 'The outcome definition and numerical estimate are supported by the results section.',
        proposedValue: outcome,
        rationale: ['Outcome values must be verified against the reported results, tables, and stated estimand.'],
        evidence: study.fieldEvidence.outcomes ?? study.sectionEvidence.results,
        context: recordContext(record, study),
        machine: { agent: 'ExtractionAgent' },
      }), mode));
    }
  }

  for (const assessment of rob ?? []) {
    const study = studies.find((candidate) => candidate.studyId === assessment.studyId);
    const record = recordById.get(study?.reportIds[0] ?? '');
    for (const domain of assessment.domains) {
      items.push(withVisibility(createItem({
        id: `rob:${assessment.studyId}:${stableHash(domain.domain).slice(0, 10)}`,
        category: 'risk-of-bias',
        sourceStage: 'risk-of-bias',
        subjectCode: subjectCode(assessment.studyId),
        label: `Risk of bias: ${domain.domain}`,
        proposition: `The ${domain.domain} domain judgement should be ${domain.judgement}.`,
        proposedValue: { judgement: domain.judgement, rationale: domain.rationale },
        rationale: [domain.rationale],
        evidence: domain.evidence ?? (study ? excerptsForStudy(study) : []),
        context: recordContext(record, study),
        machine: { agent: 'RiskOfBiasAgent' },
      }), mode));
    }
  }

  const synthesisEvidence = studies.flatMap((study) => study.sectionEvidence.results);
  items.push(withVisibility(createItem({
    id: 'synthesis:overall',
    category: 'synthesis',
    sourceStage: 'synthesise',
    subjectCode: 'REVIEW-SYNTHESIS',
    label: 'Evidence synthesis',
    proposition: 'The selected synthesis method and resulting interpretation are justified by the included evidence.',
    proposedValue: synthesis,
    rationale: [synthesis.narrative],
    evidence: synthesis.evidence ?? synthesisEvidence,
    machine: { agent: 'SynthesisAgent' },
  }), mode));

  for (const assessment of grade ?? []) {
    items.push(withVisibility(createItem({
      id: `grade:${stableHash(assessment.outcome).slice(0, 12)}`,
      category: 'grade',
      sourceStage: 'grade',
      subjectCode: `OUTCOME-${stableHash(assessment.outcome).slice(0, 8).toUpperCase()}`,
      label: `Certainty of evidence: ${assessment.outcome}`,
      proposition: `The certainty rating should be ${assessment.certainty}.`,
      proposedValue: { certainty: assessment.certainty, rationale: assessment.rationale },
      rationale: assessment.rationale,
      evidence: assessment.evidence ?? synthesisEvidence,
      machine: { agent: 'GradeAgent' },
    }), mode));
  }

  items.push(withVisibility(createItem({
    id: 'report:conclusion',
    category: 'report',
    sourceStage: 'report',
    subjectCode: 'REVIEW-REPORT',
    label: 'Final report conclusion',
    proposition: 'The report conclusion is proportionate to the verified findings and limitations.',
    proposedValue: draft.sections.conclusion,
    rationale: [draft.sections.results ?? '', draft.sections.limitations ?? ''].filter(Boolean),
    evidence: [...synthesisEvidence, ...studies.flatMap((study) => study.sectionEvidence.limitations)],
    machine: { agent: 'ReportAgent' },
  }), mode));

  return items;
}

function validateSubmission(
  submission: HumanVerificationSubmission,
  verificationPackage: HumanVerificationPackage,
  requireAllItems: boolean,
): { decisions: HumanVerificationDecision[]; missing: string[] } {
  if (submission.packageId !== verificationPackage.id) throw new Error('Verification submission does not match the active package');
  if (submission.mode !== verificationPackage.mode) throw new Error('Verification mode does not match the active package');
  const validIds = new Set(verificationPackage.items.map((item) => item.id));
  const seen = new Set<string>();
  for (const decision of submission.decisions) {
    if (!validIds.has(decision.itemId)) throw new Error(`Unknown verification item '${decision.itemId}'`);
    if (seen.has(decision.itemId)) throw new Error(`Duplicate verification decision for '${decision.itemId}'`);
    if (!decision.rationale.trim()) throw new Error(`Human rationale is required for '${decision.itemId}'`);
    if (decision.verdict === 'amend' && decision.amendedValue === undefined) {
      throw new Error(`Amended value is required for '${decision.itemId}'`);
    }
    seen.add(decision.itemId);
  }
  const missing = requireAllItems
    ? verificationPackage.items.filter((item) => !seen.has(item.id)).map((item) => item.id)
    : [];
  return { decisions: submission.decisions, missing };
}

function outcomeFor(
  verificationPackage: HumanVerificationPackage,
  decisions: HumanVerificationDecision[],
  missing: string[],
): HumanVerificationOutcome {
  const accepted = decisions.filter((decision) => decision.verdict === 'accept').length;
  const rejected = decisions.filter((decision) => decision.verdict === 'reject').length;
  const amended = decisions.filter((decision) => decision.verdict === 'amend').length;
  const deferred = decisions.filter((decision) => decision.verdict === 'defer').length + missing.length;
  return {
    packageId: verificationPackage.id,
    mode: verificationPackage.mode,
    status: missing.length > 0 || deferred > 0
      ? 'incomplete'
      : rejected > 0 || amended > 0
        ? 'changes-requested'
        : 'accepted',
    accepted,
    rejected,
    amended,
    deferred,
    completedAt: nowIso(),
    decisions,
  };
}

function earliestStage(entries: HumanOverrideEntry[]): StageName {
  return entries.reduce<StageName>((earliest, entry) => {
    return stageOrder.indexOf(entry.sourceStage) < stageOrder.indexOf(earliest) ? entry.sourceStage : earliest;
  }, 'human-verify');
}

export class HumanVerificationAgent implements Agent {
  readonly stage = 'human-verify' as const;

  constructor(private readonly verificationPort?: HumanVerificationPort) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const config = context.state.request.humanVerification;
    const enabled = config?.enabled ?? true;
    const mode = config?.mode ?? 'unblinded';
    const requiredEvidenceSections = config?.requiredEvidenceSections ?? defaultRequiredSections;
    const requireAllItems = config?.requireAllItems ?? true;
    const draft = artifact<FinalReport>(context, 'draftReport');

    if (!enabled) {
      const verificationOutcome: HumanVerificationOutcome = {
        packageId: 'verification-disabled',
        mode,
        status: 'accepted',
        accepted: 0,
        rejected: 0,
        amended: 0,
        deferred: 0,
        completedAt: context.now(),
        decisions: [],
      };
      return {
        artifacts: {
          verificationPackage: {
            id: 'verification-disabled',
            runId: context.state.runId,
            mode,
            createdAt: context.now(),
            requiredEvidenceSections,
            blindedFields: [],
            items: [],
          } satisfies HumanVerificationPackage,
          verificationOutcome,
          finalReport: { ...draft, verification: verificationOutcome },
        },
      };
    }

    const items = buildItems(context, mode);
    const packageId = `verify-${stableHash({ runId: context.state.runId, mode, items }).slice(0, 24)}`;
    const verificationPackage: HumanVerificationPackage = {
      id: packageId,
      runId: context.state.runId,
      mode,
      createdAt: context.now(),
      requiredEvidenceSections,
      blindedFields: mode === 'blinded'
        ? ['record identifiers', 'authors', 'journal', 'source databases', 'funding', 'agent identity', 'model confidence']
        : [],
      items,
    };

    const missingCoverage = items
      .filter((item) => item.category === 'extraction' && item.id.endsWith(':core'))
      .flatMap((item) => requiredEvidenceSections
        .filter((section) => !item.evidenceCoverage[section])
        .map((section) => `${item.id}:${section}`));

    const submission = this.verificationPort ? await this.verificationPort.review(verificationPackage) : null;
    if (!submission) {
      return {
        artifacts: { verificationPackage, verificationCoverageWarnings: missingCoverage },
        warnings: missingCoverage.length > 0
          ? [`${missingCoverage.length} extraction evidence-section gaps require human attention`]
          : [],
        awaitingHuman: {
          summary: `Human verification is required for ${items.length} evidence-bound decisions in ${mode} mode.`,
        },
      };
    }

    const validated = validateSubmission(submission, verificationPackage, requireAllItems);
    const verificationOutcome = outcomeFor(verificationPackage, validated.decisions, validated.missing);

    if (verificationOutcome.status === 'incomplete') {
      return {
        artifacts: { verificationPackage, verificationOutcome, verificationCoverageWarnings: missingCoverage },
        awaitingHuman: {
          summary: `${verificationOutcome.deferred} verification decisions remain incomplete or deferred.`,
        },
      };
    }

    if (verificationOutcome.rejected > 0) {
      return {
        artifacts: { verificationPackage, verificationOutcome, verificationCoverageWarnings: missingCoverage },
        awaitingHuman: {
          summary: `${verificationOutcome.rejected} decisions were rejected. Submit amendments or resolve them through adjudication.`,
        },
      };
    }

    const amendments = validated.decisions.filter((decision) => decision.verdict === 'amend');
    if (amendments.length > 0) {
      const itemById = new Map(items.map((item) => [item.id, item]));
      const existing = context.state.artifacts.humanOverrides as HumanOverrideLedger | undefined;
      const entries: HumanOverrideEntry[] = amendments.map((decision) => {
        const item = itemById.get(decision.itemId);
        if (!item) throw new Error(`Cannot find amended verification item '${decision.itemId}'`);
        return {
          itemId: decision.itemId,
          sourceStage: item.sourceStage,
          amendedValue: decision.amendedValue,
          rationale: decision.rationale,
          ...(decision.reviewerId ? { reviewerId: decision.reviewerId } : {}),
          decidedAt: decision.decidedAt ?? context.now(),
        };
      });
      const mergedById = new Map<string, HumanOverrideEntry>();
      for (const entry of existing?.entries ?? []) mergedById.set(entry.itemId, entry);
      for (const entry of entries) mergedById.set(entry.itemId, entry);
      const ledger: HumanOverrideLedger = {
        version: (existing?.version ?? 0) + 1,
        entries: [...mergedById.values()],
      };
      const fromStage = earliestStage(entries);
      return {
        artifacts: { verificationPackage, verificationOutcome, humanOverrides: ledger },
        rework: {
          fromStage,
          reason: `${entries.length} human amendments must be applied and all dependent artefacts regenerated.`,
        },
      };
    }

    const finalReport: FinalReport = {
      ...draft,
      verification: verificationOutcome,
      appendices: {
        ...draft.appendices,
        humanVerification: {
          package: verificationPackage,
          outcome: verificationOutcome,
          evidenceCoverageWarnings: missingCoverage,
        },
      },
    };
    return {
      artifacts: { verificationPackage, verificationOutcome, finalReport },
      warnings: missingCoverage.length > 0
        ? [`Final verification accepted with ${missingCoverage.length} documented evidence-section gaps`]
        : [],
    };
  }
}
