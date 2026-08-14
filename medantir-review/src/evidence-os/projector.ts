import { canonicalScientificValue, scientificContentHash } from '../core/canonical-hash.js';
import type {
  AuditEvent,
  EvidenceExcerpt,
  ExtractedStudy,
  PipelineState,
  ScreeningDecision,
  StageName,
} from '../core/types.js';
import { createReviewProtocol } from '../protocols/review-protocol.js';
import { ImmutableEvidenceGraphBuilder } from './object-store.js';
import type {
  EvidenceGraphSnapshot,
  EvidenceObject,
  EvidenceObjectKind,
  EvidenceProvenance,
  EvidenceSourceClass,
} from './types.js';

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function identity(value: unknown, keys: string[]): string | undefined {
  const item = record(value);
  if (!item) return undefined;
  for (const key of keys) {
    const selected = text(item[key]);
    if (selected) return selected;
  }
  return undefined;
}

function sourceClassForStage(stage: StageName | undefined): EvidenceSourceClass {
  if (!stage) return 'derived-deterministically';
  if (stage === 'question') return 'user-input';
  if (['protocol', 'protocol-draft', 'protocol-finalise'].includes(stage)) return 'protocol';
  if (['search-execute', 'review-landscape'].includes(stage)) return 'bibliographic-api';
  if (stage === 'fulltext-retrieve') return 'full-text';
  if (['risk-of-bias', 'grade', 'human-verify'].includes(stage)) return 'human-adjudicated';
  return 'derived-deterministically';
}

function artifactKind(key: string): EvidenceObjectKind {
  const normalized = key.toLowerCase();
  if (normalized.includes('question') || normalized.includes('reviewspec')) return 'question';
  if (normalized.includes('protocol')) return 'protocol';
  if (normalized.includes('searchstrateg')) return 'search-strategy';
  if (normalized.includes('searchprovenance') || normalized.includes('searchreceipt')) return 'search-execution';
  if (normalized.includes('record')) return 'retrieved-record';
  if (normalized.includes('decision')) return 'screening-decision';
  if (normalized.includes('fulltext')) return 'full-text';
  if (normalized.includes('parsed')) return 'parsed-document';
  if (normalized.includes('study') || normalized.includes('extract')) return 'study';
  if (normalized.includes('riskofbias') || normalized.includes('rob2')) return 'risk-of-bias';
  if (normalized.includes('synthesis') || normalized.includes('analysis')) return 'synthesis';
  if (normalized.includes('grade') || normalized.includes('certainty')) return 'certainty-assessment';
  if (normalized.includes('report')) return 'report';
  if (normalized.includes('verification')) return 'verification-decision';
  if (normalized.includes('registration') || normalized.includes('registry')) return 'registry-receipt';
  return 'artifact';
}

function evidenceProvenance(input: {
  sourceClass: EvidenceSourceClass;
  sourceIds?: string[];
  locators?: EvidenceProvenance['locators'];
  method?: string;
  actorId?: string;
  model?: string;
  provider?: string;
  requestHash?: string;
  outputHash?: string;
}): EvidenceProvenance[] {
  return [{
    sourceClass: input.sourceClass,
    sourceIds: input.sourceIds ?? [],
    locators: input.locators ?? [],
    ...(input.method ? { method: input.method } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.requestHash ? { requestHash: input.requestHash } : {}),
    ...(input.outputHash ? { outputHash: input.outputHash } : {}),
  }];
}

function excerptObject(
  builder: ImmutableEvidenceGraphBuilder,
  excerpt: EvidenceExcerpt,
  studyObject?: EvidenceObject,
): EvidenceObject {
  const object = builder.add({
    kind: 'evidence-excerpt',
    logicalId: `excerpt:${excerpt.id}`,
    payload: excerpt,
    sourceStage: 'extract',
    provenance: evidenceProvenance({
      sourceClass: excerpt.source === 'full-text' ? 'full-text' : excerpt.source === 'title-abstract' ? 'bibliographic-api' : 'derived-deterministically',
      sourceIds: [excerpt.recordId],
      locators: [{
        recordId: excerpt.recordId,
        page: excerpt.page,
        section: excerpt.section,
        quote: excerpt.quote,
        ...(excerpt.uri ? { uri: excerpt.uri } : {}),
      }],
    }),
  });
  if (studyObject) builder.link({ fromObjectId: object.objectId, toObjectId: studyObject.objectId, relation: 'supports' });
  return object;
}

