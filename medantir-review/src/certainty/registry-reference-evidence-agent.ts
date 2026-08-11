import type { Agent, AgentContext, AgentResult } from '../core/types.js';
import type { TrialRegistryEvidenceRecord, TrialRegistryReference } from '../core/trial-registry-metadata.js';
import { normaliseText, stableHash } from '../core/utils.js';
import type { RegistryResultUniverseRecord } from './publication-bias-universe.js';
import type { RegistryUniverseReviewPackage } from './registry-result-universe-agent.js';

export interface RegistryResultReferenceReceipt {
  version: 1;
  registryId: string;
  outcome: string;
  pmid?: string;
  citation?: string;
  referenceType: 'RESULT';
  establishesResultsAvailable: true;
  establishesPublishedStatus: boolean;
  evidenceIds: string[];
  receiptHash: string;
}

function registryRecordById(context: AgentContext): Map<string, TrialRegistryEvidenceRecord> {
  const records = Array.isArray(context.state.artifacts.searchResults)
    ? context.state.artifacts.searchResults as TrialRegistryEvidenceRecord[]
    : [];
  const map = new Map<string, TrialRegistryEvidenceRecord>();
  for (const record of records) {
    const id = record.trialRegistry?.registryId?.trim().toUpperCase();
    if (!id) continue;
    map.set(id, record);
  }
  return map;
}

function resultReferences(values: TrialRegistryReference[] | undefined): TrialRegistryReference[] {
  return (values ?? []).filter((reference) => normaliseText(reference.type ?? '') === 'result' && Boolean(reference.pmid?.trim() || reference.citation?.trim()));
}

/**
 * Applies ClinicalTrials.gov references explicitly typed RESULT. Background or
 * derived references never resolve publication/result completeness.
 */
export class RegistryReferenceEvidenceAgent implements Agent {
  readonly stage = 'grade' as const;

  constructor(private readonly inner: Agent) {}

  async execute(context: AgentContext): Promise<AgentResult> {
    const universe = Array.isArray(context.state.artifacts.registeredStudyResultUniverse)
      ? structuredClone(context.state.artifacts.registeredStudyResultUniverse as RegistryResultUniverseRecord[])
      : [];
    const records = registryRecordById(context);
    const receipts: RegistryResultReferenceReceipt[] = [];

    for (const row of universe) {
      if (!row.registryId) continue;
      const metadata = records.get(row.registryId.toUpperCase())?.trialRegistry;
      if (!metadata) continue;
      for (const reference of resultReferences(metadata.references)) {
        const pmid = reference.pmid?.trim();
        const citation = reference.citation?.trim();
        const evidenceIds = [
          `registry-result-reference:${stableHash({ registryId: row.registryId, pmid: pmid ?? null, citation: citation ?? null })}`,
          `registry-source:${stableHash(metadata)}`,
        ];
        const hashable = {
          registryId: row.registryId,
          outcome: row.outcome,
          pmid: pmid ?? null,
          citation: citation ?? null,
          referenceType: 'RESULT' as const,
          establishesResultsAvailable: true as const,
          establishesPublishedStatus: Boolean(pmid),
          evidenceIds,
        };
        const receipt: RegistryResultReferenceReceipt = {
          version: 1,
          registryId: row.registryId,
          outcome: row.outcome,
          ...(pmid ? { pmid } : {}),
          ...(citation ? { citation } : {}),
          referenceType: 'RESULT',
          establishesResultsAvailable: true,
          establishesPublishedStatus: Boolean(pmid),
          evidenceIds,
          receiptHash: stableHash(hashable),
        };
        receipts.push(receipt);
        row.resultsAvailable = true;
        if (pmid && (row.publicationStatus === 'unknown' || row.publicationStatus === 'registry-only')) {
          row.publicationStatus = 'published';
        }
        row.evidenceIds = [...new Set([...row.evidenceIds, ...evidenceIds, `registry-result-reference-receipt:${receipt.receiptHash}`])];
      }
      if (receipts.some((receipt) => receipt.registryId === row.registryId && normaliseText(receipt.outcome) === normaliseText(row.outcome))) {
        row.sourceHash = stableHash({
          prior: row.sourceHash,
          resultReferences: receipts.filter((receipt) => receipt.registryId === row.registryId && normaliseText(receipt.outcome) === normaliseText(row.outcome)).map((receipt) => receipt.receiptHash).sort(),
          resultsAvailable: row.resultsAvailable,
          publicationStatus: row.publicationStatus,
        });
      }
    }

    const review = context.state.artifacts.registryUniverseReviewPackage as RegistryUniverseReviewPackage | undefined;
    const items = (review?.items ?? []).flatMap((item) => {
      const row = universe.find((candidate) => candidate.registryId?.toUpperCase() === item.registryId.toUpperCase() && normaliseText(candidate.outcome) === normaliseText(item.outcome));
      if (!row) return [item];
      const requiredFields = item.requiredFields.filter((field) => {
        if (field === 'resultsAvailable') return row.resultsAvailable === 'unknown';
        if (field === 'publicationStatus') return row.publicationStatus === 'unknown';
        return true;
      });
      if (requiredFields.length === 0) return [];
      return [{
        ...item,
        requiredFields,
        evidenceIds: [...new Set([...item.evidenceIds, ...row.evidenceIds])],
        reason: `Registry RESULT-reference reconciliation leaves only: ${requiredFields.join(', ')}.`,
      }];
    });
    const nextPackage: RegistryUniverseReviewPackage = {
      version: 1,
      items,
      createdAt: review?.createdAt ?? context.now(),
    };

    context.state.artifacts.registeredStudyResultUniverse = universe;
    context.state.artifacts.registryUniverseReviewPackage = nextPackage;
    context.state.artifacts.registryResultReferenceReceipts = receipts;
    const result = await this.inner.execute(context);
    return {
      ...result,
      artifacts: {
        ...result.artifacts,
        registeredStudyResultUniverse: universe,
        registryUniverseReviewPackage: nextPackage,
        registryResultReferenceReceipts: receipts,
        registryResultReferenceQuality: {
          resultReferences: receipts.length,
          pmidResultReferences: receipts.filter((receipt) => Boolean(receipt.pmid)).length,
          backgroundReferencesUsedAsResultsEvidence: false,
        },
      },
    };
  }
}
