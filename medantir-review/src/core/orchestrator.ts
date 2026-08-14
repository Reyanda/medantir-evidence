import type { Agent, AgentContext, PipelineState, StageName, ValidationIssue } from './types.js';
import type { HumanDecisionPort, PipelineCheckpointPort } from './ports.js';
import type { ReviewProtocol } from '../protocols/review-protocol.js';
import type { CognitiveStageDecision, CognitiveStageObserver } from '../cognitive/review-attention.js';
import { id, nowIso, stableHash } from './utils.js';
import {
  isScientificRunControlArtifact,
  recordScientificStageAttempt,
  refreshScientificRunArtifacts,
  snapshotScientificArtifactHashes,
  type ScientificRunLedger,
} from './scientific-run-manifest.js';

export interface OrchestratorOptions {
  humanDecisionPort?: HumanDecisionPort;
  cognitiveObserver?: CognitiveStageObserver;
  maxCognitiveRollbacks?: number;
  checkpointPort?: PipelineCheckpointPort;
}

export class PipelineCheckpointError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PipelineCheckpointError';
  }
}

interface CognitiveControlArtifact {
  version: 1;
  records: CognitiveStageDecision[];
  latest: CognitiveStageDecision;
}

interface ExternalActionReconciliationErrorShape {
  code?: unknown;
  actionId?: unknown;
  message?: unknown;
}

const PERSISTENT_REWORK_ARTIFACTS = new Set([
  'humanOverrides',
  'studyFamilyVerificationAcknowledgements',
  'estimandVerificationAcknowledgements',
  'cognitiveControl',
]);

export class PipelineOrchestrator {
  private readonly agents = new Map<StageName, Agent>();

  constructor(
    agents: Agent[],
    private readonly options: OrchestratorOptions = {},
  ) {
    for (const agent of agents) {
      if (this.agents.has(agent.stage)) throw new Error(`Duplicate agent for stage ${agent.stage}`);
      this.agents.set(agent.stage, agent);
    }
  }

