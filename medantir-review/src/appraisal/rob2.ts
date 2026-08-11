import type { EvidenceExcerpt } from '../core/types.js';
import { stableHash } from '../core/utils.js';

export type Rob2Response = 'Y' | 'PY' | 'PN' | 'N' | 'NI' | 'NA';
export type Rob2Judgement = 'low' | 'some-concerns' | 'high';
export type Rob2DomainId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5';
export type Rob2EffectOfInterest = 'assignment';
export type Rob2TrialDesign = 'individual-parallel';

export interface Rob2QuestionDefinition {
  id: string;
  domain: Rob2DomainId;
  text: string;
  conditional: boolean;
}

export interface Rob2SignalResponse {
  questionId: string;
  response: Rob2Response;
  rationale: string;
  evidence: EvidenceExcerpt[];
  source: 'model-proposed' | 'human' | 'deterministic';
  confidence?: number;
  modelReceiptId?: string;
}

export interface Rob2DomainAssessment {
  domain: Rob2DomainId;
  title: string;
  activeQuestionIds: string[];
  responses: Rob2SignalResponse[];
  /** Immutable software proposal. Retained even if a human overrides the domain. */
  algorithmJudgement: Rob2Judgement;
  /** Backwards-compatible alias for the immutable algorithm judgement. */
  proposedJudgement: Rob2Judgement;
  /** Domain judgement after any attributable domain-level override. */
  finalJudgement: Rob2Judgement;
  rationale: string[];
  finalRationale: string[];
  complete: boolean;
  unsupportedQuestionIds: string[];
  inactiveResponseQuestionIds: string[];
}

export interface Rob2JudgementOverride {
  scope: Rob2DomainId | 'overall';
  from: Rob2Judgement;
  to: Rob2Judgement;
  rationale: string;
  actorId: string;
  decidedAt: string;
}

export interface Rob2AlgorithmAuthority {
  tool: 'RoB 2';
  toolVersion: '2019-08-22';
  trialDesign: Rob2TrialDesign;
  effectOfInterest: Rob2EffectOfInterest;
  implementation: 'MEDANTIR-ROB2-ASSIGNMENT-CONSERVATIVE-1';
  signallingStructureAuthority: 'official-rob2-2019';
  exactExcelAlgorithmParity: 'pending';
  productionCertificationBlockedOnExactParity: true;
}

export interface Rob2Assessment {
  version: 1;
  assessmentId: string;
  studyId: string;
  resultId: string;
  outcome: string;
  trialDesign: Rob2TrialDesign;
  effectOfInterest: Rob2EffectOfInterest;
  domains: Rob2DomainAssessment[];
  /** Overall judgement derived from immutable software domain judgements. */
  algorithmOverall: Rob2Judgement;
  /** Backwards-compatible alias for algorithmOverall. */
  proposedOverall: Rob2Judgement;
  /** Overall after domain-level overrides, before any explicit overall override. */
  domainAdjustedOverall: Rob2Judgement;
  /** Final attributable overall judgement. */
  finalOverall: Rob2Judgement;
  overrides: Rob2JudgementOverride[];
  multipleSomeConcernsEscalation: boolean;
  complete: boolean;
  authority: Rob2AlgorithmAuthority;
  assessmentHash: string;
}

