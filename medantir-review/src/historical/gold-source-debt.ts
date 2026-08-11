import { createHistoricalStudySourceManifest, type HistoricalReportIdentifierSet } from './study-source-manifest.js';
import { createHistoricalReportInventoryVerification } from './report-inventory-attestation.js';

export interface HistoricalGoldSourceDebtResult {
  sourceManifest: ReturnType<typeof createHistoricalStudySourceManifest>;
  inventoryVerification: ReturnType<typeof createHistoricalReportInventoryVerification>;
}

function strings(value: unknown, path: string[] = []): Array<{ path: string[]; value: string }> {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => strings(item, [...path, String(index)]));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => strings(item, [...path, key]));
  }
  return [];
}

function identifierFromText(input: Array<{ path: string[]; value: string }>): HistoricalReportIdentifierSet {
  const identifiers: HistoricalReportIdentifierSet = {};
  for (const item of input) {
    const raw = item.value.trim();
    const key = item.path[item.path.length - 1]?.toLowerCase() ?? '';
    const doiMatch = raw.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i);
    if (!identifiers.doi && doiMatch?.[1]) identifiers.doi = doiMatch[1].toLowerCase();
    const registryMatch = raw.match(/\b(NCT\d{8}|ISRCTN\d{8}|ACTRN\d{14}|ChiCTR[-A-Za-z0-9]+|UMIN\d+)\b/i);
    if (!identifiers.registryId && registryMatch?.[1]) identifiers.registryId = registryMatch[1].toUpperCase();
    const pmcMatch = raw.match(/\bPMC\d+\b/i);
    if (!identifiers.pmcid && pmcMatch?.[0]) identifiers.pmcid = pmcMatch[0].toUpperCase();
    if (!identifiers.pmid && (key.includes('pmid') || /^pmid:/i.test(raw))) {
      const pmid = raw.match(/\b\d{6,9}\b/)?.[0];
      if (pmid) identifiers.pmid = pmid;
    }
    if (!identifiers.url && /^https:\/\//i.test(raw)) identifiers.url = raw;
  }
  return identifiers;
}

function titleFromGold(item: Record<string, unknown>): string | undefined {
  for (const key of ['title', 'label', 'citation', 'name']) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim().replace(/\s+/g, ' ');
  }
  return undefined;
}

/**
 * Create a deliberately incomplete source inventory from canonical benchmark
 * identities. This is a debt artifact only: one known report per lineage is not
 * interpreted as a complete study-family report inventory.
 */
export function createGoldSetHistoricalSourceDebt(input: {
  historicalCutoff: string;
  goldSet: Array<Record<string, unknown>>;
}): HistoricalGoldSourceDebtResult {
  const lineages = input.goldSet.map((item) => {
    const lineageId = typeof item.lineageId === 'string' ? item.lineageId.trim() : '';
    if (!lineageId) throw new Error('Historical gold-set source debt requires lineageId on every item.');
    const identifiers = identifierFromText(strings(item));
    if (Object.keys(identifiers).length === 0) {
      throw new Error(`Historical gold lineage '${lineageId}' has no stable primary-report identifier that can seed source debt.`);
    }
    return { lineageId, identifiers, title: titleFromGold(item) };
  });
  if (new Set(lineages.map((item) => item.lineageId)).size !== lineages.length) {
    throw new Error('Historical gold-set source debt contains duplicate lineage IDs.');
  }

  const reports = lineages.map((lineage) => ({
    lineageId: lineage.lineageId,
    reportId: `${lineage.lineageId}:minimum-known-result-report`,
    role: 'primary-results' as const,
    ...(lineage.title ? { title: lineage.title } : {}),
    identifiers: lineage.identifiers,
    availableByHistoricalCutoff: true,
    requiredForReproduction: true,
    resultBearing: true,
    sourceStatus: 'identified-unarchived' as const,
    notes: [
      'Seeded only from stable identifiers already present in the canonical benchmark gold set.',
      'This does not attest that the study-family report inventory is complete.',
    ],
  }));
  const sourceManifest = createHistoricalStudySourceManifest({
    historicalCutoff: input.historicalCutoff,
    requiredLineageIds: lineages.map((item) => item.lineageId),
    reports,
  });
  const inventoryVerification = createHistoricalReportInventoryVerification({
    sourceManifest,
    lineages: reports.map((report) => ({
      lineageId: report.lineageId,
      status: 'incomplete' as const,
      expectedReportIds: [report.reportId],
      evidenceReference: 'Canonical benchmark gold-set minimum report identity only; full study-family report enumeration pending.',
      notes: ['Additional reports, supplements, registry outputs, preprints or follow-ups may exist and must be adjudicated before completeness.'],
    })),
  });
  return { sourceManifest, inventoryVerification };
}
