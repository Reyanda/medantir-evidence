import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceExcerpt,
  ExtractedStudy,
  RiskOfBiasAssessment,
} from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type { ModelInferencePort, ModelInferenceResult } from '../inference/model-inference.js';
import {
  assessRob2,
  ROB2_QUESTIONS,
  type Rob2Assessment,
  type Rob2JudgementOverride,
  type Rob2Response,
  type Rob2SignalResponse,
} from './rob2.js';

export interface Rob2SignalSubmission {
  studyId: string;
  resultId: string;
  outcome: string;
  responses: Rob2SignalResponse[];
  overrides?: Rob2JudgementOverride[];
}

export interface Rob2ModelReceipt {
  studyId: string;
  resultId: string;
  outcome: string;
  requestHash: string;
  outputHash: string;
  routing: ModelInferenceResult['receipt'];
}

export interface Rob2EvidenceReviewItem {
  studyId: string;
  resultId: string;
  outcome: string;
  missingQuestionIds: string[];
  evidenceCatalog: EvidenceExcerpt[];
  reason?: string;
  proposedAssessment?: Rob2Assessment;
}

export interface Rob2EvidenceReviewPackage {
  version: 1;
  tool: 'RoB 2';
  toolVersion: '2019-08-22';
  trialDesign: 'individual-parallel';
  effectOfInterest: 'assignment';
  items: Rob2EvidenceReviewItem[];
  createdAt: string;
}

type ModelAnswer = {
  questionId: string;
  response: Rob2Response;
  rationale: string;
  evidenceIds: string[];
  confidence?: number;
};

function uniqueEvidence(study: ExtractedStudy): EvidenceExcerpt[] {
  const all = [
    ...Object.values(study.fieldEvidence).flat(),
    ...Object.values(study.sectionEvidence).flat(),
  ];
  const byId = new Map<string, EvidenceExcerpt>();
  for (const excerpt of all) if (!byId.has(excerpt.id)) byId.set(excerpt.id, excerpt);
  return [...byId.values()];
}

export function rob2ResultId(studyId: string, outcome: string): string {
  return `result-${stableHash({ studyId, outcome }).slice(0, 20)}`;
}

export function parseRob2ModelAnswers(text: string, evidence: EvidenceExcerpt[]): Rob2SignalResponse[] {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new Error('RoB 2 model returned invalid JSON'); }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { answers?: unknown }).answers)) {
    throw new Error('RoB 2 model JSON must contain an answers array');
  }
  const allowedIds = new Set(ROB2_QUESTIONS.map((question) => question.id));
  const evidenceById = new Map(evidence.map((excerpt) => [excerpt.id, excerpt]));
  const seen = new Set<string>();
  const responses: Rob2SignalResponse[] = [];
  for (const raw of (payload as { answers: unknown[] }).answers) {
    if (!raw || typeof raw !== 'object') throw new Error('RoB 2 model answer must be an object');
    const answer = raw as Partial<ModelAnswer>;
    if (typeof answer.questionId !== 'string' || !allowedIds.has(answer.questionId)) throw new Error(`RoB 2 model returned unknown question ${String(answer.questionId)}`);
    if (seen.has(answer.questionId)) throw new Error(`RoB 2 model returned duplicate question ${answer.questionId}`);
    seen.add(answer.questionId);
    if (!['Y', 'PY', 'PN', 'N', 'NI', 'NA'].includes(String(answer.response))) throw new Error(`RoB 2 model returned invalid response for ${answer.questionId}`);
    if (typeof answer.rationale !== 'string' || !answer.rationale.trim()) throw new Error(`RoB 2 model omitted rationale for ${answer.questionId}`);
    if (!Array.isArray(answer.evidenceIds) || answer.evidenceIds.some((id) => typeof id !== 'string')) throw new Error(`RoB 2 model evidenceIds are invalid for ${answer.questionId}`);
    const evidenceIds = [...new Set(answer.evidenceIds as string[])];
    const unknown = evidenceIds.filter((id) => !evidenceById.has(id));
    if (unknown.length) throw new Error(`RoB 2 model fabricated evidence id(s) for ${answer.questionId}: ${unknown.join(', ')}`);
    const response = answer.response as Rob2Response;
    if (response !== 'NI' && response !== 'NA' && evidenceIds.length === 0) {
      throw new Error(`RoB 2 model gave ${response} for ${answer.questionId} without source evidence`);
    }
    const confidence = answer.confidence === undefined ? undefined : Number(answer.confidence);
    if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new Error(`RoB 2 model confidence is invalid for ${answer.questionId}`);
    }
    responses.push({
      questionId: answer.questionId,
      response,
      rationale: answer.rationale.trim(),
      evidence: evidenceIds.map((id) => evidenceById.get(id)!),
      source: 'model-proposed',
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }
  return responses;
}

