import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
const cleanDoi = (value?: string) => value?.replace(/^https?:\/\/doi\.org\//i, '').replace(/\s*\[doi\].*$/i, '').trim().toLowerCase() || undefined;

function provenance(database: string, platform: string, strategy: SearchStrategy, count: number, warnings: string[] = []): SearchProvenance {
  return {
    database,
    platform,
    executedQuery: strategy.query,
    executedAt: new Date().toISOString(),
    resultCount: count,
    exportFormat: 'JSON',
    warnings,
  };
}

function assertComplete(source: string, total: number, records: number): void {
  if (total !== records) {
    throw new Error(`${source} pagination/export reconciliation failed: source reported ${total}, retrieved ${records}`);
  }
}

function enforceLimit(source: string, total: number, limit: number): void {
  if (total > limit) {
    throw new Error(`${source} returned ${total} records, exceeding configured complete-export limit ${limit}. Refusing a partial systematic-review search; segment the query or raise REVIEW_MAX_SEARCH_RECORDS.`);
  }
}

function retryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterDelayMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}

interface MedlineFields { [tag: string]: string[] }

export function parseMedline(text: string): EvidenceRecord[] {
  const records: MedlineFields[] = [];
  let current: MedlineFields = {};
  let currentTag: string | null = null;

  const flush = () => {
    if ((current.PMID ?? []).length > 0) records.push(current);
    current = {};
    currentTag = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9]{2,4})\s*-\s?(.*)$/);
    if (match) {
      const tag = match[1]!;
      if (tag === 'PMID' && (current.PMID ?? []).length > 0) flush();
      currentTag = tag;
      (current[tag] ??= []).push(match[2]!.trim());
      continue;
    }
    if (currentTag && /^\s{4,}/.test(line) && line.trim()) {
      const values = current[currentTag]!;
      values[values.length - 1] = `${values[values.length - 1]} ${line.trim()}`.trim();
    }
  }
  flush();

  return records.map((fields) => {
    const first = (tag: string) => fields[tag]?.[0];
    const pmid = first('PMID')!;
    const aids = [...(fields.AID ?? []), ...(fields.LID ?? [])];
    const doi = cleanDoi(aids.find((value) => /\[doi\]/i.test(value)));
    const journal = first('JT') ?? first('TA');
    const title = first('TI');
    const year = Number((first('DP') ?? '').match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
    const record: EvidenceRecord = {
      id: doi ?? `pmid:${pmid}`,
      title: title?.trim() || `[PubMed record ${pmid}: title unavailable]`,
      abstract: (fields.AB ?? []).join(' '),
      authors: (fields.FAU?.length ? fields.FAU : fields.AU ?? []).slice(0, 20),
      year,
      pmid,
      sourceDatabases: ['pubmed'],
      keywords: [
        ...(fields.MH ?? []),
        ...(fields.OT ?? []),
        ...(!title?.trim() ? ['source-record-warning:title-unavailable'] : []),
      ],
    };
    if (journal) record.journal = journal;
    if (doi) record.doi = doi;
    return record;
  });
}

export interface PubMedAdapterOptions {
  baseUrl?: string;
  maxRecords?: number;
  fetchChunkSize?: number;
  apiKey?: string;
  tool?: string;
  email?: string;
}

/** PubMed via NCBI E-utilities: ESearch against db=pubmed followed by EFetch MEDLINE. */
export class PubMedAdapter implements EvidenceSourceAdapter {
  readonly database = 'pubmed';
  private readonly baseUrl: string;
  private readonly maxRecords: number;
  private readonly fetchChunkSize: number;
  private readonly apiKey: string | undefined;
  private readonly tool: string;
  private readonly email: string | undefined;

  constructor(options: PubMedAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils').replace(/\/$/, '');
    this.maxRecords = options.maxRecords ?? Number(process.env.REVIEW_MAX_SEARCH_RECORDS ?? 10000);
    this.fetchChunkSize = options.fetchChunkSize ?? 200;
    this.apiKey = options.apiKey ?? process.env.NCBI_API_KEY;
    this.tool = options.tool ?? process.env.NCBI_EUTILS_TOOL ?? 'Medantir';
    this.email = options.email ?? process.env.NCBI_EUTILS_EMAIL;
  }

