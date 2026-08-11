import type { PipelineState } from '../core/types.js';
import {
  parsePublicationBiasUniversePolicyConfiguration,
  recordPublicationBiasUniversePolicy,
} from './publication-bias-universe-policy.js';
import {
  parseRegistrySearchSourceSubmission,
  submitRegistrySearchSourceAndResume,
} from './publication-bias-registry-search-controller.js';
import {
  parseRegistryUniverseAdjudication,
  submitRegistryUniverseAdjudicationAndResume,
} from './registry-universe-controller.js';

export interface PublicationBiasApiResponse {
  status: number;
  payload: unknown;
  state?: PipelineState;
}

export interface PublicationBiasApiContext {
  method: string | undefined;
  pathname: string;
  identitySub: string;
  stateFor(runId: string): PipelineState | undefined;
  isExecuting(runId: string): boolean;
  readBody(): Promise<unknown>;
  resume(state: PipelineState): Promise<PipelineState>;
  schedule(state: PipelineState): boolean;
  now(): string;
}

function responseStatus(state: PipelineState): number {
  if (state.stages['human-verify'].status === 'passed') return 200;
  if (Object.values(state.stages).some((stage) => stage.status === 'failed')) return 422;
  return 202;
}

function notFound(): PublicationBiasApiResponse {
  return { status: 404, payload: { error: 'Run not found' } };
}

function busy(runId: string): PublicationBiasApiResponse {
  return {
    status: 409,
    payload: { error: `Run ${runId} is currently executing; publication-bias methodology cannot be mutated concurrently with a scientific stage.` },
  };
}

/** Handles only publication-bias methodology routes; unrelated paths return null. */
export async function handlePublicationBiasApi(context: PublicationBiasApiContext): Promise<PublicationBiasApiResponse | null> {
  const policyMatch = context.pathname.match(/^\/runs\/([^/]+)\/grade\/publication-bias-policy$/);
  if (policyMatch?.[1]) {
    const runId = policyMatch[1];
    const state = context.stateFor(runId);
    if (!state) return notFound();
    if (context.method === 'GET') {
      return {
        status: 200,
        payload: {
          policy: state.artifacts.publicationBiasUniversePolicy ?? null,
          amendments: state.artifacts.publicationBiasUniversePolicyAmendments ?? [],
          lateAmendment: state.artifacts.publicationBiasUniversePolicyLateAmendment ?? null,
          requirement: state.artifacts.publicationBiasUniversePolicyRequirement ?? null,
        },
      };
    }
    if (context.method === 'POST') {
      if (context.isExecuting(runId)) return busy(runId);
      const configuration = parsePublicationBiasUniversePolicyConfiguration(await context.readBody());
      const recorded = recordPublicationBiasUniversePolicy({
        state,
        configuration,
        actorId: `user:${context.identitySub}`,
        decidedAt: context.now(),
      });
      if (recorded.changed) context.schedule(state);
      return { status: 202, payload: { changed: recorded.changed, receipt: recorded.receipt, state }, state };
    }
    return { status: 405, payload: { error: 'Method not allowed' } };
  }

  const searchMatch = context.pathname.match(/^\/runs\/([^/]+)\/grade\/publication-bias-search$/);
  if (searchMatch?.[1]) {
    const runId = searchMatch[1];
    const state = context.stateFor(runId);
    if (!state) return notFound();
    if (context.method === 'GET') {
      return {
        status: 200,
        payload: {
          requirement: state.artifacts.publicationBiasUniversePolicyRequirement ?? null,
          amendments: state.artifacts.registrySearchSourceAmendments ?? [],
          reviewSpec: state.artifacts.reviewSpec ?? null,
        },
      };
    }
    if (context.method === 'POST') {
      if (context.isExecuting(runId)) return busy(runId);
      const submission = parseRegistrySearchSourceSubmission(await context.readBody());
      const resumed = await submitRegistrySearchSourceAndResume({
        state,
        submission,
        actor: { sub: context.identitySub },
        now: context.now(),
        resume: context.resume,
      });
      return { status: responseStatus(resumed), payload: resumed, state: resumed };
    }
    return { status: 405, payload: { error: 'Method not allowed' } };
  }

  const universeMatch = context.pathname.match(/^\/runs\/([^/]+)\/grade\/registry-universe$/);
  if (universeMatch?.[1]) {
    const runId = universeMatch[1];
    const state = context.stateFor(runId);
    if (!state) return notFound();
    if (context.method === 'GET') {
      return {
        status: 200,
        payload: {
          reviewPackage: state.artifacts.registryUniverseReviewPackage ?? null,
          universe: state.artifacts.registeredStudyResultUniverse ?? [],
          quality: state.artifacts.registryUniverseQuality ?? null,
          residualDebtQuality: state.artifacts.registryResidualDebtQuality ?? null,
          contributingDebtQuality: state.artifacts.contributingRegistryDebtQuality ?? null,
          adjudications: state.artifacts.registryUniverseAdjudications ?? [],
          resolutionHistory: state.artifacts.registryUniverseResolutionHistory ?? [],

          registryResultReferences: state.artifacts.registryResultReferenceReceipts ?? [],
          registryResultReferenceQuality: state.artifacts.registryResultReferenceQuality ?? null,

          publicationDiscoveryRecords: state.artifacts.registryPublicationDiscoveryRecords ?? [],
          publicationDiscoveryReceipts: state.artifacts.registryPublicationDiscoveryReceipts ?? [],
          publicationDiscoveryProvenance: state.artifacts.registryPublicationDiscoveryProvenance ?? [],
          publicationDiscoveryQuality: state.artifacts.registryPublicationDiscoveryQuality ?? null,

          publicationLinks: state.artifacts.registryPublicationLinkReceipts ?? [],
          publicationLinkageQuality: state.artifacts.registryPublicationLinkageQuality ?? null,

          audits: state.artifacts.publicationBiasUniverseAudits ?? [],
          evidenceCatalog: state.artifacts.publicationBiasEvidenceCatalog ?? [],
          policy: state.artifacts.publicationBiasUniversePolicy ?? null,
        },
      };
    }
    if (context.method === 'POST') {
      if (context.isExecuting(runId)) return busy(runId);
      const submission = parseRegistryUniverseAdjudication(await context.readBody());
      const resumed = await submitRegistryUniverseAdjudicationAndResume({
        state,
        submission,
        actor: { sub: context.identitySub },
        now: context.now(),
        resume: context.resume,
      });
      return { status: responseStatus(resumed), payload: resumed, state: resumed };
    }
    return { status: 405, payload: { error: 'Method not allowed' } };
  }

  return null;
}
