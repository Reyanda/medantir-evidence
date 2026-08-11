import type { FullTextDocument, ParsedDocument } from '../core/types.js';
import { scientificContentHash } from '../core/canonical-hash.js';
import {
  archiveUtf8HistoricalObject,
  readUtf8HistoricalObject,
  type HistoricalArchiveObjectReceipt,
  type HistoricalObjectStorePort,
} from './object-archive.js';

export interface HistoricalFullTextArchiveReceipt {
  recordId: string;
  mimeType: FullTextDocument['mimeType'];
  sourceUri: string;
  legalAccessRoute: string;
  retrievedAt: string;
  object: HistoricalArchiveObjectReceipt;
  metadataHash: string;
}

export interface HistoricalParsedDocumentArchiveReceipt {
  recordId: string;
  extractionMethod: ParsedDocument['extractionMethod'];
  object: HistoricalArchiveObjectReceipt;
  parsedDocumentHash: string;
}

export interface HistoricalVerifierObjectReceipt {
  objectId: string;
  sha256: string;
  byteLength: number;
  role: HistoricalArchiveObjectReceipt['role'];
  mediaType: string;
  recordId?: string;
  legalAccessRoute?: string;
  accessClass: HistoricalArchiveObjectReceipt['accessClass'];
}

export function verifierHistoricalObjectReceipt(
  receipt: HistoricalArchiveObjectReceipt,
): HistoricalVerifierObjectReceipt {
  return {
    objectId: receipt.objectId,
    sha256: receipt.sha256,
    byteLength: receipt.byteLength,
    role: receipt.role,
    mediaType: receipt.mediaType,
    ...(receipt.recordId ? { recordId: receipt.recordId } : {}),
    ...(receipt.legalAccessRoute ? { legalAccessRoute: receipt.legalAccessRoute } : {}),
    accessClass: receipt.accessClass,
  };
}

export async function archiveHistoricalFullTexts(
  store: HistoricalObjectStorePort,
  documents: FullTextDocument[],
): Promise<HistoricalFullTextArchiveReceipt[]> {
  const receipts: HistoricalFullTextArchiveReceipt[] = [];
  for (const document of documents) {
    if (typeof document.content !== 'string') {
      throw new Error(`Historical full-text '${document.recordId}' has no captured body and cannot be frozen exactly.`);
    }
    const object = await archiveUtf8HistoricalObject(store, document.content, {
      role: 'fulltext-source',
      mediaType: document.mimeType,
      recordId: document.recordId,
      sourceUri: document.uri,
      legalAccessRoute: document.legalAccessRoute,
      accessClass: 'restricted-source',
      capturedAt: document.retrievedAt,
    });
    const metadataHash = scientificContentHash({
      recordId: document.recordId,
      uri: document.uri,
      mimeType: document.mimeType,
      legalAccessRoute: document.legalAccessRoute,
      objectId: object.objectId,
    });
    receipts.push({
      recordId: document.recordId,
      mimeType: document.mimeType,
      sourceUri: document.uri,
      legalAccessRoute: document.legalAccessRoute,
      retrievedAt: document.retrievedAt,
      object,
      metadataHash,
    });
  }
  return receipts;
}

export async function restoreHistoricalFullTexts(
  store: HistoricalObjectStorePort,
  receipts: HistoricalFullTextArchiveReceipt[],
): Promise<FullTextDocument[]> {
  const documents: FullTextDocument[] = [];
  for (const receipt of receipts) {
    const expectedMetadataHash = scientificContentHash({
      recordId: receipt.recordId,
      uri: receipt.sourceUri,
      mimeType: receipt.mimeType,
      legalAccessRoute: receipt.legalAccessRoute,
      objectId: receipt.object.objectId,
    });
    if (expectedMetadataHash !== receipt.metadataHash) {
      throw new Error(`Historical full-text receipt '${receipt.recordId}' failed metadata integrity verification.`);
    }
    const content = await readUtf8HistoricalObject(store, receipt.object);
    documents.push({
      recordId: receipt.recordId,
      uri: receipt.sourceUri,
      mimeType: receipt.mimeType,
      content,
      retrievedAt: receipt.retrievedAt,
      legalAccessRoute: receipt.legalAccessRoute,
    });
  }
  return documents;
}

export async function archiveHistoricalParsedDocuments(
  store: HistoricalObjectStorePort,
  documents: ParsedDocument[],
): Promise<HistoricalParsedDocumentArchiveReceipt[]> {
  const receipts: HistoricalParsedDocumentArchiveReceipt[] = [];
  for (const document of documents) {
    const canonical = JSON.stringify(document);
    const object = await archiveUtf8HistoricalObject(store, canonical, {
      role: 'parser-output',
      mediaType: 'application/json',
      recordId: document.recordId,
      accessClass: 'verifier-receipt-only',
    });
    receipts.push({
      recordId: document.recordId,
      extractionMethod: document.extractionMethod,
      object,
      parsedDocumentHash: scientificContentHash(document),
    });
  }
  return receipts;
}

export async function restoreHistoricalParsedDocuments(
  store: HistoricalObjectStorePort,
  receipts: HistoricalParsedDocumentArchiveReceipt[],
): Promise<ParsedDocument[]> {
  const documents: ParsedDocument[] = [];
  for (const receipt of receipts) {
    const text = await readUtf8HistoricalObject(store, receipt.object);
    const document = JSON.parse(text) as ParsedDocument;
    if (document.recordId !== receipt.recordId) {
      throw new Error(`Historical parser-output receipt '${receipt.recordId}' restored a different record ID.`);
    }
    if (scientificContentHash(document) !== receipt.parsedDocumentHash) {
      throw new Error(`Historical parser-output receipt '${receipt.recordId}' failed canonical document hash verification.`);
    }
    documents.push(document);
  }
  return documents;
}
