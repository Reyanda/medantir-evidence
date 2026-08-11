import type { PipelineState, StageName } from '../core/types.js';
import { stableHash } from '../core/utils.js';

export interface RecoveryControlArtifact {
  version: 1;
  recoveredAt: string;
  interruptedStages: StageName[];
  resumedAutomatically: boolean;
  reason: string;
}

/**
 * Convert a crash-interrupted durable state into a safe resumable state.
 *
 * A stage that was `running` consumed one attempt when it started. Process death
 * is not a scientific failure, so that attempt is returned to the retry budget.
 * The stage is reset to pending and all completed upstream artifacts are preserved.
 * External mutation duplication is prevented separately by ExternalActionCoordinator.
 */
export function prepareRecoveredPipelineState(
  input: PipelineState,
  recoveredAt = new Date().toISOString(),
): { state: PipelineState; interruptedStages: StageName[] } {
  const state = structuredClone(input);
  const interruptedStages = (Object.keys(state.stages) as StageName[])
    .filter((stageName) => state.stages[stageName].status === 'running');

  if (interruptedStages.length === 0) return { state, interruptedStages };

  for (const stageName of interruptedStages) {
    const stage = state.stages[stageName];
    const interruptedAttempt = stage.attempts;
    stage.status = 'pending';
    stage.attempts = Math.max(0, stage.attempts - 1);
    delete stage.startedAt;
    delete stage.completedAt;
    state.audit.push({
      id: `recovery-${stableHash({ runId: state.runId, stageName, interruptedAttempt, recoveredAt }).slice(0, 24)}`,
      runId: state.runId,
      stage: stageName,
      event: 'process-interruption-recovered',
      timestamp: recoveredAt,
      attempt: interruptedAttempt,
      details: {
        interruptedAttempt,
        retryBudgetRestored: true,
        externalMutationReplayGuardedByActionLedger: stageName === 'register-protocol',
      },
    });
  }

  state.artifacts.recoveryControl = {
    version: 1,
    recoveredAt,
    interruptedStages,
    resumedAutomatically: false,
    reason: 'Latest hash-verified durable checkpoint contained one or more running stages after process restart.',
  } satisfies RecoveryControlArtifact;
  state.updatedAt = recoveredAt;
  return { state, interruptedStages };
}

export function markRecoveryResumed(state: PipelineState, resumedAt = new Date().toISOString()): PipelineState {
  const control = state.artifacts.recoveryControl as RecoveryControlArtifact | undefined;
  if (!control || control.version !== 1) return state;
  state.artifacts.recoveryControl = {
    ...control,
    resumedAutomatically: true,
    recoveredAt: control.recoveredAt,
  } satisfies RecoveryControlArtifact;
  state.audit.push({
    id: `recovery-resume-${stableHash({ runId: state.runId, resumedAt, interruptedStages: control.interruptedStages }).slice(0, 24)}`,
    runId: state.runId,
    stage: control.interruptedStages[0] ?? 'question',
    event: 'recovered-run-resumed',
    timestamp: resumedAt,
    attempt: 0,
    details: { interruptedStages: control.interruptedStages },
  });
  state.updatedAt = resumedAt;
  return state;
}
