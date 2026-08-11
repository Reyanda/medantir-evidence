// real.ts — production adapters wiring the engine's ports to Medantir's live,
// keyless open-data services. No access-control bypass: only OA/keyless routes.
import type { EvidenceSourceAdapter, FullTextRetrievalPort, PdfTextExtractionPort, ResearcherIdentityPort } from '../core/ports.js';
import type { EvidenceRecord, EvidenceSectionName, FullTextDocument, ParsedDocument, ParsedSection, ResearcherIdentity, ReviewRequest, SearchProvenance, SearchStrategy } from '../core/types.js';

// Lightweight IMRaD section detection over stripped full text (EPMC XML / PDF text
// arrives as one blob without paragraph structure). We locate known heading words,
// slice between boundaries, and map each to the engine's evidence section vocabulary
// so the extraction/RoB agents can bind quotes to sections. No headings found → one
// 'other' section (extraction still runs, just warns on missing evidence).
const SECTION_MARKERS: Array<{ re: RegExp; name: EvidenceSectionName; heading: string }> = [
  { re: /\b(?:background|introduction|rationale)\b/i, name: 'rationale', heading: 'Introduction' },
  { re: /\b(?:objective|objectives|aim|aims|purpose)\b/i, name: 'objectives', heading: 'Objectives' },
  { re: /\b(?:methods?|materials and methods|study design|methodology)\b/i, name: 'methods', heading: 'Methods' },
  { re: /\b(?:results|findings)\b/i, name: 'results', heading: 'Results' },
  { re: /\b(?:discussion|interpretation)\b/i, name: 'discussion', heading: 'Discussion' },
  { re: /\b(?:limitations?)\b/i, name: 'limitations', heading: 'Limitations' },
  { re: /\b(?:conclusions?)\b/i, name: 'discussion', heading: 'Conclusion' },
];

