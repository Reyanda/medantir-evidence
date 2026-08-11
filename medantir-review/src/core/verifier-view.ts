import type { PipelineState } from './types.js';
import {
  canonicalScientificValue,
  containsRawSecretField,
  scientificContentHash,
} from './canonical-hash.js';
import {
  verifyScientificRunSeal,
  type ScientificArtifactReceipt,
  type ScientificRunLedger,
  type ScientificRunManifest,
  type ScientificRunSeal,
} from './scientific-run-manifest.js';
import { buildVerifierRunGraph, type VerifierRunGraph } from './verifier-graph.js';
import { VERIFIER_FORBIDDEN_RAW_ARTIFACTS, VERIFIER_READABLE_ARTIFACTS } from './verifier-policy.js';

export { VERIFIER_READABLE_ARTIFACTS } from './verifier-policy.js';

export interface VerifierArtifactIndexEntry extends ScientificArtifactReceipt { readable: boolean }

export interface VerifierRunView {
  schemaVersion: 'medantir-verifier-view/1';
  runId: string;
  reviewType: PipelineState['request']['reviewType'];
  sealValid: boolean;
  sealDigest: string;
  sealScope: ScientificRunSeal['scope'];
  codeIdentity?: string;
  attemptCount: number;
  stageStatuses: Record<string, string>;
  moduleContracts: ScientificRunManifest['sealedContent']['moduleContracts'];
  artifactIndex: VerifierArtifactIndexEntry[];
  graph: VerifierRunGraph;
}

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function assertManifestMatchesCurrentRun(state: PipelineState, manifest: ScientificRunManifest): void {
  const current = Object.fromEntries(Object.entries(state.stages).map(([name, stage]) => [name, stage.status]));
  const names = [...new Set([...Object.keys(current), ...Object.keys(manifest.stageStatuses)])].sort();
  const mismatches = names.filter((name) => current[name] !== manifest.stageStatuses[name]);
  if (mismatches.length > 0) {
    throw httpError(
      409,
      `Scientific verifier bundle is stale because the run has entered replay or changed state at: ${mismatches.join(', ')}. A new manifest/seal is required.`,
    );
  }
}

function requiredRunControls(state: PipelineState): {
  manifest: ScientificRunManifest;
  seal: ScientificRunSeal;
  lineage: ScientificArtifactReceipt[];
  ledger: ScientificRunLedger;
} {
  const manifest = state.artifacts.scientificRunManifest as ScientificRunManifest | undefined;
  const seal = state.artifacts.scientificRunSeal as ScientificRunSeal | undefined;
  const lineage = Array.isArray(state.artifacts.scientificArtifactLineage)
    ? state.artifacts.scientificArtifactLineage as ScientificArtifactReceipt[]
    : undefined;
  const ledger = state.artifacts.scientificRunLedger as ScientificRunLedger | undefined;
  if (!manifest || !seal || !lineage || !ledger) {
    throw httpError(404, 'Scientific verifier bundle is not available for this run yet.');
  }
  assertManifestMatchesCurrentRun(state, manifest);
  return { manifest, seal, lineage, ledger };
}

function safeValue(value: unknown): unknown {
  const projected = canonicalScientificValue(value);
  if (containsRawSecretField(projected)) {
    throw httpError(500, 'Verifier projection contains an unexpected raw secret-bearing field.');
  }
  return projected;
}

export function buildVerifierRunView(state: PipelineState): VerifierRunView {
  const { manifest, seal, lineage, ledger } = requiredRunControls(state);
  const sealValid = verifyScientificRunSeal(manifest, seal);
  if (!sealValid) throw httpError(409, 'Scientific run seal verification failed.');
  return {
    schemaVersion: 'medantir-verifier-view/1',
    runId: state.runId,
    reviewType: state.request.reviewType,
    sealValid,
    sealDigest: seal.digest,
    sealScope: seal.scope,
    ...(manifest.sealedContent.codeIdentity ? { codeIdentity: manifest.sealedContent.codeIdentity } : {}),
    attemptCount: ledger.attempts.length,
    stageStatuses: { ...manifest.stageStatuses },
    moduleContracts: manifest.sealedContent.moduleContracts,
    artifactIndex: lineage.map((receipt) => ({ ...receipt, readable: VERIFIER_READABLE_ARTIFACTS.has(receipt.key) })),
    graph: buildVerifierRunGraph(state),
  };
}

export function verifierManifest(state: PipelineState): unknown {
  return safeValue(requiredRunControls(state).manifest);
}

export function verifierSeal(state: PipelineState): unknown {
  const { manifest, seal } = requiredRunControls(state);
  if (!verifyScientificRunSeal(manifest, seal)) throw httpError(409, 'Scientific run seal verification failed.');
  return safeValue(seal);
}

export function verifierLineage(state: PipelineState): unknown {
  const { manifest, seal, lineage } = requiredRunControls(state);
  if (!verifyScientificRunSeal(manifest, seal)) throw httpError(409, 'Scientific run seal verification failed.');
  return safeValue(lineage.map((receipt) => ({ ...receipt, readable: VERIFIER_READABLE_ARTIFACTS.has(receipt.key) })));
}

export function verifierAttempts(state: PipelineState): unknown {
  const { manifest, seal, ledger } = requiredRunControls(state);
  if (!verifyScientificRunSeal(manifest, seal)) throw httpError(409, 'Scientific run seal verification failed.');
  return safeValue(ledger);
}

export function verifierArtifact(state: PipelineState, key: string): unknown {
  if (VERIFIER_FORBIDDEN_RAW_ARTIFACTS.has(key)) {
    throw httpError(403, `Artifact '${key}' is deliberately unavailable through the verifier API.`);
  }
  if (!VERIFIER_READABLE_ARTIFACTS.has(key)) {
    throw httpError(403, `Artifact '${key}' is not on the verifier-readable allowlist.`);
  }
  if (!(key in state.artifacts)) throw httpError(404, `Artifact '${key}' is not available for this run.`);

  const { manifest, seal, lineage } = requiredRunControls(state);
  if (!verifyScientificRunSeal(manifest, seal)) throw httpError(409, 'Scientific run seal verification failed.');
  const receipt = lineage.find((entry) => entry.key === key);
  if (!receipt) throw httpError(409, `Artifact '${key}' has no current lineage receipt.`);
  const currentHash = scientificContentHash(state.artifacts[key]);
  if (currentHash !== receipt.hash) {
    throw httpError(409, `Artifact '${key}' no longer matches its scientific lineage receipt.`);
  }

  return safeValue({ key, receipt, value: state.artifacts[key] });
}
