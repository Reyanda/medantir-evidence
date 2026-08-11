import type { Agent } from '../core/types.js';
import { StructuredParticipantCountAgent } from '../certainty/structured-participant-count-agent.js';
import { AdjustmentIdentityExtractionAgent } from './adjustment-identity-agent.js';
import { AdjustmentCompatibilityGuardAgent } from './adjustment-guard-agent.js';
import { InterventionRandomEffectsSynthesisAgent } from './intervention-random-effects-agent.js';

/**
 * Production intervention extraction composition.
 *
 * The existing provenance/study-family/estimand extraction stack remains inside
 * `inner`. Adjustment identity is added first, then the outer participant-count
 * layer may derive outcome information size only from the exact structured table
 * row already accepted for the quantitative effect.
 */
export function createProductionInterventionExtractionAgent(inner: Agent): Agent {
  if (inner.stage !== 'extract') throw new Error('Production intervention extraction composition requires an extract-stage agent');
  return new StructuredParticipantCountAgent(
    new AdjustmentIdentityExtractionAgent(inner),
  );
}

/**
 * Production intervention synthesis composition.
 *
 * Inner estimand/dependence guards execute first. Random-effects analysis may
 * then compute, but adjustment compatibility is the outermost authority gate: an
 * unclassified or incompatible adjustment set removes numeric promotion from the
 * final stage artifacts.
 */
export function createProductionInterventionSynthesisAgent(inner: Agent): Agent {
  if (inner.stage !== 'synthesise') throw new Error('Production intervention synthesis composition requires a synthesise-stage agent');
  return new AdjustmentCompatibilityGuardAgent(
    new InterventionRandomEffectsSynthesisAgent(inner),
  );
}
