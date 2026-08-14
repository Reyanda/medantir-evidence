import type { EvidenceBinding, ExtractionFieldContract, ExtractionValueType, ImradRole } from './types.js';
import { EXTRACTION_FIELD_CONTRACT_SCHEMA } from './types.js';

function contract(
  field: string,
  pathPattern: string,
  valueType: ExtractionValueType,
  cardinality: ExtractionFieldContract['cardinality'],
  evidenceBinding: EvidenceBinding,
  allowedImradRoles: ImradRole[],
  semanticRole: string,
  rationale: string,
): ExtractionFieldContract {
  return {
    schemaVersion: EXTRACTION_FIELD_CONTRACT_SCHEMA,
    field,
    pathPattern,
    valueType,
    cardinality,
    evidenceBinding,
    allowedImradRoles: [...allowedImradRoles],
    semanticRole,
    rationale,
  };
}

export const EXTRACTION_FIELD_CONTRACTS: readonly ExtractionFieldContract[] = [
  contract('studyId', '/studyId', 'identifier', 'one', 'none', ['not-applicable'], 'study-identity', 'Internal study identity is not inferred from an IMRAD claim.'),
  contract('reportIds', '/reportIds', 'string-array', 'one-or-more', 'none', ['not-applicable'], 'report-linkage', 'Report linkage is provenance metadata rather than a manuscript result.'),
  contract('design', '/design', 'string', 'one', 'field', ['methods'], 'study-design', 'Study design must be supported by the methods section.'),
  contract('population', '/population', 'string', 'one', 'field', ['methods'], 'population', 'Population eligibility and recruitment belong to methods.'),
  contract('interventionOrExposure', '/interventionOrExposure', 'string', 'one', 'field', ['methods'], 'intervention-or-exposure', 'Intervention or exposure definitions belong to methods.'),
  contract('comparator', '/comparator', 'string', 'one', 'field', ['methods'], 'comparator', 'Comparator definitions belong to methods.'),
  contract('outcomes.name', '/outcomes/*/name', 'string', 'one', 'field', ['methods', 'results'], 'outcome-definition', 'Outcome definitions may be specified in methods and reported in results.'),
  contract('outcomes.effect', '/outcomes/*/effect', 'number-optional', 'zero-or-one', 'field', ['results'], 'effect-estimate', 'Numerical effects must be sourced to results.'),
  contract('outcomes.standardError', '/outcomes/*/standardError', 'number-optional', 'zero-or-one', 'field', ['results'], 'uncertainty-estimate', 'Standard errors must be sourced to results.'),
  contract('mechanisms', '/mechanisms', 'string-array', 'zero-or-more', 'field', ['introduction', 'methods', 'results', 'discussion'], 'mechanism', 'Mechanisms may be hypothesised, measured, observed, or interpreted, but the section must remain explicit.'),
  contract('funding', '/funding', 'string', 'one', 'field', ['front-matter', 'methods', 'other'], 'funding', 'Funding is normally reported in front matter or methods.'),
  contract('rationale', '/rationale', 'string', 'one', 'section', ['introduction'], 'rationale', 'Rationale is bounded to the introduction or background.'),
  contract('objectives', '/objectives', 'string-array', 'one-or-more', 'section', ['introduction'], 'objectives', 'Objectives are bounded to the introduction or objectives section.'),
  contract('resultsSummary', '/resultsSummary', 'string', 'one', 'section', ['results'], 'results-summary', 'Results summaries must be supported only by results evidence.'),
  contract('discussionSummary', '/discussionSummary', 'string', 'one', 'section', ['discussion'], 'discussion-summary', 'Discussion summaries must be supported by discussion evidence.'),
  contract('limitations', '/limitations', 'string-array', 'zero-or-more', 'section', ['limitations', 'discussion'], 'limitations', 'Limitations must remain tied to limitations or discussion text.'),
] as const;

function normalizeField(value: string): string {
  return value.trim().replace(/^\//, '').replace(/\[(?:\d+|\*)\]/g, '.*').replace(/\/(?:\d+|\*)/g, '.*').replace(/\//g, '.').replace(/\.\d+\./g, '.*.').toLowerCase();
}

export function extractionContractForField(field: string): ExtractionFieldContract | undefined {
  const normalized = normalizeField(field);
  return EXTRACTION_FIELD_CONTRACTS.find((candidate) => {
    const contractField = candidate.field.toLowerCase();
    const contractPath = normalizeField(candidate.pathPattern);
    return normalized === contractField
      || normalized === contractPath
      || normalized.endsWith(`.${contractField}`)
      || (contractField.startsWith('outcomes.') && normalized.endsWith(contractField.slice('outcomes.'.length)));
  });
}
