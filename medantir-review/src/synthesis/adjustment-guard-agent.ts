import type { Agent, AgentContext, AgentResult, ExtractedStudy, SynthesisResult } from '../core/types.js';
import {
  assessAdjustmentCompatibility,
  createAdjustmentIdentity,
  type AdjustmentCompatibilityReceipt,
  type AdjustmentEquivalenceRule,
  type AdjustmentIdentity,
} from './adjustment-compatibility.js';

type AdjustmentAwareOutcome = ExtractedStudy['outcomes'][number] & {
  adjustmentIdentity?: AdjustmentIdentity;
};

function numericOutcomeGroups(studies: ExtractedStudy[]) {
  const groups = new Map<string, Array<{ studyId: string; adjustment?: AdjustmentIdentity }>>();
  for (const study of studies) {
    for (const raw of study.outcomes) {
      const outcome = raw as AdjustmentAwareOutcome;
      if (typeof outcome.effect !== 'number' || typeof outcome.standardError !== 'number' || !(outcome.standardError > 0)) continue;
      const current = groups.get(outcome.name) ?? [];
      current.push({ studyId: study.studyId, ...(outcome.adjustmentIdentity ? { adjustment: outcome.adjustmentIdentity } : {}) });
      groups.set(outcome.name, current);
    }
  }
  return groups;
}

function unknownIdentity(studyId: string, outcome: string): AdjustmentIdentity {
  return createAdjustmentIdentity({
    status: 'unknown',
    estimand: 'unspecified',
    rationale: `Adjustment status was not extracted for ${studyId}/${outcome}; MEDANTIR refuses to assume the estimate is crude or adjusted.`,
  });
}

/**
 * Blocks quantitative synthesis when crude/adjusted estimand compatibility is
 * unclassified or incompatible.
 *
 * The guard is deliberately conservative. Absence of adjustment metadata is not
 * interpreted as an unadjusted RCT estimate. A later extraction module must mint
 * explicit AdjustmentIdentity objects from source evidence.
 */
export class AdjustmentCompatibilityGuardAgent implements Agent {
  readonly stage = 'synthesise' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    const studies = context.state.artifacts.extractedStudies as ExtractedStudy[] | undefined;
    if (!studies) return result;
    const rules = Array.isArray(context.state.artifacts.adjustmentEquivalenceRules)
      ? context.state.artifacts.adjustmentEquivalenceRules as AdjustmentEquivalenceRule[]
      : [];
    const receipts: AdjustmentCompatibilityReceipt[] = [];
    const conflicts: Array<{ outcome: string; status: string; conflicts: string[]; receiptHash: string }> = [];

    for (const [outcome, rows] of numericOutcomeGroups(studies)) {
      if (rows.length < 2) continue;
      const descriptors = rows.map((row) => ({
        studyId: row.studyId,
        outcome,
        adjustment: row.adjustment ?? unknownIdentity(row.studyId, outcome),
      }));
      const identityHashes = new Set(descriptors.map((row) => row.adjustment.identityHash));
      const matchingRule = rules.find((rule) => {
        const allowed = new Set(rule.allowedIdentityHashes);
        return [...identityHashes].every((identityHash) => allowed.has(identityHash));
      });
      const receipt = assessAdjustmentCompatibility(descriptors, matchingRule);
      receipts.push(receipt);
      if (receipt.status !== 'compatible') {
        conflicts.push({
          outcome,
          status: receipt.status,
          conflicts: [...receipt.conflicts],
          receiptHash: receipt.receiptHash,
        });
      }
    }

    if (conflicts.length === 0) {
      return {
        ...result,
        artifacts: {
          ...result.artifacts,
          adjustmentCompatibilityReceipts: receipts,
          adjustmentSynthesisConflicts: [],
        },
      };
    }

    const base = result.artifacts.synthesis as SynthesisResult | undefined;
    const warningLines = conflicts.flatMap((conflict) => conflict.conflicts.map((message) => `${conflict.outcome}: ${message}`));
    const synthesis: SynthesisResult = {
      mode: base?.mode ?? 'meta-analysis',
      status: 'narrative',
      includedStudies: studies.length,
      narrative: 'Quantitative pooling was withheld because adjustment-set/estimand compatibility is unresolved or incompatible for one or more outcome streams.',
      capabilityWarnings: [...(base?.capabilityWarnings ?? []), ...warningLines],
      ...(base?.evidence ? { evidence: base.evidence } : {}),
    };
    const artifacts = { ...result.artifacts };
    delete artifacts.interventionRandomEffectsAnalyses;
    return {
      ...result,
      artifacts: {
        ...artifacts,
        synthesis,
        adjustmentCompatibilityReceipts: receipts,
        adjustmentSynthesisConflicts: conflicts,
      },
      warnings: [
        ...(result.warnings ?? []),
        ...warningLines,
      ],
    };
  }
}
