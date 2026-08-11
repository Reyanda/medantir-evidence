import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { HumanVerificationSubmission, PipelineState, ReviewRequest } from './core/types.js';
import type { CredentialVaultPort, HumanVerificationPort } from './core/ports.js';
import { SubmittedHumanVerificationPort } from './adapters/mock.js';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { InMemoryCredentialVault } from './adapters/registration/registry-adapters.js';
import { fixtureRecords } from './fixtures.js';
import { resumeMockPipeline } from './engine.js';
import { resumeRealPipeline } from './real-engine.js';
import { createPipelineState } from './core/state.js';
import { OrcidOAuthSessionManager } from './registration/orcid-session.js';
import { parseClarificationSubmission, submitClarificationAndResume } from './question/clarification-controller.js';
import { parseRob2ReviewSubmission, submitRob2ReviewAndResume } from './appraisal/rob2-controller.js';
import {
  buildGradeEvidenceCatalog,
  parseGradeReviewSubmission,
  submitGradeReviewAndResume,
} from './certainty/grade-controller.js';
import {
  parseGradePolicyConfiguration,
  recordGradePolicyConfiguration,
} from './certainty/grade-policy.js';
import { handlePublicationBiasApi } from './certainty/publication-bias-api.js';
import {
  buildVerifierRunView,
  verifierArtifact,
  verifierAttempts,
  verifierLineage,
  verifierManifest,
  verifierSeal,
} from './core/verifier-view.js';
import { markRecoveryResumed } from './durability/recovery.js';
import { createReviewDurabilityRuntime, type ReviewDurabilityRuntime } from './durability/runtime.js';

const CORS_ORIGIN = process.env.CORS_ORIGINS ?? '*';
const USE_MOCK = !process.env.REVIEW_LIVE;
const CORS_HEADERS = {
  'access-control-allow-origin': CORS_ORIGIN,
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Authorization, X-Actiora-Project',
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

function isReviewRequest(value: unknown): value is ReviewRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReviewRequest>;
  return Boolean(
    candidate.question &&
    typeof candidate.question.title === 'string' &&
    typeof candidate.question.objective === 'string' &&
    Array.isArray(candidate.databases) &&
    typeof candidate.reviewType === 'string',
  );
}

function isVerificationSubmission(value: unknown): value is HumanVerificationSubmission {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HumanVerificationSubmission>;
  return Boolean(
    typeof candidate.packageId === 'string' &&
    (candidate.mode === 'blinded' || candidate.mode === 'unblinded') &&
    Array.isArray(candidate.decisions) &&
    candidate.decisions.every((decision) =>
      decision &&
      typeof decision.itemId === 'string' &&
      ['accept', 'reject', 'amend', 'defer'].includes(decision.verdict) &&
      typeof decision.rationale === 'string',
    ),
  );
}

function recordsFor(request: ReviewRequest) {
  return Object.fromEntries(
    request.databases.map((database) => [
      database,
      fixtureRecords.filter((record) =>
        record.sourceDatabases.some((source) => source.toLowerCase() === database.toLowerCase()),
      ),
    ]),
  );
}

function responseStatus(state: PipelineState, created = false): number {
  if (state.stages['human-verify'].status === 'passed') return created ? 201 : 200;
  if (Object.values(state.stages).some((stage) => stage.status === 'failed')) return 422;
  return 202;
}

function failRun(state: PipelineState, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const active = Object.values(state.stages).filter((stage) => stage.status === 'running');
  const targets = active.length
    ? active
    : [Object.values(state.stages).find((stage) => stage.status === 'pending')].filter(Boolean);
  for (const stage of targets) {
    if (!stage) continue;
    stage.status = 'failed';
    stage.errors = [...stage.errors, message];
    stage.completedAt = new Date().toISOString();
  }
  state.updatedAt = new Date().toISOString();
}

export interface ApiServerOptions {
  orcidSessionManager?: OrcidOAuthSessionManager;
  identityProvider?: IdentityProvider;
  runsFile?: string;
  credentialVault?: CredentialVaultPort;
  durabilityRoot?: string;
  durabilityRuntime?: ReviewDurabilityRuntime;
}

