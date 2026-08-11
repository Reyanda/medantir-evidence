import type {
  SrModelTaskResponse,
  SrModelVisibleTask,
  SrReviewModelPort,
} from './sr-reproduction-benchmark.js';

/**
 * Defense-in-depth model boundary. SrReviewModelPort is already typed to the
 * gold-free SrModelVisibleTask; this wrapper additionally deep-copies the task
 * so custom adapters cannot mutate benchmark-owned inputs/upstream artifacts.
 */
export class GoldSealedSrReviewModelPort implements SrReviewModelPort {
  constructor(private readonly inner: SrReviewModelPort) {}

  async completeJson(input: Parameters<SrReviewModelPort['completeJson']>[0]): Promise<SrModelTaskResponse> {
    const task: SrModelVisibleTask = {
      id: input.task.id,
      stage: input.task.stage,
      instruction: input.task.instruction,
      input: structuredClone(input.task.input),
      ...(input.task.outputSchema !== undefined ? { outputSchema: structuredClone(input.task.outputSchema) } : {}),
      upstream: input.task.upstream.map((item) => ({
        taskId: item.taskId,
        stage: item.stage,
        output: structuredClone(item.output),
        outputHash: item.outputHash,
      })),
    };
    return this.inner.completeJson({
      model: input.model,
      caseId: input.caseId,
      task,
      system: input.system,
    });
  }
}
