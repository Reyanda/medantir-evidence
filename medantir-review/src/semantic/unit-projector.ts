import { scientificContentHash } from '../core/canonical-hash.js';
import type { ExtractedStudy, PipelineState } from '../core/types.js';
import { tokenisableArtifacts, tokeniseArtifact } from '../tokenisation/index.js';
import type { ArtifactToken, ArtifactTokenDocument, ImradRole } from '../tokenisation/types.js';
import {
  SEMANTIC_UNIT_SCHEMA_VERSION,
  type SemanticMetadataValue,
  type SemanticUnit,
  type SemanticUnitType,
} from './types.js';

export const SEMANTIC_UNIT_PROJECTION_VERSION = 'medantir-semantic-unit-projector/1' as const;

const TEXT_KINDS = new Set([
  'field', 'word', 'identifier', 'citation', 'number', 'operator', 'punctuation', 'boolean', 'null',
]);
const NOISY_ARTIFACTS = new Set(['@stages', '@audit']);
const MAX_SEMANTIC_UNIT_CHARACTERS = 12_000;

export function normalizeSemanticText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

function tokenText(token: ArtifactToken): string {
  if (token.kind === 'field') return `${token.text ?? ''}:`;
  return token.text ?? '';
}

function joinTokens(tokens: ArtifactToken[]): string {
  return tokens
    .filter((token) => TEXT_KINDS.has(token.kind))
    .map(tokenText)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function pointerSegments(pointer: string): string[] {
  if (!pointer || pointer === '/') return [];
  return pointer.split('/').filter(Boolean).map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function topLevelPointer(pointer: string): string {
  const first = pointerSegments(pointer)[0];
  return first ? `/${first.replace(/~/g, '~0').replace(/\//g, '~1')}` : '/';
}

function lastField(pointer: string): string {
  return pointerSegments(pointer).at(-1) ?? '';
}

function unitTypeForPointer(pointer: string, semanticRoles: string[]): SemanticUnitType {
  const lower = pointer.toLowerCase();
  const field = lastField(pointer).toLowerCase();
  if (/\/(?:sourcequotes|sectionevidence|fieldevidence)(?:\/|$)/.test(lower) || field === 'quote') return 'passage';
  if (/\/(?:tables|table)\/\d+\/rows\/\d+/.test(lower)) return 'table-row';
  if (/\boutcomes?\/\d+\/(?:effect|standar(?:d)?error|confidenceinterval|variance|events|total)$/.test(lower)) return 'effect-estimate';
  if (/\boutcomes?\/\d+\/(?:name|label|definition)$/.test(lower)) return 'outcome';
  if (/\bmechanisms?\b/.test(lower)) return 'mechanism';
  if (/\bestimand\b/.test(lower) || semanticRoles.includes('estimand')) return 'estimand';
  if (['rationale', 'objectives', 'resultssummary', 'discussionsummary', 'limitations', 'conclusion'].includes(field)) return 'claim';
  return 'extraction-field';
}

function metadataValue(value: unknown): SemanticMetadataValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value as string[];
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) return value as number[];
  return undefined;
}

function makeUnit(input: {
  unitType: SemanticUnitType;
  document: ArtifactTokenDocument;
  tokens: ArtifactToken[];
  jsonPointers: string[];
  imradRole: ImradRole;
  semanticRoles: string[];
  text: string;
  sourceObjectIds?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}): SemanticUnit | null {
  const text = input.text.replace(/\s+/g, ' ').trim();
  const normalizedText = normalizeSemanticText(text);
  if (!normalizedText || normalizedText === '[redacted]') return null;
  const metadata: Record<string, SemanticMetadataValue> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    const normalized = metadataValue(value);
    if (normalized !== undefined) metadata[key] = normalized;
  }
  const tokenIds = [...new Set(input.tokens.map((token) => token.tokenId))];
  const jsonPointers = [...new Set(input.jsonPointers)].sort();
  const semanticRoles = [...new Set(input.semanticRoles)].sort();
  const sourceObjectIds = [...new Set(input.sourceObjectIds ?? [])].sort();
  const textHash = scientificContentHash(normalizedText);
  const identity = {
    schemaVersion: SEMANTIC_UNIT_SCHEMA_VERSION,
    unitType: input.unitType,
    artifactKey: input.document.artifactKey,
    artifactHash: input.document.artifactHash,
    tokenDocumentHash: input.document.documentHash,
    tokenIds,
    jsonPointers,
    imradRole: input.imradRole,
    semanticRoles,
    textHash,
    sourceObjectIds,
    metadata,
  };
  return {
    ...identity,
    unitId: `semu-${scientificContentHash(identity)}`,
    text,
    normalizedText,
    createdAt: input.createdAt,
  };
}