export interface RequestIdentity { sub: string; projectId: string; token?: string }
export interface IdentityProvider { authenticate(req: IncomingMessage): Promise<RequestIdentity> }

function cognitoIdentityProvider(): IdentityProvider | undefined {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!userPoolId || !clientId) return undefined;
  const verifier = CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access', clientId });
  return {
    async authenticate(req) {
      const authorization = req.headers.authorization ?? '';
      const projectId = String(req.headers['x-actiora-project'] ?? '').trim();
      if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Bearer token required'), { status: 401 });
      if (!/^[A-Za-z0-9._:-]{1,160}$/.test(projectId)) throw Object.assign(new Error('Valid X-Actiora-Project required'), { status: 400 });
      try {
        const token = authorization.slice(7);
        const claims = await verifier.verify(token);
        return { sub: claims.sub, projectId, token };
      } catch {
        throw Object.assign(new Error('Invalid or expired access token'), { status: 401 });
      }
    },
  };
}

function defaultApiServerOptions(): ApiServerOptions {
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;
  const redirectUri = process.env.ORCID_REDIRECT_URI;
  const identityProvider = cognitoIdentityProvider();
  const credentialStore = new InMemoryCredentialVault();
  if (!clientId || !clientSecret || !redirectUri) {
    return {
      ...(identityProvider ? { identityProvider } : {}),
      credentialVault: credentialStore,
    };
  }
  const options: ApiServerOptions = {
    orcidSessionManager: new OrcidOAuthSessionManager({
      config: {
        clientId,
        clientSecret,
        redirectUri,
        sandbox: process.env.ORCID_SANDBOX === '1',
      },
      credentialStore,
    }),
    credentialVault: credentialStore,
  };
  if (identityProvider) options.identityProvider = identityProvider;
  return options;
}

interface OwnedRun { ownerSub: string; projectId: string; state: PipelineState }

function loadRuns(file: string): Map<string, OwnedRun> {
  try {
    const entries = JSON.parse(readFileSync(file, 'utf8')) as Array<[string, OwnedRun]>;
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveRuns(file: string, runs: Map<string, OwnedRun>): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify([...runs]), { mode: 0o600 });
  renameSync(temporary, file);
}