  private commonParams(): Record<string, string> {
    return {
      tool: this.tool,
      ...(this.email ? { email: this.email } : {}),
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    };
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const searchBody = new URLSearchParams({
      db: 'pubmed',
      term: strategy.query,
      retmode: 'json',
      retmax: String(this.maxRecords),
      ...this.commonParams(),
    });
    const search = await fetch(`${this.baseUrl}/esearch.fcgi`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: searchBody,
    });
    if (!search.ok) throw new Error(`PubMed ESearch failed with HTTP ${search.status}`);
    const payload: any = await search.json();
    const result = payload?.esearchresult ?? {};
    const total = Number(result.count ?? 0);
    const ids: string[] = Array.isArray(result.idlist) ? result.idlist.map(String) : [];
    enforceLimit('PubMed', total, this.maxRecords);
    if (ids.length !== total) {
      throw new Error(`PubMed ESearch returned ${ids.length} PMIDs for ${total} hits; refusing incomplete export.`);
    }

    const records: EvidenceRecord[] = [];
    for (let offset = 0; offset < ids.length; offset += this.fetchChunkSize) {
      const chunk = ids.slice(offset, offset + this.fetchChunkSize);
      if (offset > 0) await sleep(this.apiKey ? 120 : 360);
      const body = new URLSearchParams({
        db: 'pubmed',
        id: chunk.join(','),
        rettype: 'medline',
        retmode: 'text',
        ...this.commonParams(),
      });
      const fetched = await fetch(`${this.baseUrl}/efetch.fcgi`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!fetched.ok) throw new Error(`PubMed EFetch failed with HTTP ${fetched.status}`);
      const parsed = parseMedline(await fetched.text());
      const parsedPmids = new Set(parsed.map((record) => record.pmid).filter((value): value is string => Boolean(value)));
      for (const missingPmid of chunk.filter((pmid) => !parsedPmids.has(pmid))) {
        parsed.push({
          id: `pmid:${missingPmid}`,
          title: `[PubMed record ${missingPmid}: metadata unavailable from EFetch]`,
          abstract: '',
          authors: [],
          year: 0,
          pmid: missingPmid,
          sourceDatabases: ['pubmed'],
          keywords: ['source-record-warning:efetch-metadata-unavailable'],
        });
      }
      records.push(...parsed);
    }
    assertComplete('PubMed', total, records.length);
    const warnings = [
      `Official NCBI E-utilities search: ${Math.ceil(Math.max(total, 1) / this.fetchChunkSize)} retrieval batch(es).`,
      ...(records.some((record) => record.keywords?.some((value) => value.startsWith('source-record-warning:')))
        ? ['One or more PubMed source records had incomplete EFetch metadata and were retained with explicit warning markers.']
        : []),
      ...(this.email ? [] : ['NCBI_EUTILS_EMAIL is not configured; set a registered E-utilities contact email for production use.']),
    ];
    return { records, provenance: provenance('pubmed', 'NCBI E-utilities', strategy, records.length, warnings) };
  }
}

export interface EuropePmcAdapterOptions {
  baseUrl?: string;
  maxRecords?: number;
  pageSize?: number;
}

/** Europe PMC REST search with cursorMark pagination and resultType=core. */
export class EuropePmcOfficialAdapter implements EvidenceSourceAdapter {
  readonly database = 'europepmc';
  private readonly baseUrl: string;
  private readonly maxRecords: number;
  private readonly pageSize: number;