function modelPrompt(study: ExtractedStudy, outcome: string, evidence: EvidenceExcerpt[]): string {
  const catalog = evidence.map((excerpt) => ({
    id: excerpt.id,
    section: excerpt.section,
    page: excerpt.page,
    heading: excerpt.heading ?? null,
    text: excerpt.quote,
  }));
  return JSON.stringify({
    task: 'Answer RoB 2 signalling questions for one result from an individually randomized parallel-group trial, effect of assignment to intervention.',
    rules: [
      'Return JSON only: {"answers":[...]}.',
      'Allowed responses are Y, PY, PN, N, NI, NA.',
      'Do not produce a domain or overall risk judgement.',
      'Use only evidence IDs present in evidenceCatalog.',
      'For Y/PY/PN/N, cite at least one evidence ID. If evidence is insufficient, use NI rather than guessing.',
      'Use NA only for a conditional question whose antecedent makes it inapplicable.',
      'Keep rationale specific to the result/outcome being assessed.',
    ],
    study: {
      studyId: study.studyId,
      design: study.design,
      population: study.population,
      interventionOrExposure: study.interventionOrExposure,
      comparator: study.comparator,
      outcome,
    },
    questions: ROB2_QUESTIONS,
    evidenceCatalog: catalog,
  });
}

function genericRiskAssessment(assessment: Rob2Assessment): RiskOfBiasAssessment {
  return {
    studyId: `${assessment.studyId}::${assessment.resultId}`,
    tool: 'RoB 2 (2019-08-22; individual parallel; effect of assignment)',
    domains: assessment.domains.map((domain) => ({
      domain: `${domain.domain}: ${domain.title}`,
      judgement: domain.finalJudgement,
      rationale: domain.finalRationale.join(' '),
      evidence: domain.responses.flatMap((response) => response.evidence),
      humanOverride: domain.finalJudgement !== domain.algorithmJudgement,
    })),
    overall: assessment.finalOverall,
  };
}

/**
 * Evidence-bound RoB 2 agent.
 *
 * Human submissions are preferred. If absent and a model port is configured, the
 * model may propose signalling responses only. Every cited evidence ID is checked
 * against the study evidence catalogue. Deterministic software computes the
 * domain and overall judgements.
 *
 * Invalid model output or incomplete evidence becomes a structured review item;
 * it never becomes a fallback generic risk label.
 */
export class Rob2AppraisalAgent implements Agent {
  readonly stage = 'risk-of-bias' as const;

  constructor(
    private readonly inference?: { port: ModelInferencePort; model: string },
  ) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const studies = context.state.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    if (!studies) throw new Error('RoB 2 appraisal requires extractedStudies');
    const humanSubmissions = Array.isArray(context.state.artifacts.rob2SignalSubmissions)
      ? context.state.artifacts.rob2SignalSubmissions as Rob2SignalSubmission[]
      : [];
    const assessments: Rob2Assessment[] = [];
    const modelReceipts: Rob2ModelReceipt[] = [];
    const unresolved: Rob2EvidenceReviewItem[] = [];