export const ROB2_QUESTIONS: readonly Rob2QuestionDefinition[] = [
  { id: '1.1', domain: 'D1', conditional: false, text: 'Was the allocation sequence random?' },
  { id: '1.2', domain: 'D1', conditional: false, text: 'Was the allocation sequence concealed until participants were enrolled and assigned to interventions?' },
  { id: '1.3', domain: 'D1', conditional: false, text: 'Did baseline differences between intervention groups suggest a problem with the randomization process?' },
  { id: '2.1', domain: 'D2', conditional: false, text: 'Were participants aware of their assigned intervention during the trial?' },
  { id: '2.2', domain: 'D2', conditional: false, text: 'Were carers and people delivering the interventions aware of participants’ assigned intervention during the trial?' },
  { id: '2.3', domain: 'D2', conditional: true, text: 'Were there deviations from the intended intervention that arose because of the trial context?' },
  { id: '2.4', domain: 'D2', conditional: true, text: 'Were these deviations likely to have affected the outcome?' },
  { id: '2.5', domain: 'D2', conditional: true, text: 'Were these deviations from intended intervention balanced between groups?' },
  { id: '2.6', domain: 'D2', conditional: false, text: 'Was an appropriate analysis used to estimate the effect of assignment to intervention?' },
  { id: '2.7', domain: 'D2', conditional: true, text: 'Was there potential for a substantial impact on the result of the failure to analyse participants in the group to which they were randomized?' },
  { id: '3.1', domain: 'D3', conditional: false, text: 'Were data for this outcome available for all, or nearly all, participants randomized?' },
  { id: '3.2', domain: 'D3', conditional: true, text: 'Is there evidence that the result was not biased by missing outcome data?' },
  { id: '3.3', domain: 'D3', conditional: true, text: 'Could missingness in the outcome depend on its true value?' },
  { id: '3.4', domain: 'D3', conditional: true, text: 'Is it likely that missingness in the outcome depended on its true value?' },
  { id: '4.1', domain: 'D4', conditional: false, text: 'Was the method of measuring the outcome inappropriate?' },
  { id: '4.2', domain: 'D4', conditional: false, text: 'Could measurement or ascertainment of the outcome have differed between intervention groups?' },
  { id: '4.3', domain: 'D4', conditional: false, text: 'Were outcome assessors aware of the intervention received by study participants?' },
  { id: '4.4', domain: 'D4', conditional: true, text: 'Could the assessment of the outcome have been influenced by knowledge of intervention received?' },
  { id: '4.5', domain: 'D4', conditional: true, text: 'Is it likely that assessment of the outcome was influenced by knowledge of intervention received?' },
  { id: '5.1', domain: 'D5', conditional: false, text: 'Were the data that produced this result analysed in accordance with a pre-specified analysis plan that was finalized before unblinded outcome data were available for analysis?' },
  { id: '5.2', domain: 'D5', conditional: false, text: 'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible outcome measurements within the outcome domain?' },
  { id: '5.3', domain: 'D5', conditional: false, text: 'Is the numerical result being assessed likely to have been selected, on the basis of the results, from multiple eligible analyses of the data?' },
] as const;

const DOMAIN_TITLES: Record<Rob2DomainId, string> = {
  D1: 'Bias arising from the randomization process',
  D2: 'Bias due to deviations from intended interventions',
  D3: 'Bias due to missing outcome data',
  D4: 'Bias in measurement of the outcome',
  D5: 'Bias in selection of the reported result',
};

const POS = new Set<Rob2Response>(['Y', 'PY']);
const NEG = new Set<Rob2Response>(['N', 'PN']);
const POS_OR_NI = new Set<Rob2Response>(['Y', 'PY', 'NI']);
const NEG_OR_NI = new Set<Rob2Response>(['N', 'PN', 'NI']);

function answer(map: Map<string, Rob2SignalResponse>, id: string): Rob2Response | undefined {
  return map.get(id)?.response;
}

function activeQuestions(domain: Rob2DomainId, map: Map<string, Rob2SignalResponse>): string[] {
  const all = ROB2_QUESTIONS.filter((question) => question.domain === domain).map((question) => question.id);
  if (domain === 'D1' || domain === 'D5') return all;
  if (domain === 'D2') {
    const active = ['2.1', '2.2', '2.6'];
    const q21 = answer(map, '2.1');
    const q22 = answer(map, '2.2');
    if ((q21 && POS_OR_NI.has(q21)) || (q22 && POS_OR_NI.has(q22))) active.push('2.3');
    const q23 = answer(map, '2.3');
    if (q23 && POS.has(q23)) active.push('2.4');
    const q24 = answer(map, '2.4');
    if (q24 && POS_OR_NI.has(q24)) active.push('2.5');
    const q26 = answer(map, '2.6');
    if (q26 && NEG_OR_NI.has(q26)) active.push('2.7');
    return active;
  }
  if (domain === 'D3') {
    const active = ['3.1'];
    const q31 = answer(map, '3.1');
    if (q31 && NEG_OR_NI.has(q31)) active.push('3.2');
    const q32 = answer(map, '3.2');
    if (q32 && NEG.has(q32)) active.push('3.3');
    const q33 = answer(map, '3.3');
    if (q33 && POS_OR_NI.has(q33)) active.push('3.4');
    return active;
  }
  const active = ['4.1', '4.2', '4.3'];
  const q43 = answer(map, '4.3');
  if (q43 && POS_OR_NI.has(q43)) active.push('4.4');
  const q44 = answer(map, '4.4');
  if (q44 && POS_OR_NI.has(q44)) active.push('4.5');
  return active;
}

