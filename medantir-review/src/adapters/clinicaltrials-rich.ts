import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import type {
  TrialRegistryArm,
  TrialRegistryEligibilityMetadata,
  TrialRegistryEvidenceRecord,
  TrialRegistryIntervention,
  TrialRegistryMetadata,
  TrialRegistryProtocolOutcome,
  TrialRegistryReference,
  TrialRegistryReportedOutcome,
} from '../core/trial-registry-metadata.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean || undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return [...new Set(array(value).flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []))];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function protocolOutcomes(value: unknown): TrialRegistryProtocolOutcome[] {
  return array(value).flatMap((raw) => {
    const item = object(raw);
    const measure = text(item.measure);
    if (!measure) return [];
    const description = text(item.description);
    const timeFrame = text(item.timeFrame);
    return [{
      measure,
      ...(description ? { description } : {}),
      ...(timeFrame ? { timeFrame } : {}),
    }];
  });
}

function references(value: unknown): TrialRegistryReference[] {
  return array(value).flatMap((raw) => {
    const item = object(raw);
    const pmid = text(item.pmid);
    const type = text(item.type);
    const citation = text(item.citation);
    if (!pmid && !type && !citation) return [];
    return [{
      ...(pmid ? { pmid } : {}),
      ...(type ? { type } : {}),
      ...(citation ? { citation } : {}),
    }];
  });
}

function hasMeasurementData(outcome: Record<string, unknown>): boolean {
  const measurements = array(outcome.classes).flatMap((classRaw) =>
    array(object(classRaw).categories).flatMap((categoryRaw) => array(object(categoryRaw).measurements)));
  if (measurements.some((raw) => text(object(raw).value))) return true;
  return array(outcome.analyses).length > 0;
}

function reportedOutcomes(value: unknown): TrialRegistryReportedOutcome[] {
  return array(value).flatMap((raw) => {
    const item = object(raw);
    const title = text(item.title);
    if (!title) return [];
    const type = text(item.type);
    const description = text(item.description);
    const timeFrame = text(item.timeFrame);
    const reportingStatus = text(item.reportingStatus);
    return [{
      title,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      ...(timeFrame ? { timeFrame } : {}),
      ...(reportingStatus ? { reportingStatus } : {}),
      hasOutcomeData: hasMeasurementData(item),
    }];
  });
}

function arms(value: unknown): TrialRegistryArm[] {
  return array(value).flatMap((raw) => {
    const item = object(raw);
    const label = text(item.label);
    if (!label) return [];
    const type = text(item.type);
    const description = text(item.description);
    return [{
      label,
      ...(type ? { type } : {}),
      ...(description ? { description } : {}),
      interventionNames: stringArray(item.interventionNames),
    }];
  });
}

function interventions(value: unknown): TrialRegistryIntervention[] {
  return array(value).flatMap((raw) => {
    const item = object(raw);
    const name = text(item.name);
    if (!name) return [];
    const type = text(item.type);
    const description = text(item.description);
    return [{
      ...(type ? { type } : {}),
      name,
      ...(description ? { description } : {}),
      otherNames: stringArray(item.otherNames),
      armGroupLabels: stringArray(item.armGroupLabels),
    }];
  });
}

