import { scientificHash } from '../core/canonical-hash.js';
import type { WorkflowJobSnapshot, WorkflowRuntimeSnapshot } from './types.js';

export interface ScheduleWorkflowJob<T> {
  runId: string;
  kind: WorkflowJobSnapshot['kind'];
  execute(): Promise<T>;
  onSuccess(result: T): void | Promise<void>;
  onFailure(error: unknown): void | Promise<void>;
  submittedAt?: string;
}

export interface WorkflowRuntimePort {
  isRunning(runId: string): boolean;
  schedule<T>(input: ScheduleWorkflowJob<T>): boolean;
  snapshot(generatedAt?: string): WorkflowRuntimeSnapshot;
}

/**
 * Production baseline scheduler for one service replica.
 *
 * It deliberately does not pretend to be a distributed queue. It provides one
 * explicit runtime contract, duplicate-run exclusion, observable job state, and
 * a future replacement seam for Temporal/Dagster/Prefect/Airflow backends.
 */
export class SingleReplicaWorkflowRuntime implements WorkflowRuntimePort {
  private readonly jobs = new Map<string, WorkflowJobSnapshot>();
  private readonly activeRunIds = new Set<string>();
  private sequence = 0;

  isRunning(runId: string): boolean {
    return this.activeRunIds.has(runId);
  }

  schedule<T>(input: ScheduleWorkflowJob<T>): boolean {
    const runId = input.runId.trim();
    if (!runId) throw new Error('Workflow job runId is required.');
    if (this.activeRunIds.has(runId)) return false;
    const submittedAt = input.submittedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(submittedAt))) throw new Error('Workflow job submittedAt must be a valid timestamp.');
    this.sequence += 1;
    const jobId = `job-${scientificHash({ runId, kind: input.kind, submittedAt, sequence: this.sequence }).slice(0, 40)}`;
    const job: WorkflowJobSnapshot = {
      jobId,
      runId,
      kind: input.kind,
      status: 'queued',
      submittedAt,
    };
    this.jobs.set(jobId, job);
    this.activeRunIds.add(runId);

    void Promise.resolve().then(async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      try {
        const result = await input.execute();
        await input.onSuccess(result);
        job.status = 'succeeded';
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        try {
          await input.onFailure(error);
        } catch (callbackError) {
          job.error = `${job.error}; failure callback: ${callbackError instanceof Error ? callbackError.message : String(callbackError)}`;
        }
      } finally {
        job.completedAt = new Date().toISOString();
        this.activeRunIds.delete(runId);
      }
    });
    return true;
  }

  snapshot(generatedAt = new Date().toISOString()): WorkflowRuntimeSnapshot {
    const jobs = [...this.jobs.values()]
      .map((job) => structuredClone(job))
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.jobId.localeCompare(b.jobId));
    return {
      schemaVersion: 'medantir-workflow-runtime/1',
      backend: 'in-process-durable',
      mode: 'single-replica',
      generatedAt,
      queued: jobs.filter((job) => job.status === 'queued').length,
      running: jobs.filter((job) => job.status === 'running').length,
      succeeded: jobs.filter((job) => job.status === 'succeeded').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      jobs,
    };
  }
}