function tokenGroups(tokens: ArtifactToken[], maximumCharacters = MAX_SEMANTIC_UNIT_CHARACTERS): ArtifactToken[][] {
  const groups: ArtifactToken[][] = [];
  let current: ArtifactToken[] = [];
  let characters = 0;
  for (const token of tokens) {
    const text = tokenText(token);
    const addition = text.length + (current.length ? 1 : 0);
    if (current.length && characters + addition > maximumCharacters) {
      groups.push(current);
      current = [];
      characters = 0;
    }
    current.push(token);
    characters += text.length + (current.length > 1 ? 1 : 0);
  }
  if (current.length) groups.push(current);
  return groups;
}

function boundedUnits(input: Parameters<typeof makeUnit>[0]): SemanticUnit[] {
  if (input.text.length <= MAX_SEMANTIC_UNIT_CHARACTERS) {
    const unit = makeUnit(input);
    return unit ? [unit] : [];
  }
  const output: SemanticUnit[] = [];
  let segment = 0;
  for (const tokens of tokenGroups(input.tokens)) {
    const text = joinTokens(tokens);
    if (text.length <= MAX_SEMANTIC_UNIT_CHARACTERS) {
      const unit = makeUnit({
        ...input,
        unitType: 'passage',
        tokens,
        text,
        metadata: { ...(input.metadata ?? {}), segment, parentUnitType: input.unitType },
      });
      if (unit) output.push(unit);
      segment += 1;
      continue;
    }
    for (let start = 0; start < text.length; start += MAX_SEMANTIC_UNIT_CHARACTERS) {
      const end = Math.min(text.length, start + MAX_SEMANTIC_UNIT_CHARACTERS);
      const unit = makeUnit({
        ...input,
        unitType: 'passage',
        tokens,
        text: text.slice(start, end),
        metadata: {
          ...(input.metadata ?? {}),
          segment,
          parentUnitType: input.unitType,
          projectionStartOffset: start,
          projectionEndOffset: end,
        },
      });
      if (unit) output.push(unit);
      segment += 1;
    }
  }
  return output;
}

function tokensWithin(document: ArtifactTokenDocument, pointer: string): ArtifactToken[] {
  if (!pointer || pointer === '/') return [...document.tokens];
  return document.tokens.filter((token) => token.jsonPointer === pointer || token.jsonPointer.startsWith(`${pointer}/`));
}

function extractedStudyLike(value: unknown): value is ExtractedStudy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.studyId === 'string'
    && Array.isArray(record.reportIds)
    && typeof record.design === 'string'
    && Array.isArray(record.outcomes)
    && Array.isArray(record.mechanisms);
}

function escapedPointer(path: Array<string | number>): string {
  return path.length ? `/${path.map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}` : '';
}

function studyPaths(value: unknown): Array<{ study: ExtractedStudy; pointer: string }> {
  const output: Array<{ study: ExtractedStudy; pointer: string }> = [];
  const seen = new WeakSet<object>();
  const visit = (current: unknown, path: Array<string | number>): void => {
    if (!current || typeof current !== 'object') return;
    const object = current as object;
    if (seen.has(object)) return;
    seen.add(object);
    if (extractedStudyLike(current)) output.push({ study: current, pointer: escapedPointer(path) });
    if (Array.isArray(current)) current.forEach((entry, index) => visit(entry, [...path, index]));
    else Object.entries(current as Record<string, unknown>).forEach(([key, entry]) => visit(entry, [...path, key]));
  };
  visit(value, []);
  return output;
}

