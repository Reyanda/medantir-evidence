import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import type { PipelineState } from './core/types.js';
import {
  createApiServer,
  type ApiServerOptions,
  type RequestIdentity,
} from './server.js';
import { handleEvidenceOsApi } from './evidence-os/api.js';
import type { SingleReplicaWorkflowRuntime } from './evidence-os/runtime.js';

interface OwnedRun {
  ownerSub: string;
  projectId: string;
  state: PipelineState;
}

export interface EvidenceOsServerOptions extends ApiServerOptions {
  evidenceOsRuntime?: SingleReplicaWorkflowRuntime;
}

function response(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-origin': process.env.CORS_ORIGINS ?? '*',
  });
  res.end(body);
}

function evidenceOsPath(pathname: string): boolean {
  return pathname === '/evidence-os/architecture'
    || pathname === '/evidence-os/openapi'
    || /^\/runs\/[^/]+\/(evidence-os|evidence-graph|workflow-plan|cost-ledger|reproducibility-bundle)$/.test(pathname)
    || /^\/runs\/[^/]+\/evidence-objects\/[^/]+$/.test(pathname);
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

/**
 * Wraps the existing review API without duplicating its write paths. Evidence OS
 * routes are read-only projections over the same atomically persisted run state;
 * all other requests are delegated to the original authenticated server.
 */
export function createEvidenceOsApiServer(options: EvidenceOsServerOptions = {}) {
  const { evidenceOsRuntime, ...apiOptions } = options;
  const server = createApiServer(apiOptions);
  const delegate = server.listeners('request')[0] as RequestListener | undefined;
  if (!delegate) throw new Error('Review API server did not register a request handler.');
  server.removeAllListeners('request');
  const runsFile = apiOptions.runsFile ?? process.env.RUNS_FILE ?? '/data/runs.json';

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'OPTIONS' || !evidenceOsPath(url.pathname)) {
        delegate(req, res);
        return;
      }

      let identity: RequestIdentity | undefined;
      const publicRoute = url.pathname === '/evidence-os/architecture' || url.pathname === '/evidence-os/openapi';
      if (!publicRoute) {
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

      const handled = await handleEvidenceOsApi({
        ...(req.method ? { method: req.method } : {}),
        pathname: url.pathname,
        stateFor: async (runId) => identity ? loadOwnedRun(runsFile, identity, runId) : undefined,
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