function validateResponse(response: Rob2SignalResponse, expectedQuestion: Rob2QuestionDefinition): string[] {
  const errors: string[] = [];
  if (response.questionId !== expectedQuestion.id) errors.push(`response id mismatch for ${expectedQuestion.id}`);
  if (!response.rationale.trim()) errors.push(`${expectedQuestion.id} requires a written rationale`);
  if (!['Y', 'PY', 'PN', 'N', 'NI', 'NA'].includes(response.response)) errors.push(`${expectedQuestion.id} has invalid response`);
  if (response.response !== 'NI' && response.response !== 'NA' && response.evidence.length === 0) {
    errors.push(`${expectedQuestion.id} requires evidence for ${response.response}`);
  }
  if (response.confidence !== undefined && (!Number.isFinite(response.confidence) || response.confidence < 0 || response.confidence > 1)) {
    errors.push(`${expectedQuestion.id} confidence must be within [0,1]`);
  }
  return errors;
}

function conservativeD1(map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  const q11 = answer(map, '1.1'); const q12 = answer(map, '1.2'); const q13 = answer(map, '1.3');
  if ((q11 && NEG.has(q11)) || (q12 && NEG.has(q12)) || (q13 && POS.has(q13))) {
    return { judgement: 'high', rationale: ['A high-risk signal indicates a problem with sequence generation, concealment, or baseline evidence of randomization failure.'] };
  }
  if (q11 && POS.has(q11) && q12 && POS.has(q12) && q13 && NEG.has(q13)) {
    return { judgement: 'low', rationale: ['Sequence generation and concealment are supported and baseline differences do not suggest a randomization problem.'] };
  }
  return { judgement: 'some-concerns', rationale: ['Available randomization information is incomplete or does not satisfy the low-risk pattern without a direct high-risk signal.'] };
}

function conservativeD2(map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  const q23 = answer(map, '2.3'); const q24 = answer(map, '2.4'); const q25 = answer(map, '2.5');
  const q26 = answer(map, '2.6'); const q27 = answer(map, '2.7');
  if (q23 && POS.has(q23) && q24 && POS.has(q24) && q25 && NEG_OR_NI.has(q25)) {
    return { judgement: 'high', rationale: ['Trial-context deviations were likely to affect the outcome and were not shown to be balanced.'] };
  }
  if (q26 && NEG_OR_NI.has(q26) && q27 && POS.has(q27)) {
    return { judgement: 'high', rationale: ['The analysis did not adequately estimate the assignment effect and the failure could substantially affect the result.'] };
  }
  const active = activeQuestions('D2', map);
  if (active.some((id) => answer(map, id) === 'NI')) {
    return { judgement: 'some-concerns', rationale: ['No-information responses remain in an active deviations-from-intervention pathway.'] };
  }
  const deviationsSafe = !q23 || NEG.has(q23) || (POS.has(q23) && q24 && NEG.has(q24)) || (POS.has(q23) && q24 && POS.has(q24) && q25 && POS.has(q25));
  const analysisSafe = q26 && POS.has(q26);
  if (deviationsSafe && analysisSafe) {
    return { judgement: 'low', rationale: ['No outcome-relevant unbalanced trial-context deviation is identified and the assignment-effect analysis is appropriate.'] };
  }
  return { judgement: 'some-concerns', rationale: ['A deviations or analysis issue is present but the conservative high-risk trigger is not met.'] };
}

function conservativeD3(map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  const q31 = answer(map, '3.1'); const q32 = answer(map, '3.2'); const q33 = answer(map, '3.3'); const q34 = answer(map, '3.4');
  if (q31 === 'NI') return { judgement: 'high', rationale: ['No information is available about the extent of missing outcome data.'] };
  if (q31 && POS.has(q31)) return { judgement: 'low', rationale: ['Outcome data are available for all or nearly all randomized participants.'] };
  if (q32 && POS.has(q32)) return { judgement: 'low', rationale: ['Evidence supports that missing outcome data did not bias the result.'] };
  if (q33 && NEG.has(q33)) return { judgement: 'low', rationale: ['Missingness is not judged capable of depending on the true outcome value.'] };
  if (q34 && POS.has(q34)) return { judgement: 'high', rationale: ['Missingness is likely to have depended on the true outcome value.'] };
  if (q33 && POS_OR_NI.has(q33)) return { judgement: 'some-concerns', rationale: ['Missingness could depend on the true value, but high-risk likelihood is not established.'] };
  return { judgement: 'some-concerns', rationale: ['Missing-outcome-data information is insufficient for the low-risk pattern.'] };
}

