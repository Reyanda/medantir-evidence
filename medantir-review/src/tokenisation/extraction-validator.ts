import { scientificContentHash } from '../core/canonical-hash.js';
import type { EvidenceExcerpt, ExtractedStudy } from '../core/types.js';
import { escapeJsonPointer, jsonPointer, SECTION_TO_IMRAD } from './imrad.js';
import { EXTRACTION_FIELD_CONTRACTS, extractionContractForField } from './extraction-registry.js';
import type {
  ExtractionContractIssue,
  ExtractionContractValidation,
  ExtractionFieldContract,
  ExtractionValueType,
} from './types.js';

interface PathMatch {
  pointer: string;
  value: unknown;
  fieldKey: string;
}

function collectPathMatches(value: unknown, pathPattern: string): PathMatch[] {
  const segments = pathPattern.split('/').filter(Boolean);
  const output: PathMatch[] = [];
  const visit = (current: unknown, position: number, path: Array<string | number>): void => {
    if (position === segments.length) {
      output.push({ pointer: jsonPointer(path), value: current, fieldKey: path.map(String).join('.') });
      return;
    }
    const segment = segments[position];
    if (segment === undefined) return;
    if (segment === '*') {
      if (!Array.isArray(current)) return;
      current.forEach((item, index) => visit(item, position + 1, [...path, index]));
      return;
    }
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    const record = current as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(record, segment)) visit(record[segment], position + 1, [...path, segment]);
  };
  visit(value, 0, []);
  return output;
}

function valuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function valueTypeMatches(value: unknown, type: ExtractionValueType): boolean {
  if (!valuePresent(value) && type === 'number-optional') return true;
  if (type === 'identifier' || type === 'string') return typeof value === 'string';
  if (type === 'string-array') return Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (type === 'number' || type === 'number-optional') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object-array') return Array.isArray(value) && value.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  return false;
}

function excerptLike(value: unknown): value is EvidenceExcerpt {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.section === 'string'
    && typeof record.page === 'number'
    && typeof record.quote === 'string';
}

function fieldEvidenceFor(study: ExtractedStudy, contract: ExtractionFieldContract, match: PathMatch): EvidenceExcerpt[] {
  const aliases = new Set([
    contract.field,
    contract.field.split('.').at(-1) ?? contract.field,
    match.fieldKey,
    match.fieldKey.replace(/\.\d+\./g, '.*.'),
    match.pointer,
  ].map((value) => value.toLowerCase()));
  const excerpts: EvidenceExcerpt[] = [];
  for (const [key, values] of Object.entries(study.fieldEvidence ?? {})) {
    if (!aliases.has(key.toLowerCase()) || !Array.isArray(values)) continue;
    for (const value of values) if (excerptLike(value)) excerpts.push(value);
  }
  for (const quote of study.sourceQuotes ?? []) {
    const quoteContract = extractionContractForField(quote.field);
    if (quoteContract?.field !== contract.field) continue;
    excerpts.push({
      id: `source-quote:${scientificContentHash({ field: quote.field, section: quote.section, page: quote.page, quote: quote.quote })}`,
      recordId: study.reportIds[0] ?? study.studyId,
      section: quote.section,
      page: quote.page,
      quote: quote.quote,
      source: 'full-text',
    });
  }
  return excerpts;
}

function sectionEvidenceFor(study: ExtractedStudy, contract: ExtractionFieldContract): EvidenceExcerpt[] {
  const keys: string[] = contract.field === 'rationale'
    ? ['rationale']
    : contract.field === 'objectives'
      ? ['objectives']
      : contract.field === 'resultsSummary'
        ? ['results']
        : contract.field === 'discussionSummary'
          ? ['discussion']
          : contract.field === 'limitations'
            ? ['limitations', 'discussion']
            : [];
  const output: EvidenceExcerpt[] = [];
  for (const key of keys) {
    const values = (study.sectionEvidence as Record<string, unknown> | undefined)?.[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) if (excerptLike(value)) output.push(value);
  }
  return output;
}

function issue(input: Omit<ExtractionContractIssue, 'severity'> & { severity?: ExtractionContractIssue['severity'] }): ExtractionContractIssue {
  return { severity: input.severity ?? 'error', ...input };
}

