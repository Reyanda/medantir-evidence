import type { EstimandLedgerRow, EstimandSynthesisConflict } from '../agents/estimand-identity.js';
import { DocumentAwareReviewAttentionObserver } from './document-aware-attention.js';
import type {
  CognitiveAction,
  CognitiveStageDecision,
  CognitiveStageInput,
} from './review-attention.js';

const VERIFY_OR_STRONGER = new Set<CognitiveAction>([
  'VERIFY',
  'ESCALATE_HUMAN',
  'ROLLBACK',
  'STOP',
]);

function atLeastVerify(action: CognitiveAction): CognitiveAction {
  return VERIFY_OR_STRONGER.has(action) ? action : 'VERIFY';
}

/**
 * Extends document/family cognitive control with canonical estimand debt.
 * Unresolved scientific target dimensions never disappear just because
 * interactive human verification is disabled for a run.
 */
export class EstimandAwareReviewAttentionObserver extends DocumentAwareReviewAttentionObserver {
  override assess(input: CognitiveStageInput): CognitiveStageDecision {
    const decision = super.assess(input);
    if (!['extract', 'risk-of-bias', 'synthesise', 'grade', 'report', 'human-verify'].includes(input.stage)) {
      return decision;
    }

    const reasons = [...decision.reasons];
    let action = decision.action;
    let methodDrift = decision.metrics.methodDrift;
    let score = decision.score;

    const ledger = Array.isArray(input.state.artifacts.estimandLedger)
      ? input.state.artifacts.estimandLedger as EstimandLedgerRow[]
      : [];
    const unresolved = ledger.filter((row) =>
      row.status === 'identified'
      && Boolean(row.estimand)
      && (row.estimand?.unresolvedDimensions.length ?? 0) > 0);
    if (unresolved.length > 0) {
      action = atLeastVerify(action);
      methodDrift = Math.max(methodDrift, Math.min(0.85, unresolved.length / Math.max(1, ledger.length)));
      const dimensions = [...new Set(unresolved.flatMap((row) => row.estimand?.unresolvedDimensions ?? []))].sort();
      reasons.push(
        `${unresolved.length} provenance-valid numerical estimand(s) retain unresolved target dimensions (${dimensions.join(', ')}); unknown estimand identity remains VERIFY debt`,
      );
    }

    const adjudications = Array.isArray(input.state.artifacts.estimandHumanAdjudications)
      ? input.state.artifacts.estimandHumanAdjudications as unknown[]
      : [];
    if (adjudications.length > 0) {
      reasons.push(`${adjudications.length} human estimand amendment(s) were replayed from extraction before downstream synthesis`);
    }

    const conflicts = Array.isArray(input.state.artifacts.estimandSynthesisConflicts)
      ? input.state.artifacts.estimandSynthesisConflicts as EstimandSynthesisConflict[]
      : [];
    const verificationDebt = Array.isArray(input.state.artifacts.estimandVerificationDebt)
      ? input.state.artifacts.estimandVerificationDebt as EstimandSynthesisConflict[]
      : [];
    if (conflicts.length > 0 || verificationDebt.length > 0) {
      action = atLeastVerify(action);
      methodDrift = Math.max(methodDrift, Math.min(1, (conflicts.length + verificationDebt.length) / 3));
      if (conflicts.length > 0) reasons.push(`${conflicts.length} estimand compatibility/dependence conflict(s) prevent ordinary pooling`);
      if (verificationDebt.length > 0) reasons.push(`${verificationDebt.length} cross-study estimand comparison(s) remain unresolved and require verification before stronger compatibility claims`);
    }

    score = Math.max(score, methodDrift / 3);
    return {
      ...decision,
      action,
      score: Math.min(1, score),
      reasons: [...new Set(reasons)],
      metrics: {
        ...decision.metrics,
        methodDrift,
      },
    };
  }
}
