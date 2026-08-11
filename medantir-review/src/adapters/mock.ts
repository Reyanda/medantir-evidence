import type {
  EvidenceSourceAdapter,
  FullTextRetrievalPort,
  HumanVerificationPort,
  PdfTextExtractionPort,
  ProtocolRegistryAdapter,
  ResearcherIdentityPort,
} from '../core/ports.js';
import type {
  EvidenceRecord,
  EvidenceSectionName,
  FullTextDocument,
  HumanVerificationPackage,
  HumanVerificationSubmission,
  ParsedDocument,
  ParsedSection,
  SearchStrategy,
  ProtocolPackage,
  RegistrationReceipt,
  RegistrationSubmissionMode,
  RegistrationTarget,
  ResearcherIdentity,
  ReviewRequest,
} from '../core/types.js';

export class MockEvidenceSourceAdapter implements EvidenceSourceAdapter {
  constructor(
    public readonly database: string,
    private readonly records: EvidenceRecord[],
    private readonly warnings: string[] = [],
  ) {}

  async execute(strategy: SearchStrategy) {
    const records = this.records.map((record) => ({
      ...record,
      sourceDatabases: [...new Set([...record.sourceDatabases, this.database])],
    }));
    return {
      records,
      provenance: {
        database: this.database,
        platform: strategy.platform,
        executedQuery: strategy.query,
        executedAt: new Date().toISOString(),
        resultCount: records.length,
        exportFormat: 'JSON' as const,
        warnings: [...this.warnings],
      },
    };
  }
}

export class MockFullTextRetrieval implements FullTextRetrievalPort {
  constructor(private readonly missingIds = new Set<string>()) {}
  async retrieve(record: EvidenceRecord): Promise<FullTextDocument | null> {
    if (this.missingIds.has(record.id)) return null;
    return {
      recordId: record.id,
      uri: `mock://fulltext/${record.id}.pdf`,
      mimeType: 'application/pdf',
      content: [
        `Title\n${record.title}`,
        `Rationale\nSevere acute malnutrition remains associated with avoidable mortality, and uncertainty persists about how nutritional treatment strategies affect recovery and survival.`,
        `Objectives\nThe study aimed to evaluate nutritional treatment, recovery, and mortality among children with severe acute malnutrition.`,
        `Methods\nA ${record.abstract.toLowerCase().includes('random') ? 'randomised trial' : 'prospective cohort'} enrolled children with severe acute malnutrition and compared therapeutic food strategies with standard nutritional treatment.`,
        `Results\n${record.abstract} The primary outcome estimate was ${record.effect ?? 'not numerically reported'} with standard error ${record.standardError ?? 'not reported'}.`,
        `Discussion\nThe findings suggest that nutritional treatment may influence recovery and mortality, although interpretation depends on study design, context, and residual uncertainty.`,
        `Limitations\nThe study had limitations related to sample size, follow-up, contextual generalisability, and possible missing outcome data.`,
        `Funding\nFunded by a research programme.`,
      ].join('\n\n'),
      retrievedAt: new Date().toISOString(),
      legalAccessRoute: 'mock licensed/open-access route',
    };
  }
}

const headingMap: Record<string, EvidenceSectionName> = {
  rationale: 'rationale',
  background: 'rationale',
  introduction: 'rationale',
  objectives: 'objectives',
  objective: 'objectives',
  aims: 'objectives',
  aim: 'objectives',
  methods: 'methods',
  methodology: 'methods',
  results: 'results',
  findings: 'results',
  discussion: 'discussion',
  interpretation: 'discussion',
  limitations: 'limitations',
  limitation: 'limitations',
  funding: 'other',
  title: 'other',
};