  async run(state: PipelineState, protocol: ReviewProtocol): Promise<PipelineState> {
    let stageIndex = 0;
    let reworkCycles = 0;
    let cognitiveRollbacks = 0;

    while (stageIndex < protocol.stages.length) {
      const stageProtocol = protocol.stages[stageIndex];
      if (!stageProtocol) break;
      const stage = state.stages[stageProtocol.stage];
      if (stage.status === 'passed' || stage.status === 'skipped') {
        stageIndex += 1;
        continue;
      }

      const missing = stageProtocol.requiredArtifacts.filter((key) => !(key in state.artifacts));
      if (missing.length > 0) {
        stage.status = 'failed';
        stage.errors.push(`Missing required artifacts: ${missing.join(', ')}`);
        state.updatedAt = nowIso();
        this.audit(state, stageProtocol.stage, 'precondition-failed', stage.attempts, { missing });
        refreshScientificRunArtifacts(state, protocol);
        try { await this.checkpoint(state, stageProtocol.stage, 'precondition-failed', stage.attempts); }
        catch (error) { stage.errors.push(error instanceof Error ? error.message : String(error)); }
        break;
      }

      const agent = this.agents.get(stageProtocol.stage);
      if (!agent) throw new Error(`No agent registered for ${stageProtocol.stage}`);

      let completed = false;
      while (!completed && stage.attempts <= stageProtocol.maxRetries) {
        stage.attempts += 1;
        stage.status = 'running';
        stage.startedAt = nowIso();
        state.updatedAt = stage.startedAt;
        const scientificBefore = snapshotScientificArtifactHashes(state.artifacts);
        let validationIssues: ValidationIssue[] = [];
        let cognitiveAction: string | undefined;
        this.audit(state, stageProtocol.stage, 'started', stage.attempts, {
          inputHash: stableHash(stageProtocol.requiredArtifacts.map((key) => state.artifacts[key])),
        });
        try {
          await this.checkpoint(state, stageProtocol.stage, 'started', stage.attempts);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stage.status = 'failed';
          stage.completedAt = nowIso();
          state.updatedAt = stage.completedAt;
          stage.errors.push(message);
          return state;
        }

        try {
          const context: AgentContext = { state, now: nowIso };
          const result = await agent.execute(context);
          Object.assign(state.artifacts, result.artifacts);

          if (result.awaitingHuman) {
            stage.status = 'awaiting-human';
            delete stage.completedAt;
            state.updatedAt = nowIso();
            this.audit(state, stageProtocol.stage, 'awaiting-human-evidence-review', stage.attempts, {
              summary: result.awaitingHuman.summary,
              outputHash: stableHash(stageProtocol.producedArtifacts.map((key) => state.artifacts[key])),
            });
            recordScientificStageAttempt(state, {
              stage: stageProtocol.stage,
              attempt: stage.attempts,
              status: 'awaiting-human',
              requiredArtifacts: stageProtocol.requiredArtifacts,
              before: scientificBefore,
              warnings: result.warnings,
              recordedAt: state.updatedAt,
            });
            refreshScientificRunArtifacts(state, protocol);
            await this.checkpoint(state, stageProtocol.stage, 'awaiting-human-evidence-review', stage.attempts);
            return state;
          }

          if (result.rework) {
            reworkCycles += 1;
            if (reworkCycles > 5) throw new Error('Maximum human-adjudication rework cycles exceeded');
            this.audit(state, stageProtocol.stage, 'human-rework-requested', stage.attempts, {
              fromStage: result.rework.fromStage,
              reason: result.rework.reason,
            });
            recordScientificStageAttempt(state, {
              stage: stageProtocol.stage,
              attempt: stage.attempts,
              status: 'rework',
              requiredArtifacts: stageProtocol.requiredArtifacts,
              before: scientificBefore,
              warnings: result.warnings,
              reworkFrom: result.rework.fromStage,
              recordedAt: nowIso(),
            });
            stageIndex = this.resetFrom(state, protocol, result.rework.fromStage);
            refreshScientificRunArtifacts(state, protocol);
            await this.checkpoint(state, stageProtocol.stage, 'human-rework-requested', stage.attempts);
            completed = true;
            continue;
          }

          const validation = stageProtocol.validate(state);
          validationIssues = validation.issues;
          const warnings = [
            ...(result.warnings ?? []),
            ...validation.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
          ];
          if (!validation.ok) throw new Error(validation.issues.map((issue) => issue.message).join('; '));

          const cognitiveDecision = this.options.cognitiveObserver
            ? await this.options.cognitiveObserver.assess({
                state,
                stage: stageProtocol.stage,
                attempt: stage.attempts,
                result,
                validation,
                warnings,
                requiredArtifacts: stageProtocol.requiredArtifacts,
                producedArtifacts: stageProtocol.producedArtifacts,
              })
            : undefined;

          if (cognitiveDecision) {
            cognitiveAction = cognitiveDecision.action;
            this.recordCognitiveDecision(state, cognitiveDecision);
            this.audit(state, stageProtocol.stage, 'cognitive-attention', stage.attempts, {
              action: cognitiveDecision.action,
              score: cognitiveDecision.score,
              reasons: cognitiveDecision.reasons,
              metrics: cognitiveDecision.metrics,
            });

            if (cognitiveDecision.action === 'STOP') {
              throw new Error(`Cognitive control stopped ${stageProtocol.stage}: ${cognitiveDecision.reasons.join('; ') || 'risk threshold exceeded'}`);
            }

            if (cognitiveDecision.action === 'ROLLBACK') {
              cognitiveRollbacks += 1;
              const maxRollbacks = this.options.maxCognitiveRollbacks ?? 3;
              if (cognitiveRollbacks > maxRollbacks) {
                throw new Error(`Maximum cognitive rollback cycles exceeded (${maxRollbacks})`);
              }
              const rollbackFrom = cognitiveDecision.rollbackFrom ?? stageProtocol.stage;
              this.audit(state, stageProtocol.stage, 'cognitive-rollback', stage.attempts, {
                fromStage: rollbackFrom,
                reasons: cognitiveDecision.reasons,
              });
              recordScientificStageAttempt(state, {
                stage: stageProtocol.stage,
                attempt: stage.attempts,
                status: 'rolled-back',
                requiredArtifacts: stageProtocol.requiredArtifacts,
                before: scientificBefore,
                warnings,
                validationIssues,
                cognitiveAction: cognitiveDecision.action,
                reworkFrom: rollbackFrom,
                recordedAt: nowIso(),
              });
              stageIndex = this.resetFrom(state, protocol, rollbackFrom);
              refreshScientificRunArtifacts(state, protocol);
              await this.checkpoint(state, stageProtocol.stage, 'cognitive-rollback', stage.attempts);
              completed = true;
              continue;
            }

            if (cognitiveDecision.action !== 'CONTINUE') {
              warnings.push(`Cognitive control: ${cognitiveDecision.action}${cognitiveDecision.reasons.length ? ` — ${cognitiveDecision.reasons.join('; ')}` : ''}`);
            }
          }

          const cognitiveHumanGate = cognitiveDecision?.action === 'ESCALATE_HUMAN';
          const needsHuman =
            cognitiveHumanGate ||
            stageProtocol.humanGate === 'always' ||
            (stageProtocol.humanGate === 'on-warning' && warnings.length > 0);

          if (needsHuman && !state.request.autoApproveHumanGates) {
            const approved = this.options.humanDecisionPort
              ? await this.options.humanDecisionPort.approve({
                  runId: state.runId,
                  stage: stageProtocol.stage,
                  summary: warnings.join('; ') || 'Methodological approval required',
                })
              : false;
            if (!approved) {
              stage.status = 'awaiting-human';
              state.updatedAt = nowIso();
              const gateEvent = cognitiveHumanGate ? 'cognitive-human-gate' : 'human-gate';
              this.audit(state, stageProtocol.stage, gateEvent, stage.attempts, { warnings });
              recordScientificStageAttempt(state, {
                stage: stageProtocol.stage,
                attempt: stage.attempts,
                status: 'awaiting-human',
                requiredArtifacts: stageProtocol.requiredArtifacts,
                before: scientificBefore,
                warnings,
                validationIssues,
                ...(cognitiveDecision ? { cognitiveAction: cognitiveDecision.action } : {}),
                recordedAt: state.updatedAt,
              });
              refreshScientificRunArtifacts(state, protocol);
              await this.checkpoint(state, stageProtocol.stage, gateEvent, stage.attempts);
              return state;
            }
          }

          stage.status = 'passed';
          stage.completedAt = nowIso();
          state.updatedAt = stage.completedAt;
          this.audit(state, stageProtocol.stage, 'passed', stage.attempts, {
            outputHash: stableHash(stageProtocol.producedArtifacts.map((key) => state.artifacts[key])),
            warnings,
            cognitiveAction: cognitiveDecision?.action ?? 'DISABLED',
          });
          recordScientificStageAttempt(state, {
            stage: stageProtocol.stage,
            attempt: stage.attempts,
            status: 'passed',
            requiredArtifacts: stageProtocol.requiredArtifacts,
            before: scientificBefore,
            warnings,
            validationIssues,
            ...(cognitiveDecision ? { cognitiveAction: cognitiveDecision.action } : {}),
            recordedAt: stage.completedAt,
          });
          refreshScientificRunArtifacts(state, protocol);
          await this.checkpoint(state, stageProtocol.stage, 'passed', stage.attempts);
          completed = true;
          stageIndex += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof PipelineCheckpointError) {
            stage.errors.push(message);
            stage.status = 'failed';
            stage.completedAt = nowIso();
            state.updatedAt = stage.completedAt;
            return state;
          }

          const reconciliation = error as ExternalActionReconciliationErrorShape;
          if (reconciliation.code === 'EXTERNAL_ACTION_RECONCILIATION_REQUIRED') {
            stage.status = 'awaiting-human';
            delete stage.completedAt;
            state.updatedAt = nowIso();
            const actionId = typeof reconciliation.actionId === 'string' ? reconciliation.actionId : 'unknown';
            state.artifacts.externalActionReconciliationRequired = {
              version: 1,
              actionId,
              stage: stageProtocol.stage,
              message,
              recordedAt: state.updatedAt,
            };
            this.audit(state, stageProtocol.stage, 'external-action-reconciliation-required', stage.attempts, {
              actionId,
              message,
            });
            recordScientificStageAttempt(state, {
              stage: stageProtocol.stage,
              attempt: stage.attempts,
              status: 'awaiting-human',
              requiredArtifacts: stageProtocol.requiredArtifacts,
              before: scientificBefore,
              warnings: [message],
              validationIssues,
              recordedAt: state.updatedAt,
            });
            refreshScientificRunArtifacts(state, protocol);
            await this.checkpoint(state, stageProtocol.stage, 'external-action-reconciliation-required', stage.attempts);
            return state;
          }

          stage.errors.push(message);
          this.audit(state, stageProtocol.stage, 'attempt-failed', stage.attempts, { error: message });
          recordScientificStageAttempt(state, {
            stage: stageProtocol.stage,
            attempt: stage.attempts,
            status: cognitiveAction === 'STOP' ? 'stopped' : 'failed',
            requiredArtifacts: stageProtocol.requiredArtifacts,
            before: scientificBefore,
            warnings: [message],
            validationIssues,
            ...(cognitiveAction ? { cognitiveAction } : {}),
            recordedAt: nowIso(),
          });
          refreshScientificRunArtifacts(state, protocol);
          try { await this.checkpoint(state, stageProtocol.stage, 'attempt-failed', stage.attempts); }
          catch (checkpointError) {
            stage.errors.push(checkpointError instanceof Error ? checkpointError.message : String(checkpointError));
            stage.status = 'failed';
            stage.completedAt = nowIso();
            state.updatedAt = stage.completedAt;
            return state;
          }
          if (stage.attempts > stageProtocol.maxRetries) {
            stage.status = 'failed';
            stage.completedAt = nowIso();
            state.updatedAt = stage.completedAt;
            refreshScientificRunArtifacts(state, protocol);
            try { await this.checkpoint(state, stageProtocol.stage, 'failed', stage.attempts); }
            catch (checkpointError) { stage.errors.push(checkpointError instanceof Error ? checkpointError.message : String(checkpointError)); }
            return state;
          }
        }
      }
    }