export function createApiServer(options: ApiServerOptions = {}) {
  const runsFile = options.runsFile ?? process.env.RUNS_FILE ?? '/data/runs.json';
  const runs = existsSync(runsFile) ? loadRuns(runsFile) : new Map<string, OwnedRun>();
  const durability = USE_MOCK
    ? undefined
    : options.durabilityRuntime ?? createReviewDurabilityRuntime(
        options.durabilityRoot ?? process.env.REVIEW_DURABILITY_ROOT ?? join(dirname(runsFile), 'review-durability'),
      );
  const backgroundRuns = new Set<string>();

  const recoveryPromise = (async () => {
    if (!durability) return;
    let changed = false;
    for (const [runId, entry] of runs) {
      try {
        entry.state = await durability.recover(entry.state);
        runs.set(runId, entry);
        changed = true;
      } catch (error) {
        failRun(entry.state, new Error(`Durable recovery failed: ${error instanceof Error ? error.message : String(error)}`));
        changed = true;
      }
    }
    if (changed) saveRuns(runsFile, runs);
  })();

  const identityProvider = options.identityProvider ?? cognitoIdentityProvider();

  const executePipeline = (
    state: PipelineState,
    identity: RequestIdentity,
    humanVerificationPort: HumanVerificationPort | null,
  ): Promise<PipelineState> => USE_MOCK
    ? resumeMockPipeline(state, recordsFor(state.request), humanVerificationPort)
    : resumeRealPipeline(
        state,
        humanVerificationPort,
        identity,
        options.credentialVault,
        durability?.checkpoints,
        durability?.externalActions,
      );

  const persistOwned = (state: PipelineState, identity: RequestIdentity): void => {
    runs.set(state.runId, { ownerSub: identity.sub, projectId: identity.projectId, state });
    saveRuns(runsFile, runs);
  };

  const scheduleExecution = (
    state: PipelineState,
    identity: RequestIdentity,
    humanVerificationPort: HumanVerificationPort | null = null,
  ): boolean => {
    if (backgroundRuns.has(state.runId)) return false;
    backgroundRuns.add(state.runId);
    executePipeline(state, identity, humanVerificationPort)
      .then((resumed) => persistOwned(resumed, identity))
      .catch((error) => {
        failRun(state, error);
        persistOwned(state, identity);
      })
      .finally(() => backgroundRuns.delete(state.runId));
    return true;
  };

  const scheduleRecoveredResume = (state: PipelineState, identity: RequestIdentity): void => {
    if (USE_MOCK || !durability || backgroundRuns.has(state.runId)) return;
    const recovery = state.artifacts.recoveryControl as { version?: number; resumedAutomatically?: boolean } | undefined;
    if (!recovery || recovery.version !== 1 || recovery.resumedAutomatically === true) return;
    markRecoveryResumed(state);
    persistOwned(state, identity);
    scheduleExecution(state, identity);
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { status: 'ok', service: 'medantir-review-engine', version: '0.5.0' });
        return;
      }

      await recoveryPromise;
      if (!identityProvider) {
        json(res, 503, { error: 'Authentication is not configured' });
        return;
      }
      let identity: RequestIdentity;
      try {
        identity = await identityProvider.authenticate(req);
      } catch (error) {
        json(res, Number((error as { status?: number }).status) || 401, { error: error instanceof Error ? error.message : 'Unauthorized' });
        return;
      }

      const owned = (runId: string): PipelineState | undefined => {
        const entry = runs.get(runId);
        return entry?.ownerSub === identity.sub && entry.projectId === identity.projectId ? entry.state : undefined;
      };

      const publicationBiasResponse = await handlePublicationBiasApi({
        method: req.method,
        pathname: url.pathname,
        identitySub: identity.sub,
        stateFor: owned,
        isExecuting: (runId) => backgroundRuns.has(runId),
        readBody: () => readJson(req),
        resume: (state) => executePipeline(state, identity, null),
        schedule: (state) => scheduleExecution(state, identity),
        now: () => new Date().toISOString(),
      });
      if (publicationBiasResponse) {
        if (publicationBiasResponse.state) persistOwned(publicationBiasResponse.state, identity);
        json(res, publicationBiasResponse.status, publicationBiasResponse.payload);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/auth/orcid/start') {
        if (!options.orcidSessionManager) {
          json(res, 503, { error: 'ORCID OAuth is not configured' });
          return;
        }
        json(res, 200, options.orcidSessionManager.start());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/auth/orcid/callback') {
        if (!options.orcidSessionManager) {
          json(res, 503, { error: 'ORCID OAuth is not configured' });
          return;
        }
        const payload = await readJson(req) as { code?: unknown; state?: unknown };
        if (typeof payload.code !== 'string' || typeof payload.state !== 'string') {
          json(res, 400, { error: 'ORCID code and state are required' });
          return;
        }
        json(res, 200, await options.orcidSessionManager.complete(payload.code, payload.state));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/runs') {
        const payload = await readJson(req);
        if (!isReviewRequest(payload)) {
          json(res, 400, { error: 'Invalid ReviewRequest' });
          return;
        }
        const pending = createPipelineState(payload);
        persistOwned(pending, identity);
        scheduleExecution(pending, identity);
        json(res, 202, pending);
        return;
      }

      const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch?.[1]) {
        const state = owned(runMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        scheduleRecoveredResume(state, identity);
        json(res, 200, state);
        return;
      }

      const clarificationMatch = url.pathname.match(/^\/runs\/([^/]+)\/clarification$/);
      if (clarificationMatch?.[1]) {
        const state = owned(clarificationMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (req.method === 'GET') {
          const clarificationRequest = state.artifacts.clarificationRequest;
          if (!clarificationRequest) {
            json(res, 404, { error: 'No active clarification request' });
            return;
          }
          json(res, 200, {
            request: clarificationRequest,
            issues: state.artifacts.clarificationIssues ?? [],
            compilation: state.artifacts.reviewSpecCompilation ?? null,
          });
          return;
        }
        if (req.method === 'POST') {
          const submission = parseClarificationSubmission(await readJson(req));
          const resumed = await submitClarificationAndResume({
            state,
            submission,
            actor: { sub: identity.sub },
            resume: (pending) => executePipeline(pending, identity, null),
          });
          persistOwned(resumed, identity);
          json(res, responseStatus(resumed), resumed);
          return;
        }
      }

      const rob2Match = url.pathname.match(/^\/runs\/([^/]+)\/risk-of-bias$/);
      if (rob2Match?.[1]) {
        const state = owned(rob2Match[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (req.method === 'GET') {
          if (!state.artifacts.rob2EvidenceReviewPackage && !state.artifacts.rob2Assessments) {
            json(res, 404, { error: 'RoB 2 appraisal is not available for this run' });
            return;
          }
          json(res, 200, {
            reviewPackage: state.artifacts.rob2EvidenceReviewPackage ?? null,
            assessments: state.artifacts.rob2Assessments ?? [],
            quality: state.artifacts.rob2AppraisalQuality ?? null,
            capabilityBlock: state.artifacts.appraisalCapabilityBlock ?? null,
          });
          return;
        }
        if (req.method === 'POST') {
          const submission = parseRob2ReviewSubmission(await readJson(req));
          const resumed = await submitRob2ReviewAndResume({
            state,
            submission,
            actor: { sub: identity.sub },
            resume: (pending) => executePipeline(pending, identity, null),
          });
          persistOwned(resumed, identity);
          json(res, responseStatus(resumed), resumed);
          return;
        }
      }

      const gradePolicyMatch = url.pathname.match(/^\/runs\/([^/]+)\/grade\/policy$/);
      if (gradePolicyMatch?.[1]) {
        const state = owned(gradePolicyMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (req.method === 'GET') {
          json(res, 200, {
            policy: state.artifacts.gradePolicySet ?? null,
            amendments: state.artifacts.gradePolicyAmendments ?? [],
            lateAmendment: state.artifacts.gradePolicyLateAmendment ?? null,
          });
          return;
        }
        if (req.method === 'POST') {
          if (backgroundRuns.has(state.runId)) {
            json(res, 409, { error: 'Run is currently executing; GRADE policy cannot be mutated concurrently with a scientific stage.' });
            return;
          }
          const configuration = parseGradePolicyConfiguration(await readJson(req));
          const recorded = recordGradePolicyConfiguration({
            state,
            configuration,
            actorId: `user:${identity.sub}`,
            decidedAt: new Date().toISOString(),
          });
          persistOwned(state, identity);
          if (recorded.changed) scheduleExecution(state, identity);
          json(res, 202, { changed: recorded.changed, receipt: recorded.receipt, state });
          return;
        }
      }

      const gradeMatch = url.pathname.match(/^\/runs\/([^/]+)\/grade$/);
      if (gradeMatch?.[1]) {
        const state = owned(gradeMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (req.method === 'GET') {
          if (!state.artifacts.gradeEvidenceReviewPackage && !state.artifacts.gradeOutcomeAssessments && !state.artifacts.grade) {
            json(res, 404, { error: 'GRADE certainty assessment is not available for this run' });
            return;
          }
          json(res, 200, {
            reviewPackage: state.artifacts.gradeEvidenceReviewPackage ?? null,
            assessments: state.artifacts.gradeOutcomeAssessments ?? [],
            grade: state.artifacts.grade ?? [],
            quality: state.artifacts.gradeQuality ?? null,
            policy: state.artifacts.gradePolicySet ?? null,
            evidenceCatalog: buildGradeEvidenceCatalog(state),
            latePolicyAmendment: state.artifacts.gradePolicyLateAmendment ?? null,
          });
          return;
        }
        if (req.method === 'POST') {
          const submission = parseGradeReviewSubmission(await readJson(req));
          const resumed = await submitGradeReviewAndResume({
            state,
            submission,
            actor: { sub: identity.sub },
            resume: (pending) => executePipeline(pending, identity, null),
          });
          persistOwned(resumed, identity);
          json(res, responseStatus(resumed), resumed);
          return;
        }
      }

      const verifierRootMatch = url.pathname.match(/^\/runs\/([^/]+)\/verifier$/);
      if (req.method === 'GET' && verifierRootMatch?.[1]) {
        const state = owned(verifierRootMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        json(res, 200, buildVerifierRunView(state));
        return;
      }

      const verifierControlMatch = url.pathname.match(/^\/runs\/([^/]+)\/verifier\/(manifest|seal|lineage|attempts)$/);
      if (req.method === 'GET' && verifierControlMatch?.[1] && verifierControlMatch[2]) {
        const state = owned(verifierControlMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        const control = verifierControlMatch[2];
        const payload = control === 'manifest'
          ? verifierManifest(state)
          : control === 'seal'
            ? verifierSeal(state)
            : control === 'lineage'
              ? verifierLineage(state)
              : verifierAttempts(state);
        json(res, 200, payload);
        return;
      }

      const verifierArtifactMatch = url.pathname.match(/^\/runs\/([^/]+)\/verifier\/artifacts\/([^/]+)$/);
      if (req.method === 'GET' && verifierArtifactMatch?.[1] && verifierArtifactMatch[2]) {
        const state = owned(verifierArtifactMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        json(res, 200, verifierArtifact(state, decodeURIComponent(verifierArtifactMatch[2])));
        return;
      }

      const protocolMatch = url.pathname.match(/^\/runs\/([^/]+)\/protocol$/);
      if (req.method === 'GET' && protocolMatch?.[1]) {
        const state = owned(protocolMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (!state.artifacts.protocolPackage) {
          json(res, 404, { error: 'Protocol package not available' });
          return;
        }
        json(res, 200, state.artifacts.protocolPackage);
        return;
      }

      const registrationMatch = url.pathname.match(/^\/runs\/([^/]+)\/registration$/);
      if (req.method === 'GET' && registrationMatch?.[1]) {
        const state = owned(registrationMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        const plan = state.artifacts.registrationPlan;
        const ledger = state.artifacts.protocolRegistrationLedger;
        if (!plan || !ledger) {
          json(res, 404, { error: 'Registration artefacts not available' });
          return;
        }
        json(res, 200, { plan, receipts: state.artifacts.registrationReceipts ?? [], ledger });
        return;
      }

      const verificationMatch = url.pathname.match(/^\/runs\/([^/]+)\/verification$/);
      if (verificationMatch?.[1]) {
        const state = owned(verificationMatch[1]);
        if (!state) {
          json(res, 404, { error: 'Run not found' });
          return;
        }
        if (req.method === 'GET') {
          if (!state.artifacts.verificationPackage) {
            json(res, 404, { error: 'Verification package not available' });
            return;
          }
          json(res, 200, state.artifacts.verificationPackage);
          return;
        }
        if (req.method === 'POST') {
          const payload = await readJson(req);
          if (!isVerificationSubmission(payload)) {
            json(res, 400, { error: 'Invalid HumanVerificationSubmission' });
            return;
          }
          const port = new SubmittedHumanVerificationPort(payload);
          const resumed = await executePipeline(state, identity, port);
          persistOwned(resumed, identity);
          json(res, responseStatus(resumed), resumed);
          return;
        }
      }

      json(res, 404, { error: 'Not found' });
    } catch (error) {
      const status = Number((error as { status?: number }).status) || 500;
      json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;
  return certPath && keyPath
    ? createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, handler)
    : createHttpServer(handler);
}

export async function startServer(
  port = Number(process.env.PORT ?? 8787),
  options: ApiServerOptions = defaultApiServerOptions(),
): Promise<{ port: number; close(): Promise<void> }> {
  const server = createApiServer(options);
  const host = process.env.HOST ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const actualPort = (server.address() as AddressInfo).port;
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const running = await startServer();
  console.log(`Evidence Review API listening on ${process.env.TLS_CERT_PATH ? 'https' : 'http'}://127.0.0.1:${running.port}`);
}
