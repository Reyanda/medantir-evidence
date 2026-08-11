import { stableHash } from '../core/utils.js';
import type { StageName } from '../core/types.js';

export type ExternalActionReplayPolicy = 'safe-repeat' | 'require-reconciliation';
export type ExternalActionStatus = 'prepared' | 'succeeded' | 'failed' | 'uncertain';

export interface ExternalActionRecord<T = unknown> {
  version: 1;
  actionId: string;
  runId: string;
  stage: StageName;
  kind: string;
  operationKey: string;
  requestHash: string;
  replayPolicy: ExternalActionReplayPolicy;
  status: ExternalActionStatus;
  preparedAt: string;
  updatedAt: string;
  responseHash?: string;
  response?: T;
  error?: string;
}

export interface ExternalActionLedgerPort {
  get<T = unknown>(actionId: string): Promise<ExternalActionRecord<T> | null>;
  prepare(record: ExternalActionRecord): Promise<ExternalActionRecord>;
  succeed<T>(actionId: string, response: T, updatedAt: string): Promise<ExternalActionRecord<T>>;
  fail(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord>;
  markUncertain(actionId: string, error: string, updatedAt: string): Promise<ExternalActionRecord>;
}

export type ExternalActionReconciliation<T> =
  | { status: 'completed'; response: T }
  | { status: 'not-found' }
  | { status: 'uncertain'; reason: string };

export class ExternalActionReconciliationRequiredError extends Error {
  readonly code = 'EXTERNAL_ACTION_RECONCILIATION_REQUIRED';
  constructor(
    public readonly actionId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalActionReconciliationRequiredError';
  }
}

export interface ExternalActionExecution<T> {
  response: T;
  actionId: string;
  reusedReceipt: boolean;
  reconciled: boolean;
}

function actionId(input: {
  runId: string;
  stage: StageName;
  kind: string;
  operationKey: string;
  requestHash: string;
}): string {
  return `ext-${stableHash(input).slice(0, 40)}`;
}

/**
 * Exactly-once boundary for external work.
 *
 * Read-only operations may use `safe-repeat`: if a process dies after dispatch but
 * before the response is durably committed, re-executing the request is allowed.
 * Mutating operations must use `require-reconciliation`: an interrupted dispatch is
 * never repeated merely because MEDANTIR lacks a local receipt. The adapter must
 * reconcile the idempotency key/request identity against the remote system first.
 */
export class ExternalActionCoordinator {
  constructor(private readonly ledger: ExternalActionLedgerPort) {}

  async execute<T>(input: {
    runId: string;
    stage: StageName;
    kind: string;
    operationKey: string;
    request: unknown;
    replayPolicy: ExternalActionReplayPolicy;
    perform(idempotencyKey: string): Promise<T>;
    reconcile?: (idempotencyKey: string) => Promise<ExternalActionReconciliation<T>>;
    now?: () => string;
  }): Promise<ExternalActionExecution<T>> {
    const now = input.now ?? (() => new Date().toISOString());
    const requestHash = stableHash(input.request);
    const id = actionId({
      runId: input.runId,
      stage: input.stage,
      kind: input.kind,
      operationKey: input.operationKey,
      requestHash,
    });

    const existing = await this.ledger.get<T>(id);
    if (existing) {
      if (
        existing.runId !== input.runId ||
        existing.stage !== input.stage ||
        existing.kind !== input.kind ||
        existing.operationKey !== input.operationKey ||
        existing.requestHash !== requestHash ||
        existing.replayPolicy !== input.replayPolicy
      ) {
        throw new Error(`External action identity collision for ${id}`);
      }
      if (existing.status === 'succeeded') {
        return {
          response: structuredClone(existing.response as T),
          actionId: id,
          reusedReceipt: true,
          reconciled: false,
        };
      }

      if (input.replayPolicy === 'require-reconciliation' && (existing.status === 'prepared' || existing.status === 'uncertain')) {
        if (!input.reconcile) {
          throw new ExternalActionReconciliationRequiredError(
            id,
            `External action ${id} may already have been applied; reconciliation is required before replay.`,
          );
        }
        const reconciliation = await input.reconcile(id);
        if (reconciliation.status === 'completed') {
          const completed = await this.ledger.succeed(id, reconciliation.response, now());
          return {
            response: structuredClone(completed.response as T),
            actionId: id,
            reusedReceipt: true,
            reconciled: true,
          };
        }
        if (reconciliation.status === 'uncertain') {
          await this.ledger.markUncertain(id, reconciliation.reason, now());
          throw new ExternalActionReconciliationRequiredError(id, reconciliation.reason);
        }
        // `not-found` proves the remote mutation was not applied, so execution may proceed.
      }
    } else {
      await this.ledger.prepare({
        version: 1,
        actionId: id,
        runId: input.runId,
        stage: input.stage,
        kind: input.kind,
        operationKey: input.operationKey,
        requestHash,
        replayPolicy: input.replayPolicy,
        status: 'prepared',
        preparedAt: now(),
        updatedAt: now(),
      });
    }

    try {
      const response = await input.perform(id);
      const completed = await this.ledger.succeed(id, response, now());
      return {
        response: structuredClone(completed.response as T),
        actionId: id,
        reusedReceipt: false,
        reconciled: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (input.replayPolicy === 'require-reconciliation') {
        await this.ledger.markUncertain(id, message, now());
      } else {
        await this.ledger.fail(id, message, now());
      }
      throw error;
    }
  }
}