  constructor(options: EuropePmcAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://www.ebi.ac.uk/europepmc/webservices/rest').replace(/\/$/, '');
    this.maxRecords = options.maxRecords ?? Number(process.env.REVIEW_MAX_SEARCH_RECORDS ?? 10000);
    this.pageSize = Math.min(1000, options.pageSize ?? 1000);
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const records: EvidenceRecord[] = [];
    let cursor = '*';
    let total: number | null = null;
    let pages = 0;

    while (true) {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set('query', strategy.query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('resultType', 'core');
      url.searchParams.set('pageSize', String(this.pageSize));
      url.searchParams.set('cursorMark', cursor);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Europe PMC search failed with HTTP ${response.status}`);
      const data: any = await response.json();
      pages += 1;
      if (total === null) {
        const reportedTotal = Number(data?.hitCount ?? 0);
        enforceLimit('Europe PMC', reportedTotal, this.maxRecords);
        total = reportedTotal;
      }
      const list: any[] = data?.resultList?.result ?? [];
      for (const item of list) {
        const doi = cleanDoi(item.doi);
        const pmid = item.pmid ? String(item.pmid) : undefined;
        const record: EvidenceRecord = {
          id: doi ?? (pmid ? `pmid:${pmid}` : `${String(item.source ?? 'epmc').toLowerCase()}:${String(item.id ?? '')}`),
          title: item.title ?? '',
          abstract: item.abstractText ?? '',
          authors: item.authorString ? String(item.authorString).split(', ').slice(0, 20) : [],
          year: item.pubYear ? Number(item.pubYear) : 0,
          sourceDatabases: ['europepmc'],
          keywords: [
            ...(item.pmcid ? [`pmcid:${item.pmcid}`] : []),
            ...(item.isOpenAccess === 'Y' ? ['oa'] : []),
          ],
        };
        if (item.journalTitle) record.journal = String(item.journalTitle);
        if (doi) record.doi = doi;
        if (pmid) record.pmid = pmid;
        records.push(record);
      }
      if ((total ?? 0) === records.length) break;
      const next = data?.nextCursorMark;
      if (!next || next === cursor || list.length === 0) break;
      cursor = String(next);
    }

    assertComplete('Europe PMC', total ?? records.length, records.length);
    return {
      records,
      provenance: provenance('europepmc', 'Europe PMC REST API', strategy, records.length, [`Official Europe PMC cursor pagination: ${pages} page(s).`]),
    };
  }
}

export interface ClinicalTrialsGovAdapterOptions {
  baseUrl?: string;
  maxRecords?: number;
  pageSize?: number;
  maxPageAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}

/** ClinicalTrials.gov modern REST API v2 with pageToken pagination. */
export class ClinicalTrialsGovAdapter implements EvidenceSourceAdapter {
  readonly database = 'clinicaltrials.gov';
  private readonly baseUrl: string;
  private readonly maxRecords: number;
  private readonly pageSize: number;
  private readonly maxPageAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ClinicalTrialsGovAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://clinicaltrials.gov/api/v2').replace(/\/$/, '');
    this.maxRecords = options.maxRecords ?? Number(process.env.REVIEW_MAX_SEARCH_RECORDS ?? 10000);
    this.pageSize = Math.min(1000, options.pageSize ?? 1000);
    this.maxPageAttempts = Math.max(1, options.maxPageAttempts ?? Number(process.env.REVIEW_CTG_PAGE_MAX_ATTEMPTS ?? 5));
    this.baseRetryDelayMs = Math.max(0, options.baseRetryDelayMs ?? Number(process.env.REVIEW_CTG_PAGE_RETRY_BASE_MS ?? 250));
    this.maxRetryDelayMs = Math.max(this.baseRetryDelayMs, options.maxRetryDelayMs ?? Number(process.env.REVIEW_CTG_PAGE_RETRY_MAX_MS ?? 2000));
    this.sleepFn = options.sleep ?? sleep;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async fetchPage(
    url: URL,
    pageToken: string | undefined,
    recoveredWarnings: string[],
  ): Promise<Response> {
    const label = pageToken ? `page token ${pageToken}` : 'first page';
    let lastFailure = 'transient request failure';

    for (let attempt = 1; attempt <= this.maxPageAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url);
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        if (attempt >= this.maxPageAttempts) {
          throw new Error(
            `ClinicalTrials.gov API page request failed after ${attempt} attempt(s) for ${label}: ${lastFailure}`,
            { cause: error },
          );
        }
        const delay = Math.min(this.maxRetryDelayMs, this.baseRetryDelayMs * (2 ** (attempt - 1)));
        if (delay > 0) await this.sleepFn(delay);
        continue;
      }

      if (response.ok) {
        if (attempt > 1) {
          recoveredWarnings.push(
            `ClinicalTrials.gov transient ${label} failure recovered after ${attempt} attempt(s); last failure: ${lastFailure}.`,
          );
        }
        return response;
      }

      if (!retryableHttpStatus(response.status)) {
        throw new Error(`ClinicalTrials.gov API failed with HTTP ${response.status}`);
      }

      lastFailure = `HTTP ${response.status}`;
      if (attempt >= this.maxPageAttempts) {
        throw new Error(`ClinicalTrials.gov API failed with HTTP ${response.status} after ${attempt} page attempt(s) for ${label}`);
      }
      const retryAfter = retryAfterDelayMs(response.headers.get('retry-after'));
      const exponential = this.baseRetryDelayMs * (2 ** (attempt - 1));
      const delay = Math.min(this.maxRetryDelayMs, retryAfter ?? exponential);
      if (delay > 0) await this.sleepFn(delay);
    }

    throw new Error(`ClinicalTrials.gov API page retry exhausted for ${label}`);
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const records: EvidenceRecord[] = [];
    const recoveredWarnings: string[] = [];
    let pageToken: string | undefined;
    let total: number | null = null;
    let pages = 0;

    while (true) {
      const url = new URL(`${this.baseUrl}/studies`);
      url.searchParams.set('query.term', strategy.query);
      url.searchParams.set('format', 'json');
      url.searchParams.set('pageSize', String(this.pageSize));
      url.searchParams.set('countTotal', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.fetchPage(url, pageToken, recoveredWarnings);
      const data: any = await response.json();
      pages += 1;
      if (total === null && typeof data?.totalCount === 'number') {
        const reportedTotal = data.totalCount;
        enforceLimit('ClinicalTrials.gov', reportedTotal, this.maxRecords);
        total = reportedTotal;
      }
      const studies: any[] = Array.isArray(data?.studies) ? data.studies : [];
      for (const study of studies) {
        const protocol = study?.protocolSection ?? {};
        const identification = protocol?.identificationModule ?? {};
        const description = protocol?.descriptionModule ?? {};
        const status = protocol?.statusModule ?? {};
        const sponsor = protocol?.sponsorCollaboratorsModule?.leadSponsor?.name;
        const officials = protocol?.contactsLocationsModule?.overallOfficials ?? [];
        const nctId = String(identification?.nctId ?? '').trim();
        const title = identification?.officialTitle ?? identification?.briefTitle ?? nctId;
        const year = Number(String(status?.studyFirstPostDateStruct?.date ?? status?.startDateStruct?.date ?? '').slice(0, 4)) || 0;
        records.push({
          id: nctId ? `nct:${nctId.toLowerCase()}` : `ctg:${records.length + 1}`,
          title,
          abstract: description?.briefSummary ?? description?.detailedDescription ?? '',
          authors: officials.map((item: any) => item?.name).filter(Boolean).slice(0, 20),
          year,
          journal: sponsor ? `ClinicalTrials.gov — ${sponsor}` : 'ClinicalTrials.gov',
          sourceDatabases: ['clinicaltrials.gov'],
          keywords: [
            ...(nctId ? [nctId] : []),
            ...(protocol?.conditionsModule?.conditions ?? []),
            ...(protocol?.armsInterventionsModule?.interventions ?? []).flatMap((item: any) => item?.name ? [item.name] : []),
          ],
        });
      }
      const next = data?.nextPageToken;
      if (!next) break;
      if (next === pageToken) throw new Error('ClinicalTrials.gov returned a repeated page token; refusing potentially incomplete pagination.');
      pageToken = String(next);
      if (records.length > this.maxRecords) enforceLimit('ClinicalTrials.gov', records.length, this.maxRecords);
    }

    const expected = total ?? records.length;
    enforceLimit('ClinicalTrials.gov', expected, this.maxRecords);
    assertComplete('ClinicalTrials.gov', expected, records.length);
    return {
      records,
      provenance: provenance(
        'clinicaltrials.gov',
        'ClinicalTrials.gov API v2',
        strategy,
        records.length,
        [`Official ClinicalTrials.gov pagination: ${pages} page(s).`, ...recoveredWarnings],
      ),
    };
  }
}

export function officialEvidenceAdapterFor(database: string): EvidenceSourceAdapter | null {
  const key = database.trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === 'pubmed' || key === 'ncbi pubmed') return new PubMedAdapter();
  if (key === 'europepmc' || key === 'europe pmc') return new EuropePmcOfficialAdapter();
  if (['clinicaltrials.gov', 'clinicaltrials', 'clinical trials.gov', 'clinical trials'].includes(key)) return new ClinicalTrialsGovAdapter();
  return null;
}
