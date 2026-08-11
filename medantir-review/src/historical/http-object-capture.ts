import { scientificContentHash } from '../core/canonical-hash.js';
import type {
  HistoricalArchiveObjectMetadata,
  HistoricalArchiveObjectReceipt,
  HistoricalObjectStorePort,
} from './object-archive.js';

export interface HistoricalHttpCaptureReceipt {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  object: HistoricalArchiveObjectReceipt;
  responseContractHash: string;
  capturedAt: string;
}

function responseContract(receipt: Omit<HistoricalHttpCaptureReceipt, 'responseContractHash' | 'capturedAt'>): unknown {
  return {
    requestedUrl: receipt.requestedUrl,
    finalUrl: receipt.finalUrl,
    status: receipt.status,
    contentType: receipt.contentType ?? null,
    etag: receipt.etag ?? null,
    lastModified: receipt.lastModified ?? null,
    objectId: receipt.object.objectId,
    objectSha256: receipt.object.sha256,
    byteLength: receipt.object.byteLength,
  };
}

export async function captureHistoricalHttpObject(input: {
  store: HistoricalObjectStorePort;
  url: string;
  metadata: HistoricalArchiveObjectMetadata;
  fetchImpl?: typeof fetch;
  capturedAt?: string;
}): Promise<HistoricalHttpCaptureReceipt> {
  const requestedUrl = input.url.trim();
  if (!/^https:\/\//i.test(requestedUrl)) throw new Error('Historical HTTP capture requires an HTTPS URL.');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(requestedUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: { accept: '*/*' },
  });
  if (!response.ok) throw new Error(`Historical HTTP capture failed for ${requestedUrl} with HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error(`Historical HTTP capture returned an empty body for ${requestedUrl}.`);
  const object = await input.store.put(bytes, {
    ...input.metadata,
    sourceUri: requestedUrl,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  });
  const base: Omit<HistoricalHttpCaptureReceipt, 'responseContractHash' | 'capturedAt'> = {
    requestedUrl,
    finalUrl: response.url || requestedUrl,
    status: response.status,
    ...(response.headers.get('content-type') ? { contentType: response.headers.get('content-type')! } : {}),
    ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified')! } : {}),
    object,
  };
  return {
    ...base,
    responseContractHash: scientificContentHash(responseContract(base)),
    capturedAt: input.capturedAt ?? object.capturedAt ?? new Date().toISOString(),
  };
}
