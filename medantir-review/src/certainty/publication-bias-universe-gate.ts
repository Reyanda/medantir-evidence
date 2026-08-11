import type { Agent, AgentContext, AgentResult, ProtocolPackage, SearchStrategy } from '../core/types.js';
import type { PublicationBiasUniversePolicy } from './publication-bias-universe.js';

export type PublicationBiasUniversePolicyRequirementStatus =
  | 'required'
  | 'stale'
  | 'search-plan-incompatible'
  | 'satisfied';

export interface PublicationBiasUniversePolicyRequirement {
  version: 1;
  status: PublicationBiasUniversePolicyRequirementStatus;
  protocolHash: string;
  endpoint: string;
  searchAmendmentEndpoint: string;
  requiredParameters: string[];
  reason: string;
  searchPlanCompatible: boolean;
  plannedRegistrySources: string[];
  supportedAutomaticRegistrySources: string[];
}

const SUPPORTED_REGISTRY_SOURCES = ['clinicaltrials.gov'] as const;

function protocolPackage(result: AgentResult, context: AgentContext): ProtocolPackage {
  const value = result.artifacts.protocolPackage ?? context.state.artifacts.protocolPackage;
  if (!value || typeof value !== 'object') throw new Error('Publication-bias universe gate requires the final protocol package');
  const protocol = value as ProtocolPackage;
  if (!protocol.checksum?.trim()) throw new Error('Publication-bias universe gate requires a final protocol checksum');
  return protocol;
}

function registrySourceName(value: string): string | null {
  const clean = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(clean)) return 'clinicaltrials.gov';
  if (/\b(?:who\s+)?ictrp\b/.test(clean)) return 'who-ictrp';
  if (/\bisrctn\b/.test(clean)) return 'isrctn';
  if (/\banzctr\b/.test(clean)) return 'anzctr';
  if (/\bchictr\b/.test(clean)) return 'chictr';
  if (/\b(?:eudract|ctis)\b/.test(clean)) return 'eu-trial-registry';
  if (/\bdrks\b/.test(clean)) return 'drks';
  if (/\bumin\b/.test(clean)) return 'umin';
  return null;
}

function plannedRegistrySources(result: AgentResult, context: AgentContext): string[] {
  const value = result.artifacts.searchStrategies ?? context.state.artifacts.searchStrategies;
  const strategies = Array.isArray(value) ? value as SearchStrategy[] : [];
  const fromStrategies = strategies.flatMap((strategy) => {
    const source = registrySourceName(`${strategy.database} ${strategy.platform}`);
    return source ? [source] : [];
  });
  const fromRequest = context.state.request.databases.flatMap((database) => {
    const source = registrySourceName(database);
    return source ? [source] : [];
  });
  return [...new Set([...fromStrategies, ...fromRequest])].sort();
}

function requirement(input: {
  protocolHash: string;
  status: PublicationBiasUniversePolicyRequirementStatus;
  plannedRegistrySources: string[];
}): PublicationBiasUniversePolicyRequirement {
  return {
    version: 1,
    status: input.status,
    protocolHash: input.protocolHash,
    endpoint: '/runs/:runId/grade/publication-bias-policy',
    searchAmendmentEndpoint: '/runs/:runId/grade/publication-bias-search',
    requiredParameters: [
      'minimumEligibleUniverseRegistryCoverage',
      'requireEligibilityResolvedForAssessmentBasis',
      'requireResultAvailabilityKnownForAssessmentBasis',
      'requirePrimaryOutcomeSpecificationKnownForAssessmentBasis',
      'requireTargetOutcomeStatusKnownForAssessmentBasis',
      'requirePublicationStatusKnownForAssessmentBasis',
    ],
    reason: 'A signal-free publication-bias assessment is only interpretable when registry, result, outcome and publication-linkage completeness rules and the registry search route were frozen before result inspection.',
    searchPlanCompatible: input.status !== 'search-plan-incompatible',
    plannedRegistrySources: input.plannedRegistrySources,
    supportedAutomaticRegistrySources: [...SUPPORTED_REGISTRY_SOURCES],
  };
}

/** Prospective gate for full eligible-universe completeness policy and its executable registry-search plan. */
export class PublicationBiasUniversePolicyGateAgent implements Agent {
  readonly stage = 'protocol-finalise' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    const protocol = protocolPackage(result, context);
    const policy = context.state.artifacts.publicationBiasUniversePolicy as PublicationBiasUniversePolicy | undefined;
    const planned = plannedRegistrySources(result, context);

    let status: PublicationBiasUniversePolicyRequirementStatus;
    if (!policy) status = 'required';
    else if (policy.protocolHash !== protocol.checksum) status = 'stale';
    else if (policy.minimumEligibleUniverseRegistryCoverage > 0 && planned.length === 0) status = 'search-plan-incompatible';
    else status = 'satisfied';

    const artifacts = {
      ...result.artifacts,
      publicationBiasUniversePolicyRequirement: requirement({
        protocolHash: protocol.checksum,
        status,
        plannedRegistrySources: planned,
      }),
      publicationBiasUniversePolicyReady: status === 'satisfied',
    };

    if (status === 'satisfied') return { ...result, artifacts };

    const warning = status === 'required'
      ? `Prospective publication-bias registry/result/publication completeness policy must be frozen against protocol ${protocol.checksum}.`
      : status === 'stale'
        ? `Publication-bias completeness policy is stale for protocol ${protocol.checksum}.`
        : 'The frozen publication-bias completeness policy requires registry coverage, but the final search plan contains no trial-registry source.';

    if (result.awaitingHuman) {
      return { ...result, artifacts, warnings: [...(result.warnings ?? []), warning] };
    }

    return {
      ...result,
      artifacts,
      warnings: [...(result.warnings ?? []), warning],
      awaitingHuman: {
        summary: status === 'required'
          ? 'Freeze the registry/result/publication completeness policy before primary-study result retrieval.'
          : status === 'stale'
            ? 'Refreeze the registry/result/publication completeness policy against the amended final protocol.'
            : 'Add a supported trial-registry search source (currently ClinicalTrials.gov) or explicitly amend the prospective completeness policy before evidence search.',
      },
    };
  }
}
