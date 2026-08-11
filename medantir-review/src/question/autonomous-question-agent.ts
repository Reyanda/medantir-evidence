import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import {
  compileReviewSpec,
  createProtocolAmendments,
  validateClarificationResolution,
  type ClarificationIssue,
  type ClarificationResolution,
  type ProtocolAmendment,
  type ReviewSpec,
} from './review-spec.js';

export interface ClarificationResolutionLedger {
  version: 1;
  resolutions: ClarificationResolution[];
}

export interface ClarificationRequestArtifact {
  version: 1;
  status: 'needs-clarification';
  issue: ClarificationIssue;
  remainingMaterialIssues: number;
  reviewSpecHash: string;
}

function resolutionLedger(context: AgentContext): ClarificationResolutionLedger {
  const candidate = context.state.artifacts.clarificationResolutionLedger as ClarificationResolutionLedger | undefined;
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.resolutions)) {
    return { version: 1, resolutions: [] };
  }
  return candidate;
}

function validateLedgerAgainstActiveIssues(
  context: AgentContext,
  ledger: ClarificationResolutionLedger,
): void {
  if (ledger.resolutions.length === 0) return;
  const baseline = compileReviewSpec(context.state.request, {
    resolutions: [],
    now: context.now(),
  });
  const byId = new Map(baseline.issues.map((issue) => [issue.id, issue]));
  const seen = new Set<string>();
  for (const resolution of ledger.resolutions) {
    if (seen.has(resolution.issueId)) throw new Error(`Clarification ledger contains duplicate issueId ${resolution.issueId}`);
    seen.add(resolution.issueId);
    const active = byId.get(resolution.issueId);
    if (!active) {
      throw new Error(`Clarification resolution ${resolution.issueId} does not correspond to a baseline material ambiguity`);
    }
    validateClarificationResolution(active, resolution);
  }
}

function mergeAmendments(
  existing: ProtocolAmendment[] | undefined,
  added: ProtocolAmendment[],
): ProtocolAmendment[] {
  const byId = new Map<string, ProtocolAmendment>();
  for (const amendment of existing ?? []) byId.set(amendment.id, amendment);
  for (const amendment of added) byId.set(amendment.id, amendment);
  return [...byId.values()];
}

/**
 * Production question-stage wrapper.
 *
 * The wrapped legacy QuestionAgent still owns basic question normalization. This
 * agent adds the autonomous safety contract: build a typed ReviewSpec, distinguish
 * broadening/reversible defaults from material unknowns, and stop before protocol
 * development when a consequential field is unresolved.
 *
 * Clarification answers are deliberately supplied through an attributable
 * `clarificationResolutionLedger` artifact. They are never inferred from free-form
 * model output and never mutate the original ReviewRequest silently. Every ledger
 * entry is revalidated against the deterministic baseline ambiguity set before it
 * can alter the compiled specification.
 */
export class AutonomousQuestionAgent implements Agent {
  readonly stage = 'question' as const;

  constructor(private readonly base: Agent) {
    if (base.stage !== 'question') throw new Error('AutonomousQuestionAgent requires a question-stage base agent');
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const baseResult = await this.base.execute(context);
    const ledger = resolutionLedger(context);
    validateLedgerAgainstActiveIssues(context, ledger);
    const previousSpec = context.state.artifacts.reviewSpec as ReviewSpec | undefined;
    const compilation = compileReviewSpec(context.state.request, {
      resolutions: ledger.resolutions,
      now: context.now(),
    });

    const amendments = previousSpec
      ? createProtocolAmendments(previousSpec, compilation.spec, ledger.resolutions)
      : [];
    const existingAmendments = context.state.artifacts.protocolAmendments as ProtocolAmendment[] | undefined;

    const artifacts: Record<string, unknown> = {
      ...baseResult.artifacts,
      reviewSpec: compilation.spec,
      reviewSpecCompilation: {
        status: compilation.status,
        reviewSpecHash: compilation.spec.hash,
        safeDefaults: compilation.safeDefaults,
        unresolvedMaterialFields: compilation.unresolvedMaterialFields,
      },
      clarificationIssues: compilation.issues,
      clarificationResolutionLedger: ledger,
      protocolAmendments: mergeAmendments(existingAmendments, amendments),
    };

    if (compilation.status === 'needs-clarification') {
      const first = compilation.issues[0];
      if (!first) throw new Error('ReviewSpec compiler reported needs-clarification without an issue');
      const request: ClarificationRequestArtifact = {
        version: 1,
        status: 'needs-clarification',
        issue: first,
        remainingMaterialIssues: compilation.issues.length,
        reviewSpecHash: compilation.spec.hash,
      };
      artifacts.clarificationRequest = request;
      return {
        artifacts,
        warnings: [
          ...(baseResult.warnings ?? []),
          `Autonomous review intake stopped before protocol development: ${compilation.issues.length} material ambiguity issue(s) remain.`,
        ],
        awaitingHuman: {
          summary: first.question,
        },
      };
    }

    artifacts.clarificationRequest = {
      version: 1,
      status: 'resolved',
      remainingMaterialIssues: 0,
      reviewSpecHash: compilation.spec.hash,
    };
    return {
      ...baseResult,
      artifacts,
      warnings: [
        ...(baseResult.warnings ?? []),
        ...(compilation.safeDefaults.length
          ? [`ReviewSpec used ${compilation.safeDefaults.length} documented reversible broadening default(s); none narrows eligibility silently.`]
          : []),
      ],
    };
  }
}