function stageForArtifacts(state: PipelineState): Map<string, StageName> {
  const output = new Map<string, StageName>();
  for (const stage of createReviewProtocol(state.request.reviewType).stages) {
    for (const artifact of stage.producedArtifacts) output.set(artifact, stage.stage);
  }
  const explicit: Record<string, StageName> = {
    reviewSpec: 'question',
    reviewSpecCompilation: 'question',
    clarificationRequest: 'question',
    clarificationIssues: 'question',
    rob2Assessments: 'risk-of-bias',
    rob2SignalSubmissions: 'risk-of-bias',
    rob2EvidenceReviewPackage: 'risk-of-bias',
    gradeOutcomeAssessments: 'grade',
    gradeEvidenceReviewPackage: 'grade',
    scientificRunManifest: 'human-verify',
    scientificRunSeal: 'human-verify',
  };
  for (const [key, stage] of Object.entries(explicit)) output.set(key, stage);
  return output;
}

function addRecordObjects(
  builder: ImmutableEvidenceGraphBuilder,
  values: unknown,
  phase: 'retrieved' | 'deduplicated' | 'tiab-included',
  stage: StageName,
): Map<string, EvidenceObject> {
  const output = new Map<string, EvidenceObject>();
  for (const raw of array(values)) {
    const id = identity(raw, ['id', 'recordId', 'doi', 'pmid']);
    if (!id) continue;
    const kind: EvidenceObjectKind = phase === 'deduplicated' ? 'deduplicated-record' : 'retrieved-record';
    const object = builder.add({
      kind,
      logicalId: `record:${phase}:${id}`,
      payload: { phase, record: raw },
      sourceStage: stage,
      provenance: evidenceProvenance({
        sourceClass: phase === 'retrieved' ? 'bibliographic-api' : 'derived-deterministically',
        sourceIds: [id],
        method: phase,
      }),
    });
    output.set(id, object);
  }
  return output;
}

function addScreeningDecisions(
  builder: ImmutableEvidenceGraphBuilder,
  values: unknown,
  phase: 'title-abstract' | 'full-text',
  sourceRecords: Map<string, EvidenceObject>,
): void {
  for (const raw of array(values)) {
    const item = record(raw);
    const recordId = item ? text(item.recordId) : undefined;
    if (!item || !recordId) continue;
    const decision = raw as ScreeningDecision;
    const actorId = item.humanOverride === true ? 'human-override' : undefined;
    const object = builder.add({
      kind: 'screening-decision',
      logicalId: `screening:${phase}:${recordId}`,
      payload: { phase, decision },
      sourceStage: phase === 'title-abstract' ? 'tiab-screen' : 'fulltext-screen',
      provenance: evidenceProvenance({
        sourceClass: actorId ? 'human-adjudicated' : 'derived-deterministically',
        sourceIds: [recordId],
        ...(actorId ? { actorId } : {}),
      }),
    });
    const source = sourceRecords.get(recordId);
    if (source) builder.link({ fromObjectId: source.objectId, toObjectId: object.objectId, relation: 'screened-by' });
    for (const excerpt of decision.evidenceExcerpts ?? []) excerptObject(builder, excerpt);
  }
}

function addStudies(builder: ImmutableEvidenceGraphBuilder, values: unknown): Map<string, EvidenceObject> {
  const studies = new Map<string, EvidenceObject>();
  for (const raw of array(values)) {
    const item = record(raw);
    const studyId = item ? text(item.studyId) : undefined;
    if (!item || !studyId) continue;
    const study = raw as ExtractedStudy;
    const object = builder.add({
      kind: 'study',
      logicalId: `study:${studyId}`,
      payload: study,
      sourceStage: 'extract',
      provenance: evidenceProvenance({
        sourceClass: 'derived-deterministically',
        sourceIds: study.reportIds,
        method: 'provenance-first-extraction',
      }),
    });
    studies.set(studyId, object);
    study.outcomes.forEach((outcome, index) => {
      if (typeof outcome.effect !== 'number' && typeof outcome.standardError !== 'number') return;
      const estimate = builder.add({
        kind: 'effect-estimate',
        logicalId: `effect:${studyId}:${outcome.name}:${index}`,
        payload: outcome,
        sourceStage: 'extract',
        provenance: evidenceProvenance({ sourceClass: 'derived-deterministically', sourceIds: study.reportIds }),
      });
      builder.link({ fromObjectId: estimate.objectId, toObjectId: object.objectId, relation: 'extracts' });
    });
    const excerpts = [
      ...Object.values(study.sectionEvidence).flat(),
      ...Object.values(study.fieldEvidence).flat(),
    ];
    const seen = new Set<string>();
    for (const excerpt of excerpts) {
      if (seen.has(excerpt.id)) continue;
      seen.add(excerpt.id);
      excerptObject(builder, excerpt, object);
    }
  }
  return studies;
}