function eligibility(value: unknown): TrialRegistryEligibilityMetadata {
  const item = object(value);
  const criteria = text(item.eligibilityCriteria);
  const sex = text(item.sex);
  const minimumAge = text(item.minimumAge);
  const maximumAge = text(item.maximumAge);
  const studyPopulation = text(item.studyPopulation);
  return {
    ...(criteria ? { criteria } : {}),
    ...(typeof item.healthyVolunteers === 'boolean' ? { healthyVolunteers: item.healthyVolunteers } : {}),
    ...(sex ? { sex } : {}),
    ...(minimumAge ? { minimumAge } : {}),
    ...(maximumAge ? { maximumAge } : {}),
    standardAges: stringArray(item.stdAges),
    ...(studyPopulation ? { studyPopulation } : {}),
  };
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function registryMetadata(study: Record<string, unknown>, nctId: string): TrialRegistryMetadata {
  const protocol = object(study.protocolSection);
  const status = object(protocol.statusModule);
  const conditions = object(protocol.conditionsModule);
  const design = object(protocol.designModule);
  const designInfo = object(design.designInfo);
  const masking = object(designInfo.maskingInfo);
  const enrollment = object(design.enrollmentInfo);
  const armIntervention = object(protocol.armsInterventionsModule);
  const eligibilityModule = object(protocol.eligibilityModule);
  const outcomes = object(protocol.outcomesModule);
  const referencesModule = object(protocol.referencesModule);
  const results = object(study.resultsSection);
  const resultOutcomesModule = object(results.outcomeMeasuresModule);
  const reported = reportedOutcomes(resultOutcomesModule.outcomeMeasures);
  const explicitHasResults = typeof study.hasResults === 'boolean' ? study.hasResults : undefined;
  const overallStatus = text(status.overallStatus);
  const studyType = text(design.studyType);
  const allocation = text(designInfo.allocation);
  const interventionModel = text(designInfo.interventionModel);
  const primaryPurpose = text(designInfo.primaryPurpose);
  const maskingValue = text(masking.masking);
  const enrollmentCount = finiteInteger(enrollment.count);
  const enrollmentType = text(enrollment.type);
  return {
    source: 'clinicaltrials.gov',
    registryId: nctId,
    ...(overallStatus ? { overallStatus } : {}),
    hasPostedResults: explicitHasResults ?? reported.some((outcome) => outcome.hasOutcomeData),
    conditions: stringArray(conditions.conditions),
    keywords: stringArray(conditions.keywords),
    design: {
      ...(studyType ? { studyType } : {}),
      phases: stringArray(design.phases),
      ...(allocation ? { allocation } : {}),
      ...(interventionModel ? { interventionModel } : {}),
      ...(primaryPurpose ? { primaryPurpose } : {}),
      ...(maskingValue ? { masking: maskingValue } : {}),
      ...(enrollmentCount !== undefined ? { enrollmentCount } : {}),
      ...(enrollmentType ? { enrollmentType } : {}),
    },
    eligibility: eligibility(eligibilityModule),
    arms: arms(armIntervention.armGroups),
    interventions: interventions(armIntervention.interventions),
    primaryOutcomes: protocolOutcomes(outcomes.primaryOutcomes),
    secondaryOutcomes: protocolOutcomes(outcomes.secondaryOutcomes),
    reportedOutcomes: reported,
    references: references(referencesModule.references),
    sourceSchema: 'clinicaltrials.gov-api-v2',
  };
}

function evidenceRecord(studyRaw: unknown): TrialRegistryEvidenceRecord | null {
  const study = object(studyRaw);
  if (Object.keys(study).length === 0) return null;
  const protocol = object(study.protocolSection);
  const identification = object(protocol.identificationModule);
  const description = object(protocol.descriptionModule);
  const status = object(protocol.statusModule);
  const nctId = text(identification.nctId)?.toUpperCase();
  if (!nctId || !/^NCT\d{8}$/.test(nctId)) return null;
  const title = text(identification.briefTitle) ?? text(identification.officialTitle) ?? `[ClinicalTrials.gov ${nctId}]`;
  const startDate = text(object(status.startDateStruct).date);
  const yearText = startDate ?? text(status.studyFirstSubmitDate);
  const year = Number(yearText?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
  const overallStatus = text(status.overallStatus);
  return {
    id: `nct:${nctId.toLowerCase()}`,
    title,
    abstract: text(description.briefSummary) ?? text(description.detailedDescription) ?? '',
    authors: [],
    year,
    sourceDatabases: ['clinicaltrials.gov'],
    keywords: [
      `registry-id:${nctId}`,
      ...(overallStatus ? [`registry-status:${overallStatus}`] : []),
      ...(study.hasResults === true ? ['registry-has-posted-results'] : []),
    ],
    trialRegistry: registryMetadata(study, nctId),
  };
}

export interface SourceRichClinicalTrialsOptions {
  baseUrl?: string;
  maxRecords?: number;
  pageSize?: number;
  maxAttempts?: number;
}

/**
 * ClinicalTrials.gov API v2 adapter retaining structured protocol/results data.
 * `hasPostedResults` is explicitly registry-local and is never interpreted as
 * global publication/result availability.
 */
export class SourceRichClinicalTrialsGovAdapter implements EvidenceSourceAdapter {
  readonly database = 'clinicaltrials.gov';
  private readonly baseUrl: string;
  private readonly maxRecords: number;
  private readonly pageSize: number;
  private readonly maxAttempts: number;

  constructor(options: SourceRichClinicalTrialsOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://clinicaltrials.gov/api/v2').replace(/\/$/, '');
    this.maxRecords = options.maxRecords ?? Number(process.env.REVIEW_MAX_SEARCH_RECORDS ?? 10000);
    this.pageSize = Math.min(1000, options.pageSize ?? 100);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  }

  private async get(url: URL): Promise<Response> {
    let last: Error | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url);
        if (response.ok) return response;
        if (!retryable(response.status) || attempt === this.maxAttempts) {
          throw new Error(`ClinicalTrials.gov API failed with HTTP ${response.status}`);
        }
        const delay = retryAfterMs(response.headers.get('retry-after')) ?? Math.min(8000, 350 * (2 ** (attempt - 1)));
        await sleep(delay);
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxAttempts) break;
        await sleep(Math.min(8000, 350 * (2 ** (attempt - 1))));
      }
    }
    throw last ?? new Error('ClinicalTrials.gov API failed');
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const records: TrialRegistryEvidenceRecord[] = [];
    let nextPageToken: string | undefined;
    let total: number | null = null;
    let pages = 0;
    const seen = new Set<string>();

    do {
      const url = new URL(`${this.baseUrl}/studies`);
      url.searchParams.set('query.term', strategy.query);
      url.searchParams.set('pageSize', String(this.pageSize));
      url.searchParams.set('format', 'json');
      url.searchParams.set('countTotal', 'true');
      if (nextPageToken) url.searchParams.set('pageToken', nextPageToken);
      const response = await this.get(url);
      const payload = await response.json() as { totalCount?: unknown; studies?: unknown; nextPageToken?: unknown };
      pages += 1;
      if (total === null && typeof payload.totalCount === 'number') {
        total = payload.totalCount;
        if (total > this.maxRecords) throw new Error(`ClinicalTrials.gov returned ${total} records, exceeding complete-export limit ${this.maxRecords}`);
      }
      for (const raw of array(payload.studies)) {
        const record = evidenceRecord(raw);
        if (!record || seen.has(record.id)) continue;
        seen.add(record.id);
        records.push(record);
        if (records.length > this.maxRecords) throw new Error(`ClinicalTrials.gov export exceeded configured limit ${this.maxRecords}`);
      }
      nextPageToken = text(payload.nextPageToken);
      if (nextPageToken && records.length >= this.maxRecords && total !== records.length) {
        throw new Error('ClinicalTrials.gov search would require an incomplete export at the configured record limit');
      }
    } while (nextPageToken);

    if (total !== null && total !== records.length) {
      throw new Error(`ClinicalTrials.gov pagination/export reconciliation failed: source reported ${total}, retrieved ${records.length}`);
    }

    return {
      records,
      provenance: {
        database: this.database,
        platform: 'ClinicalTrials.gov API v2',
        executedQuery: strategy.query,
        executedAt: new Date().toISOString(),
        resultCount: records.length,
        exportFormat: 'JSON',
        warnings: [
          `Official ClinicalTrials.gov API v2 full export: ${pages} page(s).`,
          'Registry records preserve design, eligibility, arms/interventions, protocol outcomes, RESULT publication references and registry-posted result-outcome structure for evidence-universe audit.',
        ],
      },
    };
  }
}
