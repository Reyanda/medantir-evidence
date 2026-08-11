import type { PipelineState, ReviewRequest } from '../core/types.js';
import { stableHash } from '../core/utils.js';
import type { ClarificationResolutionLedger } from '../question/autonomous-question-agent.js';
import {
  compileReviewSpec,
  createProtocolAmendments,
  type ClarificationResolution,
  type ProtocolAmendment,
  type ReviewSpec,
} from '../question/review-spec.js';
import { invalidatePipelineFromStage } from '../protocols/replay-invalidation.js';
import type { PublicationBiasUniversePolicyRequirement } from './publication-bias-universe-gate.js';

export interface RegistrySearchSourceSubmission {
  source: 'clinicaltrials.gov';
  rationale: string;
}

export interface RegistrySearchSourceAmendmentReceipt {
  version: 1;
  amendmentId: string;
  source: 'clinicaltrials.gov';
  rationale: string;
  actorId: string;
  decidedAt: string;
  beforeReviewSpecHash: string;
  afterReviewSpecHash: string;
  earliestReplayStage: 'search-build';
  semanticHash: string;
}

export type ResumeRegistrySearchPipeline = (state: PipelineState) => Promise<PipelineState>;

type ExtendedReviewRequest = ReviewRequest & { reviewSpec?: Record<string, unknown> };

function canonicalSource(value: unknown): 'clinicaltrials.gov' {
  if (typeof value !== 'string') throw Object.assign(new Error('Registry search source is required'), { status: 400 });
  const clean = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(clean)) {
    throw Object.assign(new Error('Only ClinicalTrials.gov is currently supported as an automatically executable registry source'), { status: 400 });
  }
  return 'clinicaltrials.gov';
}

export function parseRegistrySearchSourceSubmission(value: unknown): RegistrySearchSourceSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('Registry search amendment must be an object'), { status: 400 });
  }
  const raw = value as Record<string, unknown>;
  const source = canonicalSource(raw.source);
  if (typeof raw.rationale !== 'string' || !raw.rationale.trim()) {
    throw Object.assign(new Error('Registry search amendment requires a rationale'), { status: 400 });
  }
  return { source, rationale: raw.rationale.trim() };
}

function ledger(state: PipelineState): RegistrySearchSourceAmendmentReceipt[] {
  return Array.isArray(state.artifacts.registrySearchSourceAmendments)
    ? state.artifacts.registrySearchSourceAmendments as RegistrySearchSourceAmendmentReceipt[]
    : [];
}

function semantic(input: { source: string; rationale: string; actorId: string }): string {
  return stableHash({ source: input.source, rationale: input.rationale.trim(), actorId: input.actorId });
}

function mergeProtocolAmendments(existing: ProtocolAmendment[], added: ProtocolAmendment[]): ProtocolAmendment[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of added) byId.set(item.id, item);
  return [...byId.values()];
}

/**
 * Adds a prospectively required registry source without bypassing ReviewSpec.
 *
 * The amendment changes the evidence universe, so the pipeline is invalidated
 * from search-build. Existing prospective GRADE/publication-bias policies are
 * retained deliberately; protocol finalisation will mark them stale if the new
 * search plan changes the final protocol checksum and request refreezing.
 */
