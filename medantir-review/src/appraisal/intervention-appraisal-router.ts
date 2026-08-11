import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import type { ReviewSpec } from '../question/review-spec.js';
import { Rob2AppraisalAgent } from './rob2-agent.js';

function normalizedDesign(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRandomizedDesign(value: string): boolean {
  const design = normalizedDesign(value);
  return /\brandomi[sz](?:ed|ation)?\b/.test(design) || /\brct\b/.test(design);
}

/**
 * Intervention appraisal capability router.
 *
 * The first production-certified vertical supports RoB 2 only for individually
 * randomized parallel-group evidence targeting assignment to intervention.
 * Non-randomized intervention evidence is not sent through the legacy generic
 * appraisal and is not labelled ROBINS-I until a true ROBINS-I engine exists.
 */
export class InterventionAppraisalRouterAgent implements Agent {
  readonly stage = 'risk-of-bias' as const;

  constructor(private readonly rob2: Rob2AppraisalAgent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const spec = context.state.artifacts.reviewSpec as ReviewSpec | undefined;
    const designs = spec?.fields.eligibleDesigns.value ?? context.state.request.question.studyDesigns ?? [];
    const clean = designs.map(String).map((value) => value.trim()).filter(Boolean);
    if (clean.length === 0) {
      return {
        artifacts: {
          riskOfBias: [],
          appraisalCapabilityBlock: {
            version: 1,
            reason: 'Eligible study designs are unresolved; appraisal tool cannot be selected safely.',
            requiredAction: 'Resolve study-design eligibility in ReviewSpec.',
          },
        },
        awaitingHuman: { summary: 'Risk-of-bias appraisal requires a resolved eligible study-design specification.' },
      };
    }

    const nonRandomized = clean.filter((design) => !isRandomizedDesign(design));
    if (nonRandomized.length > 0) {
      return {
        artifacts: {
          riskOfBias: [],
          appraisalCapabilityBlock: {
            version: 1,
            reason: 'The current production intervention appraisal vertical is certified only for randomized parallel-group trials.',
            unsupportedDesigns: nonRandomized,
            requiredEngine: 'ROBINS-I/ROBINS-E or another design-specific appraisal engine',
            silentFallbackProhibited: true,
          },
        },
        warnings: [`Design-specific appraisal is unavailable for: ${nonRandomized.join(', ')}. Generic risk labels were withheld.`],
        awaitingHuman: {
          summary: 'Non-randomized intervention evidence requires a validated design-specific appraisal engine; MEDANTIR will not substitute generic RoB logic.',
        },
      };
    }

    return this.rob2.execute(context);
  }
}
