import type {
  Agent,
  AgentContext,
  AgentResult,
  EvidenceRecord,
  ScreeningDecision,
} from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type { ModelInferencePort, ModelInferenceResult } from './model-inference.js';

export interface ShadowScreeningSuggestion {
  recordId: string;
  authoritativeDecision?: ScreeningDecision['decision'];
  status: 'completed' | 'invalid-output' | 'inference-error';
  suggestedDecision?: ScreeningDecision['decision'];
  confidence?: number;
  rationale?: string;
  requestHash?: string;
  outputHash?: string;
  routingReceipt?: ModelInferenceResult['receipt'];
  error?: string;
}

export interface ShadowScreeningQuality {
  model: string;
  eligibleRecords: number;
  sampledRecords: number;
  completed: number;
  invalidOutputs: number;
  inferenceErrors: number;
  agreementWithAuthoritative: number | null;
  authoritativeDecisionsChanged: false;
}

export interface ShadowScreeningOptions {
  model: string;
  maxRecords?: number;
  concurrency?: number;
  promptVersion?: string;
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  const finite = Number.isFinite(value) ? Number(value) : fallback;
  return Math.max(min, Math.min(max, Math.floor(finite)));
}

function deterministicSample(records: EvidenceRecord[], maxRecords: number): EvidenceRecord[] {
  return [...records]
    .sort((left, right) => stableHash(left.id).localeCompare(stableHash(right.id)))
    .slice(0, maxRecords);
}

function parseSuggestion(text: string): {
  decision: ScreeningDecision['decision'];
  rationale: string;
  confidence?: number;
} | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { decision?: unknown; rationale?: unknown; confidence?: unknown };
    if (!['include', 'exclude', 'uncertain'].includes(String(parsed.decision))) return null;
    if (typeof parsed.rationale !== 'string' || !parsed.rationale.trim()) return null;
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : undefined;
    return {
      decision: parsed.decision as ScreeningDecision['decision'],
      rationale: parsed.rationale.trim(),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  } catch {
    return null;
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await fn(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

/**
 * Non-authoritative model comparison layer for title/abstract screening.
 *
 * The wrapped TiAb agent runs first and remains the only source of
 * `tiabDecisions`/`tiabIncluded`. Model suggestions are written to a separate
 * ledger for benchmarking, disagreement review and provider comparison.
 */
export class ShadowModelTiabScreeningAgent implements Agent {
  readonly stage = 'tiab-screen' as const;
  private readonly maxRecords: number;
  private readonly concurrency: number;
  private readonly promptVersion: string;

  constructor(
    private readonly base: Agent,
    private readonly inference: ModelInferencePort,
    private readonly options: ShadowScreeningOptions,
  ) {
    if (!options.model.trim()) throw new Error('Shadow screening requires a model or routing mode.');
    this.maxRecords = bounded(options.maxRecords, 50, 1, 1000);
    this.concurrency = bounded(options.concurrency, 4, 1, 32);
    this.promptVersion = options.promptVersion ?? 'tiab-shadow-v1';
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const baseResult = await this.base.execute(context);
    const records = Array.isArray(context.state.artifacts.uniqueRecords)
      ? context.state.artifacts.uniqueRecords as EvidenceRecord[]
      : [];
    const decisions = Array.isArray(baseResult.artifacts.tiabDecisions)
      ? baseResult.artifacts.tiabDecisions as ScreeningDecision[]
      : [];
    const decisionById = new Map(decisions.map((decision) => [decision.recordId, decision]));
    const sample = deterministicSample(records, Math.min(this.maxRecords, records.length));
    const q = context.state.request.question;

    const suggestions = await mapConcurrent(sample, this.concurrency, async (record): Promise<ShadowScreeningSuggestion> => {
      const authoritative = decisionById.get(record.id)?.decision;
      try {
        const result = await this.inference.complete({
          taskId: `tiab-shadow:${record.id}`,
          model: this.options.model,
          temperature: 0,
          responseFormat: 'json',
          evidenceObjectIds: [record.id],
          promptVersion: this.promptVersion,
          metadata: { reviewType: context.state.request.reviewType, stage: 'tiab-screen' },
          messages: [
            {
              role: 'system',
              content: [
                'You are a shadow reviewer in a systematic-review benchmark.',
                'Do not invent facts and do not use knowledge outside the supplied title/abstract.',
                'Return one JSON object only: {"decision":"include|exclude|uncertain","confidence":0..1,"rationale":"brief evidence-bound reason"}.',
                'Use uncertain when the title/abstract does not contain enough information to exclude safely.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                `Review objective: ${q.objective}`,
                `Population: ${q.population ?? 'not prespecified'}`,
                `Intervention/exposure: ${q.interventionOrExposure ?? 'not prespecified'}`,
                `Comparator: ${q.comparator ?? 'not prespecified'}`,
                `Outcomes: ${(q.outcomes ?? []).join('; ') || 'not prespecified'}`,
                `Record ID: ${record.id}`,
                `Title: ${record.title}`,
                `Abstract: ${record.abstract || '[no abstract]'}`,
                `Keywords: ${(record.keywords ?? []).join('; ') || '[none]'}`,
              ].join('\n'),
            },
          ],
        });
        const parsed = parseSuggestion(result.text);
        if (!parsed) {
          return {
            recordId: record.id,
            ...(authoritative ? { authoritativeDecision: authoritative } : {}),
            status: 'invalid-output',
            requestHash: result.requestHash,
            outputHash: result.outputHash,
            routingReceipt: result.receipt,
          };
        }
        return {
          recordId: record.id,
          ...(authoritative ? { authoritativeDecision: authoritative } : {}),
          status: 'completed',
          suggestedDecision: parsed.decision,
          rationale: parsed.rationale,
          ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
          requestHash: result.requestHash,
          outputHash: result.outputHash,
          routingReceipt: result.receipt,
        };
      } catch (error) {
        return {
          recordId: record.id,
          ...(authoritative ? { authoritativeDecision: authoritative } : {}),
          status: 'inference-error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const completed = suggestions.filter((item) => item.status === 'completed');
    const comparable = completed.filter((item) => item.authoritativeDecision && item.suggestedDecision);
    const agreements = comparable.filter((item) => item.authoritativeDecision === item.suggestedDecision).length;
    const quality: ShadowScreeningQuality = {
      model: this.options.model,
      eligibleRecords: records.length,
      sampledRecords: sample.length,
      completed: completed.length,
      invalidOutputs: suggestions.filter((item) => item.status === 'invalid-output').length,
      inferenceErrors: suggestions.filter((item) => item.status === 'inference-error').length,
      agreementWithAuthoritative: comparable.length > 0 ? agreements / comparable.length : null,
      authoritativeDecisionsChanged: false,
    };

    return {
      ...baseResult,
      artifacts: {
        ...baseResult.artifacts,
        modelScreeningSuggestions: suggestions,
        modelScreeningQuality: quality,
      },
      warnings: [
        ...(baseResult.warnings ?? []),
        ...(quality.invalidOutputs > 0 ? [`${quality.invalidOutputs} shadow model screening output(s) failed schema validation.`] : []),
        ...(quality.inferenceErrors > 0 ? [`${quality.inferenceErrors} shadow model screening inference call(s) failed; authoritative screening was unaffected.`] : []),
      ],
    };
  }
}