export async function submitRegistrySearchSourceAndResume(input: {
  state: PipelineState;
  submission: RegistrySearchSourceSubmission;
  actor: { sub: string };
  resume: ResumeRegistrySearchPipeline;
  now?: string;
}): Promise<PipelineState> {
  if (!input.actor.sub.trim()) throw Object.assign(new Error('Authenticated registry-search reviewer is required'), { status: 401 });
  const actorId = `user:${input.actor.sub}`;
  const decisionHash = semantic({ source: input.submission.source, rationale: input.submission.rationale, actorId });
  const existing = ledger(input.state).find((item) => item.source === input.submission.source);
  if (existing) {
    if (existing.semanticHash !== decisionHash) {
      throw Object.assign(new Error(`${input.submission.source} already has a different registry-search amendment`), { status: 409 });
    }
    return input.state;
  }

  const requirement = input.state.artifacts.publicationBiasUniversePolicyRequirement as PublicationBiasUniversePolicyRequirement | undefined;
  if (requirement?.status !== 'search-plan-incompatible') {
    throw Object.assign(new Error('No active publication-bias registry search-plan amendment is required'), { status: 409 });
  }
  if (input.state.stages['protocol-finalise'].status !== 'awaiting-human' && input.state.stages['protocol-finalise'].status !== 'pending') {
    throw Object.assign(new Error(`Registry search source cannot be amended while protocol-finalise is ${input.state.stages['protocol-finalise'].status}`), { status: 409 });
  }

  const beforeSpec = input.state.artifacts.reviewSpec as ReviewSpec | undefined;
  if (!beforeSpec) throw Object.assign(new Error('Registry search amendment requires a compiled ReviewSpec'), { status: 409 });
  const currentDatabases = input.state.request.databases.map((value) => value.trim()).filter(Boolean);
  const nextDatabases = [...new Set([...currentDatabases, 'ClinicalTrials.gov'])];
  const extended = input.state.request as ExtendedReviewRequest;
  const nextRequest: ExtendedReviewRequest = {
    ...structuredClone(input.state.request),
    databases: nextDatabases,
    ...(extended.reviewSpec
      ? { reviewSpec: { ...structuredClone(extended.reviewSpec), databases: nextDatabases } }
      : {}),
  };
  const clarificationLedger = input.state.artifacts.clarificationResolutionLedger as ClarificationResolutionLedger | undefined;
  const now = input.now ?? new Date().toISOString();
  const compilation = compileReviewSpec(nextRequest, {
    resolutions: clarificationLedger?.resolutions ?? [],
    now,
  });
  if (compilation.status !== 'complete') {
    throw Object.assign(new Error(`Registry search amendment unexpectedly reopened ReviewSpec ambiguity: ${compilation.unresolvedMaterialFields.join(', ')}`), { status: 409 });
  }

  const resolution: ClarificationResolution = {
    issueId: `registry-search-${stableHash({ runId: input.state.runId, source: input.submission.source }).slice(0, 20)}`,
    field: 'databases',
    value: nextDatabases,
    rationale: input.submission.rationale,
    actorId,
    decidedAt: now,
  };
  const amendments = createProtocolAmendments(beforeSpec, compilation.spec, [resolution]);
  if (amendments.length !== 1 || amendments[0]?.earliestReplayStage !== 'search-build') {
    throw new Error('Registry search amendment did not produce the expected search-build protocol replay boundary');
  }

  input.state.request = nextRequest;
  input.state.artifacts.reviewSpec = compilation.spec;
  input.state.artifacts.reviewSpecCompilation = {
    status: compilation.status,
    reviewSpecHash: compilation.spec.hash,
    safeDefaults: compilation.safeDefaults,
    unresolvedMaterialFields: compilation.unresolvedMaterialFields,
  };
  input.state.artifacts.protocolAmendments = mergeProtocolAmendments(
    Array.isArray(input.state.artifacts.protocolAmendments) ? input.state.artifacts.protocolAmendments as ProtocolAmendment[] : [],
    amendments,
  );

  const receipt: RegistrySearchSourceAmendmentReceipt = {
    version: 1,
    amendmentId: `registry-search-amend-${stableHash({ runId: input.state.runId, decisionHash, before: beforeSpec.hash, after: compilation.spec.hash }).slice(0, 24)}`,
    source: input.submission.source,
    rationale: input.submission.rationale,
    actorId,
    decidedAt: now,
    beforeReviewSpecHash: beforeSpec.hash,
    afterReviewSpecHash: compilation.spec.hash,
    earliestReplayStage: 'search-build',
    semanticHash: decisionHash,
  };
  input.state.artifacts.registrySearchSourceAmendments = [...ledger(input.state), receipt];

  const invalidation = invalidatePipelineFromStage(input.state, 'search-build', {
    preserveArtifacts: [
      'reviewSpec',
      'reviewSpecCompilation',
      'clarificationResolutionLedger',
      'protocolAmendments',
      'registrySearchSourceAmendments',
      'gradePolicySet',
      'gradePolicyAmendments',
      'publicationBiasUniversePolicy',
      'publicationBiasUniversePolicyAmendments',
    ],
  });
  input.state.updatedAt = now;
  input.state.audit.push({
    id: `registry-search-audit-${stableHash(receipt).slice(0, 24)}`,
    runId: input.state.runId,
    stage: 'protocol-finalise',
    event: 'registry-search-source-amended',
    timestamp: now,
    attempt: 0,
    details: {
      amendmentId: receipt.amendmentId,
      source: receipt.source,
      actorId,
      beforeReviewSpecHash: receipt.beforeReviewSpecHash,
      afterReviewSpecHash: receipt.afterReviewSpecHash,
      earliestReplayStage: 'search-build',
      invalidatedStages: invalidation.resetStages,
      removedArtifacts: invalidation.removedArtifacts,
    },
  });
  return input.resume(input.state);
}