function deriveSections(text: string): ParsedSection[] {
  const hits = SECTION_MARKERS
    .map((m) => ({ ...m, at: text.search(m.re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (hits.length === 0) {
    return [{ name: 'other', heading: 'Full text', pageStart: 1, pageEnd: 1, text: text.slice(0, 6000) }];
  }
  const sections: ParsedSection[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]!.at;
    const end = i + 1 < hits.length ? hits[i + 1]!.at : text.length;
    const body = text.slice(start, end).trim();
    if (body) sections.push({ name: hits[i]!.name, heading: hits[i]!.heading, pageStart: i + 1, pageEnd: i + 1, text: body.slice(0, 4000) });
  }
  return sections;
}

function invertAbstract(inv: Record<string, number[]> | undefined): string {
  if (!inv) return '';
  const words: string[] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
  return words.join(' ').slice(0, 1200);
}
const cleanDoi = (d?: string) => (d ? d.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : undefined);
const prov = (database: string, platform: string, strategy: SearchStrategy, count: number, warnings: string[] = []): SearchProvenance => ({
  database, platform, executedQuery: strategy.query, executedAt: new Date().toISOString(), resultCount: count, exportFormat: 'JSON', warnings,
});

// A typed name or ORCID in a request is not proof of authentication. The live
// pipeline stays unauthenticated until an ORCID OAuth session can be bound to a
// run through the future gateway vault/session layer.
export class UnauthenticatedResearcherIdentityPort implements ResearcherIdentityPort {
  async resolve(request: ReviewRequest): Promise<ResearcherIdentity> {
    const author = request.protocolDevelopment?.authors?.find((item) => item.corresponding)
      ?? request.protocolDevelopment?.authors?.[0];
    return {
      displayName: author ? `${author.givenName} ${author.familyName}` : 'Protocol guarantor not yet authenticated',
      authenticated: false,
      authenticationProvider: 'none',
      scopes: [],
    };
  }
}

/** OpenAlex — 250M works, keyless. */
export class OpenAlexAdapter implements EvidenceSourceAdapter {
  readonly database = 'openalex';
  constructor(private readonly n = 50) {}
  async execute(strategy: SearchStrategy) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(strategy.query)}&per_page=${this.n}&mailto=medantir@medantir.local`;
    const res = await fetch(url);
    const d: any = res.ok ? await res.json() : { results: [] };
    const records: EvidenceRecord[] = (d.results ?? []).map((w: any) => ({
      id: cleanDoi(w.doi) ?? String(w.id ?? '').toLowerCase(),
      title: w.title ?? '', abstract: invertAbstract(w.abstract_inverted_index),
      authors: (w.authorships ?? []).slice(0, 10).map((a: any) => a.author?.display_name).filter(Boolean),
      year: w.publication_year ?? 0, journal: w.primary_location?.source?.display_name,
      doi: cleanDoi(w.doi), sourceDatabases: ['openalex'],
    }));
    return { records, provenance: prov('openalex', 'OpenAlex API', strategy, records.length, res.ok ? [] : [`HTTP ${res.status}`]) };
  }
}

/** Europe PMC — biomedical + OA full text, keyless (resultType=core for abstract). */
export class EuropePmcAdapter implements EvidenceSourceAdapter {
  readonly database = 'europepmc';
  constructor(private readonly n = 50) {}
  async execute(strategy: SearchStrategy) {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(strategy.query)}&format=json&resultType=core&pageSize=${this.n}`;
    const res = await fetch(url);
    const d: any = res.ok ? await res.json() : {};
    const list = d?.resultList?.result ?? [];
    const records: EvidenceRecord[] = list.map((r: any) => ({
      id: cleanDoi(r.doi) ?? (r.pmid ? `pmid:${r.pmid}` : String(r.id ?? '').toLowerCase()),
      title: r.title ?? '', abstract: r.abstractText ?? '',
      authors: r.authorString ? String(r.authorString).split(', ').slice(0, 10) : [],
      year: r.pubYear ? Number(r.pubYear) : 0, journal: r.journalTitle,
      doi: cleanDoi(r.doi), pmid: r.pmid, sourceDatabases: ['europepmc'],
      keywords: r.pmcid ? [`pmcid:${r.pmcid}`, r.isOpenAccess === 'Y' ? 'oa' : 'closed'] : undefined,
    }));
    return { records, provenance: prov('europepmc', 'Europe PMC API', strategy, records.length, res.ok ? [] : [`HTTP ${res.status}`]) };
  }
}

/** Crossref — DOI metadata authority, keyless. */
export class CrossrefAdapter implements EvidenceSourceAdapter {
  readonly database = 'crossref';
  constructor(private readonly n = 50) {}
  async execute(strategy: SearchStrategy) {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(strategy.query)}&rows=${this.n}&mailto=medantir@medantir.local`;
    const res = await fetch(url);
    const d: any = res.ok ? await res.json() : {};
    const items = d?.message?.items ?? [];
    const records: EvidenceRecord[] = items.map((w: any) => ({
      id: cleanDoi(w.DOI) ?? '', title: Array.isArray(w.title) ? w.title[0] : (w.title ?? ''), abstract: (w.abstract ?? '').replace(/<[^>]+>/g, ''),
      authors: (w.author ?? []).slice(0, 10).map((a: any) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean),
      year: w.issued?.['date-parts']?.[0]?.[0] ?? 0, journal: Array.isArray(w['container-title']) ? w['container-title'][0] : undefined,
      doi: cleanDoi(w.DOI), sourceDatabases: ['crossref'],
    }));
    return { records, provenance: prov('crossref', 'Crossref API', strategy, records.length, res.ok ? [] : [`HTTP ${res.status}`]) };
  }
}

export function evidenceAdapterFor(database: string, n = 50): EvidenceSourceAdapter {
  switch (database.toLowerCase()) {
    case 'europepmc': case 'pubmed': return new EuropePmcAdapter(n);
    case 'crossref': return new CrossrefAdapter(n);
    default: return new OpenAlexAdapter(n);
  }
}

/** Full-text retrieval via Europe PMC open access (keyless; only OA content). */
export class EpmcFullTextRetrieval implements FullTextRetrievalPort {
  async retrieve(record: EvidenceRecord): Promise<FullTextDocument | null> {
    let pmcid = (record.keywords ?? []).find((k) => k.startsWith('pmcid:'))?.slice(6);
    if (!pmcid && record.doi) {
      const s = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:${encodeURIComponent(record.doi)}&format=json&resultType=core&pageSize=1`);
      if (s.ok) { const d: any = await s.json(); pmcid = d?.resultList?.result?.[0]?.pmcid; }
    }
    if (!pmcid) return null;
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`);
    if (!res.ok) return null;
    const xml = await res.text();
    const body = (xml.match(/<body[\s\S]*?<\/body>/i) ?? [xml])[0]
      .replace(/<[^>]+>/g, ' ').replace(/&#\d+;|&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (body.length < 400) return null;
    return { recordId: record.id, uri: `https://europepmc.org/article/PMC/${pmcid}`, mimeType: 'text/plain', content: body, retrievedAt: new Date().toISOString(), legalAccessRoute: 'Europe PMC open access' };
  }
}

/** PDF → text via the deployed LiteParse service (api.actiora.com/parse). Native
 *  text (EPMC XML already stripped) passes through without a round-trip. */
export class LiteParsePdfExtractor implements PdfTextExtractionPort {
  constructor(private readonly endpoint = process.env.PARSE_URL ?? 'https://api.actiora.com/parse') {}
  async extract(document: FullTextDocument): Promise<ParsedDocument> {
    let text = document.content ?? '';
    let method: ParsedDocument['extractionMethod'] = 'native';
    if (!text && document.mimeType === 'application/pdf') {
      const res = await fetch(this.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: document.uri }) });
      const d: any = res.ok ? await res.json() : {};
      text = d.markdown ?? '';
    }
    if (!text) throw new Error(`No extractable content for ${document.recordId}`);
    const chunks = text.match(/.{1,1200}/gs) ?? [text];
    return {
      recordId: document.recordId,
      text,
      pages: chunks.map((t, i) => ({ page: i + 1, text: t })),
      sections: deriveSections(text),
      extractionMethod: method,
    };
  }
}
