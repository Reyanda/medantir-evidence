import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { Agent } from '../core/types.js';
import type { ExternalActionCoordinator } from '../durability/external-action-coordinator.js';
import { AutomaticGradeEvidenceAgent } from './automatic-grade-evidence-agent.js';
import { ContributingRegistryDebtAgent } from './contributing-registry-debt-agent.js';
import { InterventionGradeAgent } from './grade-agent.js';
import { GradePolicyProtocolGateAgent } from './grade-protocol-gate.js';
import { PublicationBiasUniversePolicyGateAgent } from './publication-bias-universe-gate.js';
import { PublicationBiasUniverseGradeAgent } from './publication-bias-universe-grade-agent.js';
import { RegistryPublicationDiscoveryAgent } from './registry-publication-discovery-agent.js';
import { RegistryPublicationLinkageAgent } from './registry-publication-linkage-agent.js';
import { RegistryReferenceEvidenceAgent } from './registry-reference-evidence-agent.js';
import { RegistryResidualDebtAgent } from './registry-residual-debt-agent.js';
import { RegistryResultUniverseAgent } from './registry-result-universe-agent.js';

export interface InterventionCertaintyCompositionOptions {
  publicationDiscoveryAdapters?: EvidenceSourceAdapter[];
  externalActions?: ExternalActionCoordinator;
}

/** Both certainty policies are frozen against the same final protocol checksum. */
export function createProductionInterventionProtocolFinaliseAgent(inner: Agent): Agent {
  if (inner.stage !== 'protocol-finalise') throw new Error('Intervention certainty protocol composition requires protocol-finalise stage');
  return new PublicationBiasUniversePolicyGateAgent(
    new GradePolicyProtocolGateAgent(inner),
  );
}

/**
 * Production intervention GRADE composition.
 *
 * Ordering:
 * 1. exact directness/information-size + applicable Egger evidence;
 * 2. construct full registry/result universe;
 * 3. apply official ClinicalTrials.gov RESULT publication references;
 * 4. durable exact-NCT secondary publication discovery;
 * 5. resolve exact publication links through study-family/bibliographic identity;
 * 6. recompute residual debt so partial adjudications cannot suppress questions;
 * 7. expose/resolve residual registry debt on already-included contributors;
 * 8. audit the full eligible universe and merge positive publication-bias evidence;
 * 9. deterministic frozen-policy GRADE judgement.
 */
export function createProductionInterventionGradeAgent(
  inner: Agent = new InterventionGradeAgent(),
  options: InterventionCertaintyCompositionOptions = {},
): Agent {
  if (inner.stage !== 'grade') throw new Error('Intervention certainty composition requires a grade-stage inner agent');
  return new AutomaticGradeEvidenceAgent(
    new RegistryResultUniverseAgent(
      new RegistryReferenceEvidenceAgent(
        new RegistryPublicationDiscoveryAgent(
          new RegistryPublicationLinkageAgent(
            new RegistryResidualDebtAgent(
              new ContributingRegistryDebtAgent(
                new PublicationBiasUniverseGradeAgent(inner),
              ),
            ),
          ),
          options.publicationDiscoveryAdapters ?? [],
          options.externalActions,
        ),
      ),
    ),
  );
}
