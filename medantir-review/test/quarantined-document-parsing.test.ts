import test from 'node:test';
import assert from 'node:assert/strict';
import type { PdfTextExtractionPort } from '../src/core/ports.js';
import type { Agent, AgentContext, FullTextDocument, ParsedDocument } from '../src/core/types.js';
import {
  QuarantinedDocumentParsingAgent,
  UnresolvedEvidenceReportAgent,
  type DocumentParseFailure,
} from '../src/agents/quarantined-document-parsing.js';

function fullText(recordId: string): FullTextDocument {
  return {
    recordId,
    uri: `https://example.org/${recordId}`,
    mimeType: 'text/plain',
    content: `full text ${recordId}`,
    retrievedAt: '2026-08-09T00:00:00.000Z',
    legalAccessRoute: 'open access',
  };
}

function parsed(recordId: string): ParsedDocument {
  return {
    recordId,
    text: `parsed ${recordId}`,
    pages: [{ page: 1, text: `parsed ${recordId}` }],
    sections: [{ name: 'other', heading: 'Full text', pageStart: 1, pageEnd: 1, text: `parsed ${recordId}` }],
    extractionMethod: 'native',
  };
}

function context(fullTexts: FullTextDocument[]): AgentContext {
  return {
    state: {
      runId: 'run-1',
      request: {
        reviewType: 'systematic',
        databases: ['pubmed'],
        question: { title: 'Test review', objective: 'Test' },
      },
      stages: {} as AgentContext['state']['stages'],
      artifacts: { fullTexts },
      audit: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
    now: () => '2026-08-09T00:00:00.000Z',
  };
}

class SelectiveExtractor implements PdfTextExtractionPort {
  constructor(private readonly failures: Set<string>) {}
  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    if (this.failures.has(document.recordId)) throw new Error(`quality gate failed for ${document.recordId}`);
    return parsed(document.recordId);
  }
}

test('one unreadable document is quarantined while successful parses retain source order', async () => {
  const ctx = context([fullText('a'), fullText('b'), fullText('c')]);
  const agent = new QuarantinedDocumentParsingAgent(new SelectiveExtractor(new Set(['b'])), { concurrency: 2 });
  const result = await agent.execute(ctx);
  const documents = result.artifacts.parsedDocuments as ParsedDocument[];
  const failures = result.artifacts.documentParseFailures as DocumentParseFailure[];
  const quality = result.artifacts.documentParsingQuality as {
    requested: number;
    parsed: number;
    quarantinedUnresolved: number;
    unresolvedAreNotScreeningExclusions: boolean;
  };

  assert.deepEqual(documents.map((document) => document.recordId), ['a', 'c']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.recordId, 'b');
  assert.equal(failures[0]?.status, 'quarantined-unresolved');
  assert.match(failures[0]?.reason ?? '', /quality gate failed/);
  assert.deepEqual(quality, {
    requested: 3,
    parsed: 2,
    quarantinedUnresolved: 1,
    coverage: 2 / 3,
    failClosedAtDocumentLevel: true,
    unresolvedAreNotScreeningExclusions: true,
  });
  assert.ok(result.warnings?.some((warning) => /not counted as full-text screening exclusions/i.test(warning)));
});

test('the parse stage still fails closed when no retrieved full text is usable', async () => {
  const ctx = context([fullText('a'), fullText('b')]);
  const agent = new QuarantinedDocumentParsingAgent(new SelectiveExtractor(new Set(['a', 'b'])), { concurrency: 2 });

  await assert.rejects(
    () => agent.execute(ctx),
    /failed closed for all 2 retrieved full texts/,
  );
});

test('report discloses unresolved retrieval and parsing without fabricating exclusions', async () => {
  const ctx = context([]);
  ctx.state.artifacts.retrievalReport = { requested: 4, retrieved: 3, missing: ['missing-r1'] };
  ctx.state.artifacts.documentParseFailures = [{
    recordId: 'bad-r2',
    uri: 'https://example.org/bad-r2',
    mimeType: 'text/plain',
    legalAccessRoute: 'open access',
    status: 'quarantined-unresolved',
    reason: 'quality gate failed',
    requiredAction: 'higher-fidelity-lawful-fulltext-or-manual-verification',
  } satisfies DocumentParseFailure];
  ctx.state.artifacts.documentParsingQuality = {
    requested: 3,
    parsed: 2,
    quarantinedUnresolved: 1,
    coverage: 2 / 3,
    failClosedAtDocumentLevel: true,
    unresolvedAreNotScreeningExclusions: true,
  };

  const base: Agent = {
    stage: 'report',
    async execute() {
      return {
        artifacts: {
          draftReport: {
            title: 'Review',
            abstract: 'Base abstract.',
            prisma: { identified: 4, afterDeduplication: 4, tiabIncluded: 4, fullTextIncluded: 2 },
            sections: { limitations: 'Base limitation.' },
            appendices: {},
          },
        },
      };
    },
  };

  const result = await new UnresolvedEvidenceReportAgent(base).execute(ctx);
  const report = result.artifacts.draftReport as {
    abstract: string;
    sections: { limitations?: string };
    appendices: { unresolvedFullTexts?: { total: number; countedAsScreeningExclusions: boolean } };
  };

  assert.match(report.abstract, /2 full-text report\(s\) remain explicitly unresolved/);
  assert.match(report.sections.limitations ?? '', /were not treated as screening exclusions/);
  assert.equal(report.appendices.unresolvedFullTexts?.total, 2);
  assert.equal(report.appendices.unresolvedFullTexts?.countedAsScreeningExclusions, false);
});