export function validateExtractedStudyImrad(
  study: ExtractedStudy,
  options: { strict?: boolean } = {},
): ExtractionContractValidation {
  const issues: ExtractionContractIssue[] = [];
  const checkedFields: string[] = [];
  const seenQuotes = new Set<string>();

  for (const [bucket, excerpts] of Object.entries(study.sectionEvidence ?? {})) {
    if (!Array.isArray(excerpts)) continue;
    for (const excerpt of excerpts) {
      if (!excerptLike(excerpt)) {
        issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: bucket, jsonPointer: `/sectionEvidence/${escapeJsonPointer(bucket)}`, message: `Section evidence for ${bucket} is missing an id, section, page, or quote.` }));
        continue;
      }
      if (excerpt.section !== bucket) {
        issues.push(issue({ code: 'EVIDENCE_SECTION_MISMATCH', studyId: study.studyId, field: bucket, jsonPointer: `/sectionEvidence/${escapeJsonPointer(bucket)}`, evidenceId: excerpt.id, observedSection: excerpt.section, message: `Evidence bucket ${bucket} contains an excerpt labelled ${excerpt.section}.` }));
      }
      if (!Number.isInteger(excerpt.page) || excerpt.page < 1 || !excerpt.quote.trim()) {
        issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: bucket, jsonPointer: `/sectionEvidence/${escapeJsonPointer(bucket)}`, evidenceId: excerpt.id, observedSection: excerpt.section, message: `Evidence ${excerpt.id} must contain a positive page and non-empty quote.` }));
      }
    }
  }

  for (const [field, excerpts] of Object.entries(study.fieldEvidence ?? {})) {
    const registered = extractionContractForField(field);
    if (!registered) {
      issues.push(issue({ code: 'UNKNOWN_EXTRACTION_FIELD', studyId: study.studyId, field, jsonPointer: `/fieldEvidence/${escapeJsonPointer(field)}`, message: `Field evidence is stored under an extraction field without a registered contract: ${field}.` }));
      continue;
    }
    if (!Array.isArray(excerpts)) {
      issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: registered.field, jsonPointer: `/fieldEvidence/${escapeJsonPointer(field)}`, message: `Field evidence for ${field} must be an array of source excerpts.` }));
      continue;
    }
    for (const excerpt of excerpts) {
      if (!excerptLike(excerpt)) {
        issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: registered.field, jsonPointer: `/fieldEvidence/${escapeJsonPointer(field)}`, message: `Field evidence for ${field} is missing an id, section, page, or quote.` }));
        continue;
      }
      const observedRole = SECTION_TO_IMRAD[excerpt.section];
      if (!registered.allowedImradRoles.includes(observedRole)) {
        issues.push(issue({ code: 'EVIDENCE_SECTION_OUTSIDE_CONTRACT', studyId: study.studyId, field: registered.field, jsonPointer: `/fieldEvidence/${escapeJsonPointer(field)}`, evidenceId: excerpt.id, observedSection: excerpt.section, allowedImradRoles: [...registered.allowedImradRoles], message: `${registered.field} cites ${excerpt.section}; allowed IMRAD roles are ${registered.allowedImradRoles.join(', ')}.` }));
      }
      if (!Number.isInteger(excerpt.page) || excerpt.page < 1 || !excerpt.quote.trim()) {
        issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: registered.field, jsonPointer: `/fieldEvidence/${escapeJsonPointer(field)}`, evidenceId: excerpt.id, observedSection: excerpt.section, message: `Evidence ${excerpt.id} must contain a positive page and non-empty quote.` }));
      }
    }
  }

  for (const quote of study.sourceQuotes ?? []) {
    const identity = scientificContentHash({ field: quote.field, section: quote.section, page: quote.page, quote: quote.quote });
    if (seenQuotes.has(identity)) {
      issues.push(issue({ code: 'DUPLICATE_SOURCE_QUOTE', severity: 'warning', studyId: study.studyId, field: quote.field, jsonPointer: '/sourceQuotes', observedSection: quote.section, message: `Duplicate source quote for ${quote.field}.` }));
    }
    seenQuotes.add(identity);
    const registered = extractionContractForField(quote.field);
    if (!registered) {
      issues.push(issue({ code: 'UNKNOWN_EXTRACTION_FIELD', studyId: study.studyId, field: quote.field, jsonPointer: '/sourceQuotes', observedSection: quote.section, message: `Source quote declares an extraction field without a registered contract: ${quote.field}.` }));
      continue;
    }
    const observedRole = SECTION_TO_IMRAD[quote.section];
    if (!registered.allowedImradRoles.includes(observedRole)) {
      issues.push(issue({ code: 'EVIDENCE_SECTION_OUTSIDE_CONTRACT', studyId: study.studyId, field: registered.field, jsonPointer: '/sourceQuotes', observedSection: quote.section, allowedImradRoles: [...registered.allowedImradRoles], message: `${registered.field} cannot cite ${quote.section}; allowed IMRAD roles are ${registered.allowedImradRoles.join(', ')}.` }));
    }
    if (!Number.isInteger(quote.page) || quote.page < 1 || !quote.quote.trim()) {
      issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: registered.field, jsonPointer: '/sourceQuotes', observedSection: quote.section, message: `Source quote for ${registered.field} must contain a positive page and non-empty quote.` }));
    }
  }

  for (const contract of EXTRACTION_FIELD_CONTRACTS) {
    for (const match of collectPathMatches(study, contract.pathPattern)) {
      if (!valuePresent(match.value)) continue;
      checkedFields.push(`${contract.field}@${match.pointer}`);
      if (!valueTypeMatches(match.value, contract.valueType)) {
        issues.push(issue({ code: 'VALUE_TYPE_MISMATCH', studyId: study.studyId, field: contract.field, jsonPointer: match.pointer, allowedImradRoles: [...contract.allowedImradRoles], message: `${contract.field} does not satisfy ${contract.valueType}.` }));
      }
      if (contract.evidenceBinding === 'none') continue;
      const excerpts = contract.evidenceBinding === 'field' ? fieldEvidenceFor(study, contract, match) : sectionEvidenceFor(study, contract);
      if (!excerpts.length) {
        issues.push(issue({ code: 'MISSING_FIELD_EVIDENCE', studyId: study.studyId, field: contract.field, jsonPointer: match.pointer, allowedImradRoles: [...contract.allowedImradRoles], message: `${contract.field} is present but has no source-bound evidence under its ${contract.evidenceBinding} contract.` }));
        continue;
      }
      for (const excerpt of excerpts) {
        const observedRole = SECTION_TO_IMRAD[excerpt.section];
        if (!contract.allowedImradRoles.includes(observedRole)) {
          issues.push(issue({ code: 'EVIDENCE_SECTION_OUTSIDE_CONTRACT', studyId: study.studyId, field: contract.field, jsonPointer: match.pointer, evidenceId: excerpt.id, observedSection: excerpt.section, allowedImradRoles: [...contract.allowedImradRoles], message: `${contract.field} cites ${excerpt.section}; allowed IMRAD roles are ${contract.allowedImradRoles.join(', ')}.` }));
        }
        if (!Number.isInteger(excerpt.page) || excerpt.page < 1 || !excerpt.quote.trim()) {
          issues.push(issue({ code: 'INVALID_EVIDENCE_LOCATOR', studyId: study.studyId, field: contract.field, jsonPointer: match.pointer, evidenceId: excerpt.id, observedSection: excerpt.section, message: `Evidence ${excerpt.id} must contain a positive page and non-empty quote.` }));
        }
      }
    }
  }

  const uniqueIssues = new Map<string, ExtractionContractIssue>();
  for (const entry of issues) {
    const identity = `${entry.code}\u0000${entry.field}\u0000${entry.evidenceId ?? ''}\u0000${entry.observedSection ?? ''}\u0000${entry.message}`;
    if (!uniqueIssues.has(identity)) uniqueIssues.set(identity, entry);
  }
  const sortedIssues = [...uniqueIssues.values()].sort((left, right) => `${left.code}\u0000${left.field}\u0000${left.jsonPointer}\u0000${left.evidenceId ?? ''}`.localeCompare(`${right.code}\u0000${right.field}\u0000${right.jsonPointer}\u0000${right.evidenceId ?? ''}`));
  const content = {
    schemaVersion: 'medantir-extraction-contract-validation/1' as const,
    studyId: study.studyId,
    valid: !sortedIssues.some((entry) => entry.severity === 'error'),
    checkedFields: [...new Set(checkedFields)].sort(),
    issues: sortedIssues,
  };
  const validation: ExtractionContractValidation = { ...content, validationHash: scientificContentHash(content) };
  if (options.strict && !validation.valid) {
    const summary = validation.issues.filter((entry) => entry.severity === 'error').map((entry) => `${entry.code}:${entry.field}`).join(', ');
    throw new Error(`Extraction field contract validation failed for ${study.studyId}: ${summary}`);
  }
  return validation;
}

function extractedStudyLike(value: unknown): value is ExtractedStudy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.studyId === 'string'
    && Array.isArray(record.reportIds)
    && typeof record.design === 'string'
    && Array.isArray(record.outcomes)
    && Boolean(record.sectionEvidence)
    && Boolean(record.fieldEvidence)
    && Array.isArray(record.sourceQuotes);
}

export function findExtractedStudies(value: unknown): ExtractedStudy[] {
  const output: ExtractedStudy[] = [];
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object') return;
    const object = current as object;
    if (seen.has(object)) return;
    seen.add(object);
    if (extractedStudyLike(current)) output.push(current);
    if (Array.isArray(current)) current.forEach(visit);
    else Object.values(current as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return output;
}