    refreshScientificRunArtifacts(state, protocol);
    return state;
  }

  private async checkpoint(state: PipelineState, stage: StageName, event: string, attempt: number): Promise<void> {
    const port = this.options.checkpointPort;
    if (!port) return;
    const recordedAt = state.audit.at(-1)?.timestamp ?? state.updatedAt ?? nowIso();
    try {
      await port.checkpoint({ state: structuredClone(state), stage, event, attempt, recordedAt });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new PipelineCheckpointError(`Durable checkpoint failed for ${stage}/${event}: ${detail}`, { cause });
    }
  }

  private recordCognitiveDecision(state: PipelineState, decision: CognitiveStageDecision): void {
    const existing = state.artifacts.cognitiveControl as CognitiveControlArtifact | undefined;
    const records = existing?.records ?? [];
    state.artifacts.cognitiveControl = {
      version: 1,
      records: [...records, decision],
      latest: decision,
    } satisfies CognitiveControlArtifact;
  }

  private resetFrom(state: PipelineState, protocol: ReviewProtocol, fromStage: StageName): number {
    const index = protocol.stages.findIndex((entry) => entry.stage === fromStage);
    if (index < 0) throw new Error(`Cannot rework from omitted stage ${fromStage}`);

    const resetStages = new Set(protocol.stages.slice(index).map((entry) => entry.stage));
    const dynamicallyProduced = new Set<string>();
    const ledger = state.artifacts.scientificRunLedger as ScientificRunLedger | undefined;
    for (const receipt of ledger?.attempts ?? []) {
      if (!resetStages.has(receipt.stage)) continue;
      for (const key of Object.keys(receipt.changedOutputs)) dynamicallyProduced.add(key);
    }

    for (let position = index; position < protocol.stages.length; position += 1) {
      const entry = protocol.stages[position];
      if (!entry) continue;
      for (const artifact of entry.producedArtifacts) {
        if (!PERSISTENT_REWORK_ARTIFACTS.has(artifact)) delete state.artifacts[artifact];
      }
      state.stages[entry.stage] = {
        name: entry.stage,
        status: 'pending',
        attempts: 0,
        errors: [],
      };
    }
    for (const artifact of dynamicallyProduced) {
      if (PERSISTENT_REWORK_ARTIFACTS.has(artifact) || isScientificRunControlArtifact(artifact)) continue;
      delete state.artifacts[artifact];
    }
    state.updatedAt = nowIso();
    return index;
  }

  private audit(
    state: PipelineState,
    stage: StageName,
    event: string,
    attempt: number,
    details: Record<string, unknown>,
  ): void {
    state.audit.push({ id: id(), runId: state.runId, stage, event, timestamp: nowIso(), attempt, details });
  }
}