function parseSections(text: string): ParsedSection[] {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const sections: ParsedSection[] = [];
  let page = 1;
  for (const block of blocks) {
    const [rawHeading = 'Other', ...bodyLines] = block.split('\n');
    const heading = rawHeading.trim();
    const body = bodyLines.join('\n').trim();
    const name = headingMap[heading.toLowerCase()] ?? 'other';
    sections.push({
      name,
      heading,
      pageStart: page,
      pageEnd: page,
      text: body || heading,
    });
    page += 1;
  }
  return sections;
}

export class MockPdfTextExtractor implements PdfTextExtractionPort {
  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    const text = document.content ?? '';
    if (!text) throw new Error(`No extractable content for ${document.recordId}`);
    const sections = parseSections(text);
    return {
      recordId: document.recordId,
      text,
      pages: sections.map((section) => ({ page: section.pageStart, text: `${section.heading}\n${section.text}` })),
      sections,
      extractionMethod: 'mock',
    };
  }
}

export class MockHumanVerificationPort implements HumanVerificationPort {
  constructor(
    private readonly reviewerId = 'mock-human-reviewer',
    private readonly decisionFactory?: (input: HumanVerificationPackage) => HumanVerificationSubmission,
  ) {}

  async review(input: HumanVerificationPackage): Promise<HumanVerificationSubmission> {
    if (this.decisionFactory) return this.decisionFactory(input);
    return {
      packageId: input.id,
      mode: input.mode,
      decisions: input.items.map((item) => ({
        itemId: item.id,
        verdict: 'accept' as const,
        rationale: `Accepted after checking the cited evidence for ${item.label}.`,
        reviewerId: this.reviewerId,
        decidedAt: new Date().toISOString(),
      })),
    };
  }
}

export class SubmittedHumanVerificationPort implements HumanVerificationPort {
  private consumed = false;
  constructor(private readonly submission: HumanVerificationSubmission) {}
  async review(): Promise<HumanVerificationSubmission | null> {
    if (this.consumed) return null;
    this.consumed = true;
    return this.submission;
  }
}


export class MockResearcherIdentityPort implements ResearcherIdentityPort {
  constructor(private readonly identity?: ResearcherIdentity) {}
  async resolve(request: ReviewRequest): Promise<ResearcherIdentity> {
    if (this.identity) return { ...this.identity, scopes: [...this.identity.scopes] };
    const configured = request.protocolDevelopment?.authors?.find((author) => author.corresponding) ?? request.protocolDevelopment?.authors?.[0];
    const displayName = configured ? `${configured.givenName} ${configured.familyName}` : 'Protocol Guarantor';
    const result: ResearcherIdentity = {
      displayName,
      authenticated: Boolean(configured?.orcid),
      authenticationProvider: configured?.orcid ? 'orcid' : 'local',
      scopes: configured?.orcid ? ['/authenticate'] : [],
    };
    if (configured?.orcid) result.orcid = configured.orcid;
    if (configured?.orcid) result.verifiedAt = new Date().toISOString();
    return result;
  }
}

export class MockProtocolRegistryAdapter implements ProtocolRegistryAdapter {
  constructor(public readonly target: RegistrationTarget) {}
  async register(input: {
    protocol: ProtocolPackage;
    request: ReviewRequest;
    identity: ResearcherIdentity;
    submissionMode: RegistrationSubmissionMode;
    credentialReference?: string;
  }): Promise<RegistrationReceipt> {
    const status = input.submissionMode === 'prepare-only'
      ? 'prepared' as const
      : input.submissionMode === 'draft'
        ? 'draft-created' as const
        : 'submitted' as const;
    return {
      target: this.target,
      status,
      externalId: `mock-${this.target}-${input.protocol.checksum.slice(0, 10)}`,
      url: `https://example.invalid/${this.target}/${input.protocol.checksum.slice(0, 10)}`,
      version: input.protocol.version,
      submittedAt: new Date().toISOString(),
      message: `Mock ${this.target} ${status}.`,
      protocolChecksum: input.protocol.checksum,
      metadata: { identityAuthenticated: input.identity.authenticated, secretsPersisted: false },
    };
  }
}
