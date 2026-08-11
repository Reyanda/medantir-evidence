import type { FullTextRetrievalPort, PdfTextExtractionPort } from '../core/ports.js';
import type { EvidenceRecord, FullTextDocument, ParsedDocument } from '../core/types.js';
import { scientificContentHash } from '../core/canonical-hash.js';
import type { HistoricalFullTextArchiveReceipt, HistoricalParsedDocumentArchiveReceipt } from './evidence-plane-archive.js';
import { restoreHistoricalFullTexts, restoreHistoricalParsedDocuments } from './evidence-plane-archive.js';
import type { HistoricalObjectStorePort } from './object-archive.js';

export interface HistoricalParserCheckpoint {
  recordId: string;
  sourceObjectId: string;
  sourceSha256: string;
  parserContractHash: string;
  parsedObjectId: string;
  parsedDocumentHash: string;
}

export interface HistoricalParserReplayCertificate {
  recordId: string;
  sourceObjectMatches: boolean;
  parserContractMatches: boolean;
  parsedDocumentMatches: boolean;
  exact: boolean;
  expectedParsedHash: string;
  actualParsedHash?: string;
}

/**
 * Exact offline full-text retrieval. Any requested historical record without a
 * frozen receipt is an integrity failure, not an ordinary network miss.
 */
export class FrozenHistoricalFullTextRetrievalPort implements FullTextRetrievalPort {
  private readonly byRecord = new Map<string, HistoricalFullTextArchiveReceipt>();

  constructor(
    private readonly store: HistoricalObjectStorePort,
    receipts: HistoricalFullTextArchiveReceipt[],
  ) {
    for (const receipt of receipts) {
      if (this.byRecord.has(receipt.recordId)) throw new Error(`Duplicate historical full-text receipt '${receipt.recordId}'.`);
      this.byRecord.set(receipt.recordId, receipt);
    }
  }

  async retrieve(record: EvidenceRecord): Promise<FullTextDocument | null> {
    const receipt = this.byRecord.get(record.id);
    if (!receipt) throw new Error(`Exact historical replay has no frozen full-text object for '${record.id}'.`);
    const [document] = await restoreHistoricalFullTexts(this.store, [receipt]);
    if (!document || document.recordId !== record.id) throw new Error(`Historical full-text restoration identity mismatch for '${record.id}'.`);
    return document;
  }
}

/** Downstream-only replay of already frozen parser outputs. */
export class FrozenHistoricalParsedDocumentPort implements PdfTextExtractionPort {
  private readonly byRecord = new Map<string, HistoricalParsedDocumentArchiveReceipt>();

  constructor(
    private readonly store: HistoricalObjectStorePort,
    receipts: HistoricalParsedDocumentArchiveReceipt[],
  ) {
    for (const receipt of receipts) {
      if (this.byRecord.has(receipt.recordId)) throw new Error(`Duplicate historical parser receipt '${receipt.recordId}'.`);
      this.byRecord.set(receipt.recordId, receipt);
    }
  }

  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    const receipt = this.byRecord.get(document.recordId);
    if (!receipt) throw new Error(`Exact historical replay has no frozen parsed-document object for '${document.recordId}'.`);
    const [parsed] = await restoreHistoricalParsedDocuments(this.store, [receipt]);
    if (!parsed || parsed.recordId !== document.recordId) throw new Error(`Historical parsed-document restoration identity mismatch for '${document.recordId}'.`);
    return parsed;
  }
}

export function historicalParserCheckpoint(input: {
  fullText: HistoricalFullTextArchiveReceipt;
  parsed: HistoricalParsedDocumentArchiveReceipt;
  parserContractHash: string;
}): HistoricalParserCheckpoint {
  if (input.fullText.recordId !== input.parsed.recordId) throw new Error('Historical parser checkpoint cannot bind different source/parsed record IDs.');
  if (!input.parserContractHash.trim()) throw new Error(`Historical parser checkpoint '${input.fullText.recordId}' requires a parser contract hash.`);
  return {
    recordId: input.fullText.recordId,
    sourceObjectId: input.fullText.object.objectId,
    sourceSha256: input.fullText.object.sha256,
    parserContractHash: input.parserContractHash.trim().toLowerCase(),
    parsedObjectId: input.parsed.object.objectId,
    parsedDocumentHash: input.parsed.parsedDocumentHash,
  };
}

/**
 * Re-run parsing from immutable historical source bytes and compare the output
 * with the frozen parsed checkpoint. This verifies parser semantics rather than
 * merely reusing old parsed JSON.
 */
export async function verifyHistoricalParserReplay(input: {
  store: HistoricalObjectStorePort;
  fullTextReceipt: HistoricalFullTextArchiveReceipt;
  parsedReceipt: HistoricalParsedDocumentArchiveReceipt;
  checkpoint: HistoricalParserCheckpoint;
  parser: PdfTextExtractionPort;
  parserContractHash: string;
}): Promise<HistoricalParserReplayCertificate> {
  const [document] = await restoreHistoricalFullTexts(input.store, [input.fullTextReceipt]);
  if (!document) throw new Error(`Historical parser replay source '${input.checkpoint.recordId}' could not be restored.`);
  const sourceObjectMatches = input.fullTextReceipt.object.objectId === input.checkpoint.sourceObjectId
    && input.fullTextReceipt.object.sha256 === input.checkpoint.sourceSha256;
  const parserContractMatches = input.parserContractHash.trim().toLowerCase() === input.checkpoint.parserContractHash;
  let actualParsedHash: string | undefined;
  let parsedDocumentMatches = false;
  if (sourceObjectMatches && parserContractMatches) {
    const parsed = await input.parser.extract(document);
    actualParsedHash = scientificContentHash(parsed);
    parsedDocumentMatches = actualParsedHash === input.checkpoint.parsedDocumentHash
      && input.parsedReceipt.parsedDocumentHash === input.checkpoint.parsedDocumentHash;
  }
  return {
    recordId: input.checkpoint.recordId,
    sourceObjectMatches,
    parserContractMatches,
    parsedDocumentMatches,
    exact: sourceObjectMatches && parserContractMatches && parsedDocumentMatches,
    expectedParsedHash: input.checkpoint.parsedDocumentHash,
    ...(actualParsedHash ? { actualParsedHash } : {}),
  };
}