    for (const study of studies) {
      const evidence = uniqueEvidence(study);
      for (const outcome of study.outcomes) {
        const id = rob2ResultId(study.studyId, outcome.name);
        const submitted = humanSubmissions.find((item) => item.studyId === study.studyId && item.resultId === id && item.outcome === outcome.name);
        let responses = submitted?.responses;
        const overrides = submitted?.overrides;

        if (!responses && this.inference) {
          const request = {
            taskId: `rob2:${study.studyId}:${id}`,
            model: this.inference.model,
            messages: [
              {
                role: 'system' as const,
                content: 'You are a structured evidence classifier. Do not infer beyond supplied evidence. The deterministic application, not you, determines RoB 2 judgements.',
              },
              { role: 'user' as const, content: modelPrompt(study, outcome.name, evidence) },
            ],
            temperature: 0,
            responseFormat: 'json' as const,
            promptVersion: 'MEDANTIR-ROB2-SIGNALS-1',
            evidenceObjectIds: evidence.map((excerpt) => excerpt.id),
            metadata: { tool: 'RoB 2', toolVersion: '2019-08-22', resultId: id, outcome: outcome.name },
          };
          try {
            const result = await this.inference.port.complete(request);
            responses = parseRob2ModelAnswers(result.text, evidence);
            modelReceipts.push({
              studyId: study.studyId,
              resultId: id,
              outcome: outcome.name,
              requestHash: result.requestHash,
              outputHash: result.outputHash,
              routing: result.receipt,
            });
          } catch (error) {
            unresolved.push({
              studyId: study.studyId,
              resultId: id,
              outcome: outcome.name,
              missingQuestionIds: ROB2_QUESTIONS.map((question) => question.id),
              evidenceCatalog: evidence,
              reason: `Model signalling proposal rejected: ${error instanceof Error ? error.message : String(error)}`,
            });
            continue;
          }
        }

        if (!responses) {
          unresolved.push({
            studyId: study.studyId,
            resultId: id,
            outcome: outcome.name,
            missingQuestionIds: ROB2_QUESTIONS.map((question) => question.id),
            evidenceCatalog: evidence,
            reason: 'No attributable human signalling responses or validated model proposal are available.',
          });
          continue;
        }

        let assessment: Rob2Assessment;
        try {
          assessment = assessRob2({
            studyId: study.studyId,
            resultId: id,
            outcome: outcome.name,
            responses,
            ...(overrides ? { overrides } : {}),
          });
        } catch (error) {
          unresolved.push({
            studyId: study.studyId,
            resultId: id,
            outcome: outcome.name,
            missingQuestionIds: ROB2_QUESTIONS.map((question) => question.id),
            evidenceCatalog: evidence,
            reason: `Deterministic RoB 2 validation rejected the submission: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }
        assessments.push(assessment);
        if (!assessment.complete) {
          unresolved.push({
            studyId: study.studyId,
            resultId: id,
            outcome: outcome.name,
            missingQuestionIds: assessment.domains.flatMap((domain) => domain.unsupportedQuestionIds),
            evidenceCatalog: evidence,
            reason: 'One or more active signalling questions are missing, unsupported, or inconsistent with conditional flow.',
            proposedAssessment: assessment,
          });
        }
      }
    }

    const reviewPackage: Rob2EvidenceReviewPackage = {
      version: 1,
      tool: 'RoB 2',
      toolVersion: '2019-08-22',
      trialDesign: 'individual-parallel',
      effectOfInterest: 'assignment',
      items: unresolved,
      createdAt: context.now(),
    };
    const completeAssessments = assessments.filter((assessment) => assessment.complete);
    const riskOfBias = completeAssessments.map(genericRiskAssessment);
    const artifacts: Record<string, unknown> = {
      rob2Assessments: assessments,
      rob2ModelReceipts: modelReceipts,
      rob2EvidenceReviewPackage: reviewPackage,
      riskOfBias,
      rob2AppraisalQuality: {
        expectedResults: studies.reduce((sum, study) => sum + study.outcomes.length, 0),
        assessedResults: assessments.length,
        completeResults: completeAssessments.length,
        unresolvedResults: unresolved.length,
        exactExcelAlgorithmParity: 'pending',
        productionCertificationBlockedOnExactParity: true,
      },
    };

    if (unresolved.length > 0) {
      return {
        artifacts,
        warnings: [`RoB 2 has ${unresolved.length} unresolved result-level assessment(s); no generic risk label was fabricated.`],
        awaitingHuman: {
          summary: `RoB 2 requires evidence review for ${unresolved.length} result-level assessment(s).`,
        },
      };
    }

    return {
      artifacts,
      warnings: ['RoB 2 signalling structure is evidence-bound; exact official Excel algorithm parity remains a certification gate.'],
    };
  }
}