function conservativeD4(map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  const q41 = answer(map, '4.1'); const q42 = answer(map, '4.2'); const q43 = answer(map, '4.3'); const q44 = answer(map, '4.4'); const q45 = answer(map, '4.5');
  if ((q41 && POS.has(q41)) || (q42 && POS.has(q42)) || (q45 && POS.has(q45))) {
    return { judgement: 'high', rationale: ['The outcome method/group ascertainment is problematic or awareness is likely to have influenced outcome assessment.'] };
  }
  if (q41 && NEG.has(q41) && q42 && NEG.has(q42) && q43 && NEG.has(q43)) {
    return { judgement: 'low', rationale: ['Outcome measurement is appropriate/comparable and assessors were not aware of intervention received.'] };
  }
  if (q41 && NEG.has(q41) && q42 && NEG.has(q42) && q44 && NEG.has(q44)) {
    return { judgement: 'low', rationale: ['Outcome measurement is appropriate/comparable and knowledge of intervention could not influence assessment.'] };
  }
  return { judgement: 'some-concerns', rationale: ['Outcome measurement raises potential influence or incomplete information without the conservative high-risk trigger.'] };
}

function conservativeD5(map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  const q51 = answer(map, '5.1'); const q52 = answer(map, '5.2'); const q53 = answer(map, '5.3');
  if ((q52 && POS.has(q52)) || (q53 && POS.has(q53))) {
    return { judgement: 'high', rationale: ['The numerical result is likely to have been selected from multiple eligible measurements or analyses based on the results.'] };
  }
  if (q51 && POS.has(q51) && q52 && NEG.has(q52) && q53 && NEG.has(q53)) {
    return { judgement: 'low', rationale: ['A pre-specified analysis plan is supported and result-based selection from measurements/analyses is not indicated.'] };
  }
  return { judgement: 'some-concerns', rationale: ['Pre-specification or result-selection information is incomplete without a direct high-risk selection signal.'] };
}

function proposedDomain(domain: Rob2DomainId, map: Map<string, Rob2SignalResponse>): { judgement: Rob2Judgement; rationale: string[] } {
  if (domain === 'D1') return conservativeD1(map);
  if (domain === 'D2') return conservativeD2(map);
  if (domain === 'D3') return conservativeD3(map);
  if (domain === 'D4') return conservativeD4(map);
  return conservativeD5(map);
}

function validateOverride(override: Rob2JudgementOverride): void {
  if (!override.actorId.trim()) throw new Error('RoB 2 override requires actorId');
  if (!override.rationale.trim()) throw new Error('RoB 2 override requires rationale');
  if (!Number.isFinite(Date.parse(override.decidedAt))) throw new Error('RoB 2 override requires a valid decidedAt timestamp');
  if (override.from === override.to) throw new Error('RoB 2 override must change the judgement');
}

function overallFrom(judgements: Rob2Judgement[]): Rob2Judgement {
  return judgements.includes('high')
    ? 'high'
    : judgements.every((judgement) => judgement === 'low')
      ? 'low'
      : 'some-concerns';
}

