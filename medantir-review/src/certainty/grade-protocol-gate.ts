import type { Agent, AgentContext, AgentResult, ProtocolPackage } from '../core/types.js';
import type { GradePolicySet } from './grade.js';

export type GradePolicyDomain = 'risk-of-bias' | 'inconsistency' | 'imprecision' | 'indirectness' | 'publication-bias';

export interface GradePolicyRequirement {
  version: 1;
  status: 'required' | 'stale' | 'satisfied';
  protocolHash: string;
  endpoint: string;
  materialReason: string;
  requiredDomains: Array<{
    domain: GradePolicyDomain;
    requiredParameters: string[];
  }>;
  staleDomains?: string[];
}

const REQUIREMENTS: GradePolicyRequirement['requiredDomains'] = [
  {
    domain: 'risk-of-bias',
    requiredParameters: [
      'highRiskWeightSerious',
      'highRiskWeightVerySerious',
      'someConcernsWeightSerious',
      'minimumWeightCoverage (optional; defaults to 0.999)',
    ],
  },
  {
    domain: 'inconsistency',
    requiredParameters: ['i2Serious', 'i2VerySerious', 'predictionIntervalDecisionConflictSerious'],
  },
  {
    domain: 'imprecision',
    requiredParameters: ['nullValue', 'benefitThreshold', 'harmThreshold', 'requiredInformationSize', 'verySeriousOisFraction'],
  },
  {
    domain: 'indirectness',
    requiredParameters: ['seriousIfPartialDimensionsAtLeast', 'verySeriousIfIndirectDimensionsAtLeast'],
  },
  {
    domain: 'publication-bias',
    requiredParameters: ['seriousSignalWeight', 'verySeriousSignalWeight'],
  },
];

function protocolPackage(result: AgentResult, context: AgentContext): ProtocolPackage {
  const value = result.artifacts.protocolPackage ?? context.state.artifacts.protocolPackage;
  if (!value || typeof value !== 'object') throw new Error('Prospective GRADE policy gate requires the final protocol package.');
  const protocol = value as ProtocolPackage;
  if (!protocol.checksum?.trim()) throw new Error('Prospective GRADE policy gate requires a protocol checksum.');
  return protocol;
}

function policyForDomain(policy: GradePolicySet, domain: GradePolicyDomain) {
  switch (domain) {
    case 'risk-of-bias': return policy.riskOfBias;
    case 'inconsistency': return policy.inconsistency;
    case 'imprecision': return policy.imprecision;
    case 'indirectness': return policy.indirectness;
    case 'publication-bias': return policy.publicationBias;
  }
}

function stalePolicyDomains(policy: GradePolicySet | undefined, protocolHash: string): GradePolicyDomain[] {
  if (!policy) return REQUIREMENTS.map((item) => item.domain);
  return REQUIREMENTS.flatMap((item) => {
    const value = policyForDomain(policy, item.domain);
    return !value || value.protocolHash !== protocolHash ? [item.domain] : [];
  });
}

function requirement(protocolHash: string, status: GradePolicyRequirement['status'], staleDomains?: GradePolicyDomain[]): GradePolicyRequirement {
  return {
    version: 1,
    status,
    protocolHash,
    endpoint: '/runs/:runId/grade/policy',
    materialReason: 'GRADE thresholds can change outcome certainty and conclusions. They must be frozen against the final protocol before result-producing search/screening stages begin.',
    requiredDomains: REQUIREMENTS,
    ...(staleDomains?.length ? { staleDomains } : {}),
  };
}

/**
 * Intervention-review protocol gate.
 *
 * The wrapped finalisation agent first produces the definitive protocol checksum.
 * MEDANTIR then refuses to pass protocol-finalise until every deterministic GRADE
 * policy domain is frozen against that exact checksum. This makes prospective
 * certainty policy an executable pre-result invariant rather than documentation.
 */
export class GradePolicyProtocolGateAgent implements Agent {
  readonly stage = 'protocol-finalise' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.inner.execute(context);
    if (result.awaitingHuman || result.rework) return result;
    const protocol = protocolPackage(result, context);
    const policy = context.state.artifacts.gradePolicySet as GradePolicySet | undefined;
    const stale = stalePolicyDomains(policy, protocol.checksum);
    if (stale.length > 0) {
      const status: GradePolicyRequirement['status'] = policy ? 'stale' : 'required';
      return {
        ...result,
        artifacts: {
          ...result.artifacts,
          gradePolicyRequirement: requirement(protocol.checksum, status, stale),
          gradePolicyProtocolReady: false,
        },
        warnings: [
          ...(result.warnings ?? []),
          policy
            ? `GRADE policy is stale for protocol ${protocol.checksum}; mismatched/missing domain(s): ${stale.join(', ')}.`
            : `Prospective GRADE policy must be frozen against protocol ${protocol.checksum} before search execution.`,
        ],
        awaitingHuman: {
          summary: policy
            ? `Refreeze GRADE policy for the final protocol. Stale/missing domains: ${stale.join(', ')}.`
            : 'Freeze the outcome-certainty GRADE policy against the final protocol before the review searches for primary-study results.',
        },
      };
    }

    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        gradePolicyRequirement: requirement(protocol.checksum, 'satisfied'),
        gradePolicyProtocolReady: true,
      },
    };
  }
}
