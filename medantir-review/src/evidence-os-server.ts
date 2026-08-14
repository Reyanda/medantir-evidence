import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PipelineState } from './core/types.js';
import {
  createApiServer,
  type ApiServerOptions,
  type RequestIdentity,
} from './server.js';
import { handleEvidenceOsApi } from './evidence-os/api.js';
import { FileEvidenceGraphRepository } from './evidence-os/file-repository.js';
import type { SingleReplicaWorkflowRuntime } from './evidence-os/runtime.js';
import { createSemanticEmbeddingPortFromEnvironment } from './semantic/embedding.js';
import { FileSemanticIndexRepository } from './semantic/repository.js';
import { SemanticIndexService } from './semantic/service.js';
import type { SemanticIndexServicePort } from './semantic/types.js';

interface OwnedRun {
  ownerSub: string;
  projectId: string;
  state: PipelineState;
}

export interface EvidenceOsServerOptions extends ApiServerOptions {
  evidenceOsRuntime?: SingleReplicaWorkflowRuntime;
  evidenceGraphRepository?: FileEvidenceGraphRepository;
  semanticIndexService?: SemanticIndexServicePort;
}

function response(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': process.env.CORS_ORIGINS ?? '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-actiora-project',
  });
  res.end(body);
}

function evidenceOsPath(pathname: string): boolean {
  return /^\/evidence-os\/(architecture|openapi|extraction-field-contracts|semantic-capabilities)$/.test(pathname)
    || /^\/runs\/[^/]+\/(evidence-os|evidence-graph|workflow-plan|cost-ledger|tokenisation-manifest|extraction-validation|reproducibility-bundle|semantic-index-manifest|semantic-units|semantic-clusters|semantic-search)$/.test(pathname)
    || /^\/runs\/[^/]+\/(evidence-objects|artifact-tokens|semantic-units|semantic-clusters)\/[^/]+$/.test(pathname)
    || /^\/runs\/[^/]+\/semantic-index\/rebuild$/.test(pathname);
}

function publicEvidenceOsPath(pathname: string): boolean {
  return /^\/evidence-os\/(architecture|openapi|extraction-field-contracts|semantic-capabilities)$/.test(pathname);
}

async function readJsonBody(req: IncomingMessage, maximumBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBytes) throw Object.assign(new Error('JSON request body exceeds 1 MiB.'), { status: 413 });
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must contain valid JSON.'), { status: 400 });
  }
}

async function loadOwnedRun(
  runsFile: string,
  identity: RequestIdentity,
  runId: string,
): Promise<PipelineState | undefined> {
  try {
    const entries = JSON.parse(await readFile(runsFile, 'utf8')) as Array<[string, OwnedRun]>;
    const owned = new Map(entries).get(runId);
    return owned?.ownerSub === identity.sub && owned.projectId === identity.projectId
      ? structuredClone(owned.state)
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function createEvidenceOsApiServer(options: EvidenceOsServerOptions = {}) {
  const { evidenceOsRuntime, evidenceGraphRepository, semanticIndexService, ...apiOptions } = options;
  const server = createApiServer(apiOptions);
  const delegate = server.listeners('request')[0] as RequestListener | undefined;
  if (!delegate) throw new Error('Review API server did not register a request handler.');
  server.removeAllListeners('request');
  const runsFile = apiOptions.runsFile ?? process.env.RUNS_FILE ?? '/data/runs.json';
  const durabilityRoot = apiOptions.durabilityRuntime?.rootDir
    ?? apiOptions.durabilityRoot
    ?? process.env.REVIEW_DURABILITY_ROOT
    ?? join(dirname(runsFile), 'review-durability');
  const graphRepository = evidenceGraphRepository
    ?? apiOptions.durabilityRuntime?.evidenceGraphs
    ?? new FileEvidenceGraphRepository({ rootDir: durabilityRoot });
  const semanticService = semanticIndexService ?? new SemanticIndexService({
    repository: new FileSemanticIndexRepository({ rootDir: durabilityRoot }),
    embeddingPort: createSemanticEmbeddingPortFromEnvironment(),
  });

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS' || !evidenceOsPath(url.pathname)) {
        delegate(req, res);
        return;
      }

      let identity: RequestIdentity | undefined;
      if (!publicEvidenceOsPath(url.pathname)) {
        if (!apiOptions.identityProvider) {
          response(res, 503, { error: 'Authentication is not configured' });
          return;
        }
        try {
          identity = await apiOptions.identityProvider.authenticate(req);
        } catch (error) {
          response(res, Number((error as { status?: number }).status) || 401, {
            error: error instanceof Error ? error.message : 'Unauthorized',
          });
          return;
        }
      }

      let body: unknown;
      if (req.method === 'POST') {
        try {
          body = await readJsonBody(req);
        } catch (error) {
          response(res, Number((error as { status?: number }).status) || 400, {
            error: error instanceof Error ? error.message : 'Invalid request body',
          });
          return;
        }
      }

      const handled = await handleEvidenceOsApi({
        ...(req.method ? { method: req.method } : {}),
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        ...(body !== undefined ? { body } : {}),
        stateFor: async (runId) => identity ? loadOwnedRun(runsFile, identity, runId) : undefined,
        graphFor: async (runId, state) => {
          const graph = await graphRepository.getGraph(runId);
          return graph?.metadata.updatedAt === state.updatedAt ? graph : null;
        },
        semanticIndexService: semanticService,
        ...(evidenceOsRuntime ? { runtimeSnapshot: () => evidenceOsRuntime.snapshot() } : {}),
      });
      if (!handled) {
        delegate(req, res);
        return;
      }
      response(res, handled.status, handled.payload);
    })().catch((error) => {
      if (!res.headersSent) response(res, 500, { error: error instanceof Error ? error.message : String(error) });
      else res.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  return server;
}

export async function startEvidenceOsServer(
  port: number,
  options: EvidenceOsServerOptions,
): Promise<{ port: number; close(): Promise<void> }> {
  const server = createEvidenceOsApiServer(options);
  const host = process.env.HOST ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const actualPort = (server.address() as AddressInfo).port;
  return {
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