export function assessRob2(input: {
  studyId: string;
  resultId: string;
  outcome: string;
  trialDesign?: Rob2TrialDesign;
  effectOfInterest?: Rob2EffectOfInterest;
  responses: Rob2SignalResponse[];
  overrides?: Rob2JudgementOverride[];
}): Rob2Assessment {
  const trialDesign = input.trialDesign ?? 'individual-parallel';
  const effectOfInterest = input.effectOfInterest ?? 'assignment';
  if (trialDesign !== 'individual-parallel') throw new Error(`RoB 2 trial design ${trialDesign} is not implemented in this engine`);
  if (effectOfInterest !== 'assignment') throw new Error(`RoB 2 effect of interest ${effectOfInterest} is not implemented in this engine`);
  if (!input.studyId.trim() || !input.resultId.trim() || !input.outcome.trim()) throw new Error('RoB 2 assessment requires studyId, resultId and outcome');

  const map = new Map<string, Rob2SignalResponse>();
  for (const response of input.responses) {
    if (map.has(response.questionId)) throw new Error(`Duplicate RoB 2 response ${response.questionId}`);
    const definition = ROB2_QUESTIONS.find((question) => question.id === response.questionId);
    if (!definition) throw new Error(`Unknown RoB 2 question ${response.questionId}`);
    map.set(response.questionId, structuredClone(response));
  }

  const allActive = new Set<string>();
  for (const domain of ['D1', 'D2', 'D3', 'D4', 'D5'] as const) {
    for (const questionId of activeQuestions(domain, map)) allActive.add(questionId);
  }

  const domains: Rob2DomainAssessment[] = (['D1', 'D2', 'D3', 'D4', 'D5'] as const).map((domain) => {
    const activeQuestionIds = activeQuestions(domain, map);
    const domainResponses = activeQuestionIds.flatMap((questionId) => {
      const response = map.get(questionId);
      return response ? [response] : [];
    });
    const inactiveResponseQuestionIds = ROB2_QUESTIONS
      .filter((question) => question.domain === domain && !activeQuestionIds.includes(question.id))
      .flatMap((question) => {
        const response = map.get(question.id);
        return response && response.response !== 'NA' ? [question.id] : [];
      });
    const unsupportedQuestionIds: string[] = [];
    for (const questionId of activeQuestionIds) {
      const definition = ROB2_QUESTIONS.find((question) => question.id === questionId)!;
      const response = map.get(questionId);
      if (!response) {
        unsupportedQuestionIds.push(questionId);
        continue;
      }
      const errors = validateResponse(response, definition);
      if (errors.length) unsupportedQuestionIds.push(...errors.map((error) => `${questionId}:${error}`));
    }
    for (const questionId of inactiveResponseQuestionIds) {
      unsupportedQuestionIds.push(`${questionId}:substantive response supplied to inactive conditional question`);
    }
    const algorithm = proposedDomain(domain, map);
    return {
      domain,
      title: DOMAIN_TITLES[domain],
      activeQuestionIds,
      responses: domainResponses,
      algorithmJudgement: algorithm.judgement,
      proposedJudgement: algorithm.judgement,
      finalJudgement: algorithm.judgement,
      rationale: algorithm.rationale,
      finalRationale: [...algorithm.rationale],
      complete: unsupportedQuestionIds.length === 0,
      unsupportedQuestionIds,
      inactiveResponseQuestionIds,
    };
  });

  const overrides = (input.overrides ?? []).map((override) => {
    validateOverride(override);
    return structuredClone(override);
  });
  const seenOverrideScopes = new Set<string>();
  for (const override of overrides) {
    if (seenOverrideScopes.has(override.scope)) throw new Error(`Duplicate RoB 2 override scope ${override.scope}`);
    seenOverrideScopes.add(override.scope);
  }

  for (const override of overrides.filter((candidate) => candidate.scope !== 'overall')) {
    const domain = domains.find((candidate) => candidate.domain === override.scope);
    if (!domain) throw new Error(`RoB 2 override scope ${override.scope} is unavailable`);
    if (domain.algorithmJudgement !== override.from) {
      throw new Error(`RoB 2 override ${override.scope} from judgement does not match algorithm judgement`);
    }
    domain.finalJudgement = override.to;
    domain.finalRationale = [...domain.rationale, `Override by ${override.actorId}: ${override.rationale}`];
  }

  const algorithmDomainJudgements = domains.map((domain) => domain.algorithmJudgement);
  const finalDomainJudgements = domains.map((domain) => domain.finalJudgement);
  const algorithmOverall = overallFrom(algorithmDomainJudgements);
  const proposedOverall = algorithmOverall;
  const domainAdjustedOverall = overallFrom(finalDomainJudgements);
  const overallOverride = overrides.find((candidate) => candidate.scope === 'overall');
  if (overallOverride && overallOverride.from !== domainAdjustedOverall) {
    throw new Error('RoB 2 overall override from judgement does not match domain-adjusted overall judgement');
  }
  const finalOverall = overallOverride?.to ?? domainAdjustedOverall;
  const someCount = finalDomainJudgements.filter((judgement) => judgement === 'some-concerns').length;
  const complete = domains.every((domain) => domain.complete);
  const authority: Rob2AlgorithmAuthority = {
    tool: 'RoB 2',
    toolVersion: '2019-08-22',
    trialDesign,
    effectOfInterest,
    implementation: 'MEDANTIR-ROB2-ASSIGNMENT-CONSERVATIVE-1',
    signallingStructureAuthority: 'official-rob2-2019',
    exactExcelAlgorithmParity: 'pending',
    productionCertificationBlockedOnExactParity: true,
  };
  const hashable = {
    version: 1 as const,
    studyId: input.studyId,
    resultId: input.resultId,
    outcome: input.outcome,
    trialDesign,
    effectOfInterest,
    domains,
    algorithmOverall,
    proposedOverall,
    domainAdjustedOverall,
    finalOverall,
    overrides,
    multipleSomeConcernsEscalation: someCount >= 2 && !finalDomainJudgements.includes('high'),
    complete,
    authority,
  };
  return {
    ...hashable,
    assessmentId: `rob2-${stableHash({ studyId: input.studyId, resultId: input.resultId, outcome: input.outcome }).slice(0, 24)}`,
    assessmentHash: stableHash(hashable),
  };
}