function specializedStudyUnits(
  document: ArtifactTokenDocument,
  value: unknown,
  createdAt: string,
): SemanticUnit[] {
  const units: SemanticUnit[] = [];
  for (const { study, pointer } of studyPaths(value)) {
    const studyTokens = tokensWithin(document, pointer);
    const studyText = [
      `Study ${study.studyId}.`,
      `Design: ${study.design}.`,
      `Population: ${study.population}.`,
      `Intervention or exposure: ${study.interventionOrExposure}.`,
      `Comparator: ${study.comparator}.`,
      `Outcomes: ${study.outcomes.map((outcome) => outcome.name).join('; ')}.`,
      study.mechanisms.length ? `Mechanisms: ${study.mechanisms.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    const studyUnit = makeUnit({
      unitType: 'study', document, tokens: studyTokens, jsonPointers: [pointer || '/'], imradRole: 'other',
      semanticRoles: ['study', 'methodology', 'population', 'intervention-or-exposure', 'comparator', 'outcome'],
      text: studyText, sourceObjectIds: [study.studyId, ...study.reportIds],
      metadata: { studyId: study.studyId, reportIds: study.reportIds, design: study.design }, createdAt,
    });
    if (studyUnit) units.push(studyUnit);

    study.outcomes.forEach((outcome, index) => {
      const outcomePointer = `${pointer}/outcomes/${index}`;
      const outcomeTokens = tokensWithin(document, outcomePointer);
      const effect = typeof outcome.effect === 'number' ? ` Effect: ${outcome.effect}.` : '';
      const standardError = typeof outcome.standardError === 'number' ? ` Standard error: ${outcome.standardError}.` : '';
      const outcomeUnit = makeUnit({
        unitType: 'outcome', document, tokens: outcomeTokens, jsonPointers: [outcomePointer],
        imradRole: typeof outcome.effect === 'number' ? 'results' : 'methods', semanticRoles: ['outcome'],
        text: `Outcome: ${outcome.name}.${effect}${standardError}`, sourceObjectIds: [study.studyId, ...study.reportIds],
        metadata: { studyId: study.studyId, outcome: outcome.name, outcomeIndex: index }, createdAt,
      });
      if (outcomeUnit) units.push(outcomeUnit);
      if (typeof outcome.effect === 'number') {
        const effectUnit = makeUnit({
          unitType: 'effect-estimate', document, tokens: outcomeTokens, jsonPointers: [`${outcomePointer}/effect`],
          imradRole: 'results', semanticRoles: ['outcome', 'effect-estimate', 'estimand'],
          text: `Study ${study.studyId}; outcome ${outcome.name}; effect ${outcome.effect}${typeof outcome.standardError === 'number' ? `; standard error ${outcome.standardError}` : ''}.`,
          sourceObjectIds: [study.studyId, ...study.reportIds],
          metadata: { studyId: study.studyId, outcome: outcome.name, effect: outcome.effect, ...(typeof outcome.standardError === 'number' ? { standardError: outcome.standardError } : {}) }, createdAt,
        });
        if (effectUnit) units.push(effectUnit);
      }
    });

    study.mechanisms.forEach((mechanism, index) => {
      const mechanismPointer = `${pointer}/mechanisms/${index}`;
      const mechanismUnit = makeUnit({
        unitType: 'mechanism', document, tokens: tokensWithin(document, mechanismPointer), jsonPointers: [mechanismPointer],
        imradRole: 'discussion', semanticRoles: ['mechanism'], text: mechanism,
        sourceObjectIds: [study.studyId, ...study.reportIds], metadata: { studyId: study.studyId, mechanismIndex: index }, createdAt,
      });
      if (mechanismUnit) units.push(mechanismUnit);
    });

    const claims: Array<{ field: keyof ExtractedStudy; role: ImradRole; values: string[] }> = [
      { field: 'rationale', role: 'introduction', values: [study.rationale] },
      { field: 'objectives', role: 'introduction', values: study.objectives },
      { field: 'resultsSummary', role: 'results', values: [study.resultsSummary] },
      { field: 'discussionSummary', role: 'discussion', values: [study.discussionSummary] },
      { field: 'limitations', role: 'limitations', values: study.limitations },
    ];
    for (const claim of claims) {
      claim.values.forEach((text, index) => {
        if (!text.trim()) return;
        const claimPointer = `${pointer}/${String(claim.field)}${claim.values.length > 1 ? `/${index}` : ''}`;
        const claimUnit = makeUnit({
          unitType: 'claim', document, tokens: tokensWithin(document, claimPointer), jsonPointers: [claimPointer],
          imradRole: claim.role, semanticRoles: ['claim', String(claim.field)], text,
          sourceObjectIds: [study.studyId, ...study.reportIds], metadata: { studyId: study.studyId, field: String(claim.field), claimIndex: index }, createdAt,
        });
        if (claimUnit) units.push(claimUnit);
      });
    }
  }
  return units;
}

function genericUnits(document: ArtifactTokenDocument, createdAt: string): SemanticUnit[] {
  const units: SemanticUnit[] = [];
  const meaningful = document.tokens.filter((token) => TEXT_KINDS.has(token.kind));
  const wholeText = joinTokens(meaningful);
  units.push(...boundedUnits({
    unitType: 'artifact', document, tokens: meaningful, jsonPointers: ['/'], imradRole: 'other',
    semanticRoles: [...new Set(meaningful.flatMap((token) => token.semanticRoles))], text: wholeText,
    metadata: { artifactKey: document.artifactKey }, createdAt,
  }));
  if (NOISY_ARTIFACTS.has(document.artifactKey)) return units;

  const sections = new Map<string, ArtifactToken[]>();
  const scalars = new Map<string, ArtifactToken[]>();
  for (const token of meaningful) {
    const sectionKey = `${token.imradRole}\u0000${topLevelPointer(token.jsonPointer)}`;
    const section = sections.get(sectionKey) ?? [];
    section.push(token);
    sections.set(sectionKey, section);
    const scalarKey = `${token.imradRole}\u0000${token.jsonPointer}`;
    const scalar = scalars.get(scalarKey) ?? [];
    scalar.push(token);
    scalars.set(scalarKey, scalar);
  }

  for (const [key, tokens] of sections) {
    const [roleRaw, pointer = '/'] = key.split('\u0000');
    const role = roleRaw as ImradRole;
    const text = joinTokens(tokens);
    if (normalizeSemanticText(text).length < 12 || text === wholeText) continue;
    units.push(...boundedUnits({
      unitType: 'section', document, tokens, jsonPointers: [pointer], imradRole: role,
      semanticRoles: [...new Set(tokens.flatMap((token) => token.semanticRoles))], text,
      metadata: { boundary: pointer }, createdAt,
    }));
  }

  for (const [key, tokens] of scalars) {
    const [roleRaw, pointer = '/'] = key.split('\u0000');
    const role = roleRaw as ImradRole;
    const text = joinTokens(tokens);
    const normalized = normalizeSemanticText(text);
    const hasValue = tokens.some((token) => token.kind !== 'field' && Boolean(token.text));
    if (!hasValue || normalized.length < 3 || pointer === '/') continue;
    if (role === 'not-applicable' && !tokens.some((token) => token.semanticRoles.length > 0)) continue;
    units.push(...boundedUnits({
      unitType: unitTypeForPointer(pointer, tokens.flatMap((token) => token.semanticRoles)),
      document, tokens, jsonPointers: [pointer], imradRole: role,
      semanticRoles: [...new Set(tokens.flatMap((token) => token.semanticRoles))], text,
      metadata: { field: lastField(pointer), jsonPointer: pointer }, createdAt,
    }));
  }
  return units;
}

export function projectSemanticUnits(
  state: PipelineState,
  generatedAt = new Date().toISOString(),
): SemanticUnit[] {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Semantic unit generatedAt must be a valid timestamp.');
  const byId = new Map<string, SemanticUnit>();
  for (const { artifactKey, value } of tokenisableArtifacts(state)) {
    const document = tokeniseArtifact(artifactKey, value, generatedAt);
    for (const unit of [...genericUnits(document, generatedAt), ...specializedStudyUnits(document, value, generatedAt)]) {
      if (!byId.has(unit.unitId)) byId.set(unit.unitId, unit);
    }
  }
  return [...byId.values()].sort((left, right) => `${left.artifactKey}\u0000${left.unitType}\u0000${left.unitId}`.localeCompare(`${right.artifactKey}\u0000${right.unitType}\u0000${right.unitId}`));
}

export function verifySemanticUnit(unit: SemanticUnit): void {
  if (unit.schemaVersion !== SEMANTIC_UNIT_SCHEMA_VERSION) throw new Error('Unsupported semantic unit schema.');
  if (!unit.text.trim() || !unit.normalizedText.trim()) throw new Error(`Semantic unit ${unit.unitId} has no text.`);
  if (unit.text.length > MAX_SEMANTIC_UNIT_CHARACTERS) throw new Error(`Semantic unit ${unit.unitId} exceeds the maximum projection size.`);
  if (normalizeSemanticText(unit.text) !== unit.normalizedText) throw new Error(`Semantic unit ${unit.unitId} normalized text mismatch.`);
  if (scientificContentHash(unit.normalizedText) !== unit.textHash) throw new Error(`Semantic unit ${unit.unitId} text hash mismatch.`);
  const identity = {
    schemaVersion: unit.schemaVersion,
    unitType: unit.unitType,
    artifactKey: unit.artifactKey,
    artifactHash: unit.artifactHash,
    tokenDocumentHash: unit.tokenDocumentHash,
    tokenIds: unit.tokenIds,
    jsonPointers: unit.jsonPointers,
    imradRole: unit.imradRole,
    semanticRoles: unit.semanticRoles,
    textHash: unit.textHash,
    sourceObjectIds: unit.sourceObjectIds,
    metadata: unit.metadata,
  };
  if (unit.unitId !== `semu-${scientificContentHash(identity)}`) throw new Error(`Semantic unit ${unit.unitId} identity mismatch.`);
}