function addAuditObjects(builder: ImmutableEvidenceGraphBuilder, audit: AuditEvent[]): void {
  for (const event of audit) {
    const actorId = text(event.details.actorId);
    builder.add({
      kind: 'audit-event',
      logicalId: `audit:${event.id}`,
      payload: event,
      sourceStage: event.stage,
      createdAt: event.timestamp,
      provenance: evidenceProvenance({
        sourceClass: 'system-audit',
        sourceIds: [event.runId, event.id],
        method: event.event,
        ...(actorId ? { actorId } : {}),
      }),
    });
  }
}

export function projectPipelineToEvidenceGraph(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
  previous?: EvidenceGraphSnapshot,
): EvidenceGraphSnapshot {
  const builder = new ImmutableEvidenceGraphBuilder(state.request.reviewType, generatedAt, previous);
  const question = builder.add({
    kind: 'question',
    logicalId: `question:${scientificContentHash(state.request.question).slice(0, 32)}`,
    payload: state.request.question,
    sourceStage: 'question',
    root: true,
    provenance: evidenceProvenance({ sourceClass: 'user-input', sourceIds: [] }),
  });

  const workflowStages = new Map<StageName, EvidenceObject>();
  const protocol = createReviewProtocol(state.request.reviewType);
  for (const stage of protocol.stages) {
    const stageObject = builder.add({
      kind: 'pipeline-stage',
      logicalId: `stage:${stage.stage}`,
      payload: {
        stage: stage.stage,
        state: state.stages[stage.stage],
        requiredArtifacts: stage.requiredArtifacts,
        producedArtifacts: stage.producedArtifacts,
        humanGate: stage.humanGate,
        maxRetries: stage.maxRetries,
      },
      sourceStage: stage.stage,
      provenance: evidenceProvenance({ sourceClass: 'system-audit', sourceIds: [] }),
    });
    workflowStages.set(stage.stage, stageObject);
  }
  const artifactProducer = new Map<string, StageName>();
  for (const stage of protocol.stages) {
    const target = workflowStages.get(stage.stage)!;
    for (const required of stage.requiredArtifacts) {
      const producer = artifactProducer.get(required);
      const source = producer ? workflowStages.get(producer) : undefined;
      if (source) builder.link({ fromObjectId: source.objectId, toObjectId: target.objectId, relation: 'depends-on', metadata: { artifact: required } });
    }
    for (const produced of stage.producedArtifacts) artifactProducer.set(produced, stage.stage);
  }
  const questionStage = workflowStages.get('question');
  if (questionStage) builder.link({ fromObjectId: question.objectId, toObjectId: questionStage.objectId, relation: 'produced-by' });

  const stagesByArtifact = stageForArtifacts(state);
  for (const key of Object.keys(state.artifacts).sort()) {
    const value = state.artifacts[key];
    const stage = stagesByArtifact.get(key);
    const object = builder.add({
      kind: artifactKind(key),
      logicalId: `artifact:${key}`,
      payload: { artifactKey: key, value: canonicalScientificValue(value) },
      ...(stage ? { sourceStage: stage } : {}),
      provenance: evidenceProvenance({
        sourceClass: sourceClassForStage(stage),
        sourceIds: [key],
        method: 'pipeline-artifact-projection',
      }),
      root: key === 'protocolPackage' || key === 'finalReport' || key === 'draftReport',
    });
    const stageObject = stage ? workflowStages.get(stage) : undefined;
    if (stageObject) builder.link({ fromObjectId: stageObject.objectId, toObjectId: object.objectId, relation: 'produced-by', metadata: { artifactKey: key } });
  }

  const retrieved = addRecordObjects(builder, state.artifacts.searchResults, 'retrieved', 'search-execute');
  const deduplicated = addRecordObjects(builder, state.artifacts.uniqueRecords, 'deduplicated', 'deduplicate');
  for (const [id, object] of deduplicated) {
    const source = retrieved.get(id);
    if (source) builder.link({ fromObjectId: source.objectId, toObjectId: object.objectId, relation: 'deduplicated-to' });
  }
  addScreeningDecisions(builder, state.artifacts.tiabDecisions, 'title-abstract', deduplicated.size ? deduplicated : retrieved);
  const tiabIncluded = addRecordObjects(builder, state.artifacts.tiabIncluded, 'tiab-included', 'tiab-screen');
  addScreeningDecisions(builder, state.artifacts.fullTextDecisions, 'full-text', tiabIncluded);

  for (const raw of array(state.artifacts.fullTexts)) {
    const recordId = identity(raw, ['recordId', 'id']);
    if (!recordId) continue;
    const object = builder.add({
      kind: 'full-text', logicalId: `fulltext:${recordId}`, payload: raw, sourceStage: 'fulltext-retrieve',
      provenance: evidenceProvenance({ sourceClass: 'full-text', sourceIds: [recordId] }),
    });
    const source = tiabIncluded.get(recordId) ?? deduplicated.get(recordId) ?? retrieved.get(recordId);
    if (source) builder.link({ fromObjectId: source.objectId, toObjectId: object.objectId, relation: 'retrieved-as' });
  }
  for (const raw of array(state.artifacts.parsedDocuments)) {
    const recordId = identity(raw, ['recordId', 'id']);
    if (!recordId) continue;
    const parsed = builder.add({
      kind: 'parsed-document', logicalId: `parsed:${recordId}`, payload: raw, sourceStage: 'pdf-to-text',
      provenance: evidenceProvenance({ sourceClass: 'derived-deterministically', sourceIds: [recordId], method: 'document-intelligence' }),
    });
    const fullText = builder.latest('full-text', `fulltext:${recordId}`);
    if (fullText) builder.link({ fromObjectId: fullText.objectId, toObjectId: parsed.objectId, relation: 'parsed-as' });
  }

  const studies = addStudies(builder, state.artifacts.extractedStudies);
  for (const raw of [...array(state.artifacts.riskOfBias), ...array(state.artifacts.rob2Assessments)]) {
    const studyId = identity(raw, ['studyId']);
    if (!studyId) continue;
    const appraisal = builder.add({
      kind: 'risk-of-bias', logicalId: `appraisal:${studyId}:${identity(raw, ['resultId', 'assessmentId']) ?? 'overall'}`,
      payload: raw, sourceStage: 'risk-of-bias',
      provenance: evidenceProvenance({ sourceClass: 'human-adjudicated', sourceIds: [studyId], method: 'design-specific-appraisal' }),
    });
    const baseStudyId = studyId.split('::')[0] ?? studyId;
    const study = studies.get(baseStudyId);
    if (study) builder.link({ fromObjectId: study.objectId, toObjectId: appraisal.objectId, relation: 'appraised-by' });
  }

  const synthesisValue = state.artifacts.synthesis;
  if (synthesisValue !== undefined) {
    const synthesis = builder.add({
      kind: 'synthesis', logicalId: 'synthesis:primary', payload: synthesisValue, sourceStage: 'synthesise', root: true,
      provenance: evidenceProvenance({ sourceClass: 'derived-deterministically', sourceIds: [...studies.keys()], method: 'synthesis-engine' }),
    });
    for (const study of studies.values()) builder.link({ fromObjectId: study.objectId, toObjectId: synthesis.objectId, relation: 'contributes-to' });
    for (const raw of array(state.artifacts.grade)) {
      const outcome = identity(raw, ['outcome']) ?? scientificContentHash(raw).slice(0, 16);
      const grade = builder.add({
        kind: 'certainty-assessment', logicalId: `grade:${outcome}`, payload: raw, sourceStage: 'grade', root: true,
        provenance: evidenceProvenance({ sourceClass: 'human-adjudicated', sourceIds: [synthesis.objectId], method: 'GRADE' }),
      });
      builder.link({ fromObjectId: synthesis.objectId, toObjectId: grade.objectId, relation: 'graded-by' });
    }
  }

  for (const key of ['draftReport', 'finalReport']) {
    const reportValue = state.artifacts[key];
    if (reportValue === undefined) continue;
    const report = builder.latest('report', `artifact:${key}`);
    const synthesis = builder.latest('synthesis', 'synthesis:primary');
    if (report && synthesis) builder.link({ fromObjectId: synthesis.objectId, toObjectId: report.objectId, relation: 'reported-in' });
  }

  addAuditObjects(builder, state.audit);
  return builder.snapshot({
    runId: state.runId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    stageCount: protocol.stages.length,
    artifactCount: Object.keys(state.artifacts).length,
    auditEventCount: state.audit.length,
  });
}
