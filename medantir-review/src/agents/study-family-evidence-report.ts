import type { Agent, AgentContext, AgentResult } from '../core/types.js';

/**
 * Final durability wrapper for study-family identity evidence.
 *
 * The ordinary study-family report layer persists family membership and
 * synthesis conflicts. This wrapper separately persists the evidence ledger and
 * human-adjudication receipts so a verifier can reconstruct why each family
 * identity was proposed or amended without re-running the parser.
 */
export class StudyFamilyEvidenceReportAgent implements Agent {
  readonly stage = 'report' as const;

  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const draft = result.artifacts.draftReport as { appendices?: Record<string, unknown> } | undefined;
    if (!draft) return result;

    const links = Array.isArray(context.state.artifacts.studyFamilyLinks)
      ? context.state.artifacts.studyFamilyLinks as Array<{
          recordId?: string;
          linkageBasis?: string;
          humanOverride?: unknown;
        }>
      : [];
    const adjudications = links
      .filter((link) => link.linkageBasis === 'human-adjudicated' && link.humanOverride)
      .map((link) => ({ recordId: link.recordId, receipt: link.humanOverride }));

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        draftReport: {
          ...draft,
          appendices: {
            ...(draft.appendices ?? {}),
            studyFamilyEvidenceLedger: context.state.artifacts.studyFamilyEvidenceLedger ?? [],
            studyFamilyHumanAdjudications: adjudications,
          },
        },
      },
    };
  }
}
