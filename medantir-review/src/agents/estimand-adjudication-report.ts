import type { Agent, AgentContext, AgentResult } from '../core/types.js';

/** Persist replayed estimand amendments separately from machine identity evidence. */
export class EstimandAdjudicationReportAgent implements Agent {
  readonly stage = 'report' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const draft = result.artifacts.draftReport as { appendices?: Record<string, unknown> } | undefined;
    if (!draft) return result;
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        draftReport: {
          ...draft,
          appendices: {
            ...(draft.appendices ?? {}),
            estimandHumanAdjudications: context.state.artifacts.estimandHumanAdjudications ?? [],
          },
        },
      },
    };
  }
}
