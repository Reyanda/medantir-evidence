import type { PdfTextExtractionPort } from '../core/ports.js';
import type { Agent, AgentContext, AgentResult, FinalReport, FullTextDocument, ParsedDocument, ScreeningDecision } from '../core/types.js';

export interface DocumentParseFailure {
  recordId: string;
  uri: string;
  mimeType: string;
  legalAccessRoute: string;
  status: 'quarantined-unresolved';
  reason: string;
  requiredAction: 'higher-fidelity-lawful-fulltext-or-manual-verification';
}

export interface DocumentParsingQuality {
  requested: number;
  parsed: number;
  quarantinedUnresolved: number;
  coverage: number;
  failClosedAtDocumentLevel: true;
  unresolvedAreNotScreeningExclusions: true;
}

export interface QuarantinedDocumentParsingOptions { concurrency?: number; }

export class QuarantinedDocumentParsingAgent implements Agent {
  readonly stage = 'pdf-to-text' as const;
  private readonly concurrency: number;
  constructor(private readonly extractor: PdfTextExtractionPort, options: QuarantinedDocumentParsingOptions = {}) {
    this.concurrency = Math.max(1, Math.min(8, options.concurrency ?? Number(process.env.DOCUMENT_PARSE_CONCURRENCY ?? 4)));
  }

  async execute(context: AgentContext): Promise<AgentResult> {
    const fullTexts = context.state.artifacts.fullTexts as FullTextDocument[] | undefined;
    if (!fullTexts) throw new Error('Document parsing requires the fullTexts artifact.');
    const parsedByIndex = new Array<ParsedDocument | undefined>(fullTexts.length);
    const failuresByIndex = new Array<DocumentParseFailure | undefined>(fullTexts.length);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= fullTexts.length) return;
        const document = fullTexts[index]!;
        try { parsedByIndex[index] = await this.extractor.extract(document); }
        catch (error) {
          failuresByIndex[index] = {
            recordId: document.recordId, uri: document.uri, mimeType: document.mimeType,
            legalAccessRoute: document.legalAccessRoute, status: 'quarantined-unresolved',
            reason: error instanceof Error ? error.message : String(error),
            requiredAction: 'higher-fidelity-lawful-fulltext-or-manual-verification',
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, fullTexts.length)) }, () => worker()));
    const parsedDocuments = parsedByIndex.filter((document): document is ParsedDocument => Boolean(document));
    const documentParseFailures = failuresByIndex.filter((failure): failure is DocumentParseFailure => Boolean(failure));
    if (fullTexts.length > 0 && parsedDocuments.length === 0) {
      throw new Error(`Document parsing failed closed for all ${fullTexts.length} retrieved full texts. ${documentParseFailures.length} report(s) require higher-fidelity lawful retrieval or manual verification.`);
    }
    const quality: DocumentParsingQuality = {
      requested: fullTexts.length, parsed: parsedDocuments.length,
      quarantinedUnresolved: documentParseFailures.length,
      coverage: fullTexts.length > 0 ? parsedDocuments.length / fullTexts.length : 1,
      failClosedAtDocumentLevel: true, unresolvedAreNotScreeningExclusions: true,
    };
    return {
      artifacts: { parsedDocuments, documentParseFailures, documentParsingQuality: quality },
      warnings: documentParseFailures.length > 0 ? [
        `${documentParseFailures.length} retrieved full-text document(s) were quarantined as unresolved after document-intelligence quality failure.`,
        'Quarantined documents are not counted as full-text screening exclusions and cannot enter extraction or synthesis.',
      ] : [],
    };
  }
}

/** Makes every unresolved full-text state visible in the scientific report. */
export class UnresolvedEvidenceReportAgent implements Agent {
  readonly stage = 'report' as const;
  constructor(private readonly base: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const result = await this.base.execute(context);
    const draft = result.artifacts.draftReport as FinalReport | undefined;
    if (!draft) return result;
    const retrieval = context.state.artifacts.retrievalReport as { missing?: string[] } | undefined;
    const parseFailures = (context.state.artifacts.documentParseFailures ?? []) as DocumentParseFailure[];
    const decisions = (context.state.artifacts.fullTextDecisions ?? []) as ScreeningDecision[];
    const uncertainEligibility = decisions.filter((decision) => decision.decision === 'uncertain').map((decision) => ({
      recordId: decision.recordId, reason: decision.reason, confidence: decision.confidence,
    }));
    const missingRetrieval = retrieval?.missing ?? [];
    const unresolvedCount = missingRetrieval.length + parseFailures.length + uncertainEligibility.length;
    if (unresolvedCount === 0) return result;

    const limitation = `${unresolvedCount} report(s) remained unresolved at full text and were not treated as screening exclusions: ${missingRetrieval.length} were not lawfully retrieved, ${parseFailures.length} failed document-intelligence quality gates, and ${uncertainEligibility.length} were parsed but lacked sufficient eligibility evidence for automatic inclusion. These reports did not enter extraction or synthesis and require higher-fidelity retrieval or verification.`;
    const enriched: FinalReport = {
      ...draft,
      abstract: `${draft.abstract} ${unresolvedCount} full-text report(s) remain explicitly unresolved and are not silently classified.`,
      sections: { ...draft.sections, limitations: [draft.sections.limitations, limitation].filter(Boolean).join('\n') },
      appendices: {
        ...draft.appendices,
        unresolvedFullTexts: {
          total: unresolvedCount,
          notRetrievedRecordIds: missingRetrieval,
          parseFailures,
          uncertainEligibility,
          scientificStatus: 'awaiting-classification-or-higher-fidelity-source',
          countedAsScreeningExclusions: false,
        },
        documentParsingQuality: context.state.artifacts.documentParsingQuality ?? null,
      },
    };
    return {
      ...result,
      artifacts: { ...result.artifacts, draftReport: enriched },
      warnings: [...(result.warnings ?? []), `${unresolvedCount} full-text report(s) remain unresolved and are disclosed rather than silently classified.`],
    };
  }
}
