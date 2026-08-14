import { canonicalScientificValue, scientificContentHash } from '../core/canonical-hash.js';
import { imradRoleForPath, jsonPointer, semanticRolesForPath } from './imrad.js';
import {
  ARTIFACT_TOKEN_DOCUMENT_SCHEMA,
  type ArtifactToken,
  type ArtifactTokenDocument,
  type ArtifactTokenKind,
  type ImradRole,
} from './types.js';

const STRUCTURAL_KINDS = new Set<ArtifactTokenKind>([
  'object-start', 'object-end', 'array-start', 'array-end', 'field', 'array-item', 'string', 'number', 'boolean', 'null',
]);

export function isStructuralTokenKind(kind: ArtifactTokenKind): boolean {
  return STRUCTURAL_KINDS.has(kind);
}

function cleanArtifactKey(value: string): string {
  const clean = value.trim();
  if (!clean) throw new Error('Artifact key cannot be empty.');
  if (clean.length > 512) throw new Error('Artifact key is too long.');
  return clean;
}

function lexicalKind(text: string): ArtifactTokenKind {
  if (/^(?:\[[0-9,;\-\s]+\]|\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)|https?:\/\/|10\.\d{4,9}\/)/u.test(text)) return 'citation';
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?$/u.test(text)) return 'number';
  if (/^(?:<=|>=|!=|==|=|<|>|\+|-|\/|\*|±|→|←|↔|∝)$/u.test(text)) return 'operator';
  if (/^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u.test(text)) return 'word';
  if (/^[\p{L}\p{M}][\p{L}\p{M}\p{N}_.:/\-]*$/u.test(text)) return 'identifier';
  return 'punctuation';
}

function lexemes(value: string): Array<{ text: string; start: number; end: number; kind: ArtifactTokenKind }> {
  const pattern = /\[[0-9,;\-\s]+\]|\([A-Z][^)]*\b(?:19|20)\d{2}[a-z]?\)|https?:\/\/[^\s]+|10\.\d{4,9}\/[^\s]+|[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%?|<=|>=|!=|==|[=<>+*/±→←↔∝-]|[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*|[\p{L}\p{M}][\p{L}\p{M}\p{N}_.:/\-]*|[^\s]/gu;
  const output: Array<{ text: string; start: number; end: number; kind: ArtifactTokenKind }> = [];
  for (const match of value.matchAll(pattern)) {
    const text = match[0];
    const start = match.index ?? 0;
    output.push({ text, start, end: start + text.length, kind: lexicalKind(text) });
  }
  return output;
}

function tokenIdentity(token: Omit<ArtifactToken, 'tokenId'>): string {
  return `tok-${scientificContentHash(token)}`;
}

function stableCounts(tokens: ArtifactToken[]): ArtifactTokenDocument['counts'] {
  const byKind: Partial<Record<ArtifactTokenKind, number>> = {};
  const byImradRole: Partial<Record<ImradRole, number>> = {};
  let structural = 0;
  for (const token of tokens) {
    byKind[token.kind] = (byKind[token.kind] ?? 0) + 1;
    byImradRole[token.imradRole] = (byImradRole[token.imradRole] ?? 0) + 1;
    if (isStructuralTokenKind(token.kind)) structural += 1;
  }
  return { total: tokens.length, structural, lexical: tokens.length - structural, byKind, byImradRole };
}

export function estimateModelTokens(text: string): number {
  const bytes = Buffer.byteLength(text, 'utf8');
  return bytes === 0 ? 0 : Math.max(1, Math.ceil(bytes / 4));
}

function binaryProjection(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { binary: true, byteLength: bytes.byteLength, contentHash: scientificContentHash(Array.from(bytes)) };
  }
  return value;
}

export function tokeniseArtifact(
  artifactKeyInput: string,
  value: unknown,
  generatedAt = new Date().toISOString(),
): ArtifactTokenDocument {
  const artifactKey = cleanArtifactKey(artifactKeyInput);
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Token document generatedAt must be a valid timestamp.');
  const canonical = canonicalScientificValue(binaryProjection(value)) ?? null;
  const artifactHash = scientificContentHash(canonical);
  const tokens: ArtifactToken[] = [];

  const emit = (input: Omit<ArtifactToken, 'tokenId' | 'sequence' | 'artifactKey'>): ArtifactToken => {
    const unsigned: Omit<ArtifactToken, 'tokenId'> = {
      sequence: tokens.length + 1,
      artifactKey,
      ...input,
      semanticRoles: [...new Set(input.semanticRoles)].sort(),
    };
    const token: ArtifactToken = { ...unsigned, tokenId: tokenIdentity(unsigned) };
    tokens.push(token);
    return token;
  };

  const walk = (
    current: unknown,
    segments: Array<string | number>,
    parentTokenId: string | null,
    inheritedRole: ImradRole,
  ): void => {
    const path = jsonPointer(segments);
    const role = imradRoleForPath(segments, inheritedRole);
    const semanticRoles = semanticRolesForPath(segments);

    if (Array.isArray(current)) {
      const start = emit({ jsonPointer: path, parentTokenId, kind: 'array-start', imradRole: role, semanticRoles, characterLength: current.length, valueHash: scientificContentHash(current) });
      current.forEach((item, index) => {
        const itemSegments = [...segments, index];
        const itemRole = imradRoleForPath(itemSegments, role);
        const itemToken = emit({ jsonPointer: jsonPointer(itemSegments), parentTokenId: start.tokenId, kind: 'array-item', imradRole: itemRole, semanticRoles: semanticRolesForPath(itemSegments), text: String(index), normalized: String(index) });
        walk(item, itemSegments, itemToken.tokenId, itemRole);
      });
      emit({ jsonPointer: path, parentTokenId: start.tokenId, kind: 'array-end', imradRole: role, semanticRoles });
      return;
    }

    if (current !== null && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const start = emit({ jsonPointer: path, parentTokenId, kind: 'object-start', imradRole: role, semanticRoles, characterLength: keys.length, valueHash: scientificContentHash(record) });
      for (const key of keys) {
        const childSegments = [...segments, key];
        const childRole = imradRoleForPath(childSegments, role);
        const field = emit({ jsonPointer: jsonPointer(childSegments), parentTokenId: start.tokenId, kind: 'field', imradRole: childRole, semanticRoles: semanticRolesForPath(childSegments), text: key, normalized: key.toLowerCase() });
        walk(record[key], childSegments, field.tokenId, childRole);
      }
      emit({ jsonPointer: path, parentTokenId: start.tokenId, kind: 'object-end', imradRole: role, semanticRoles });
      return;
    }

    if (typeof current === 'string') {
      const scalar = emit({ jsonPointer: path, parentTokenId, kind: 'string', imradRole: role, semanticRoles, characterLength: current.length, valueHash: scientificContentHash(current) });
      for (const lexeme of lexemes(current)) {
        emit({
          jsonPointer: path,
          parentTokenId: scalar.tokenId,
          kind: lexeme.kind,
          imradRole: role,
          semanticRoles,
          text: lexeme.text,
          normalized: lexeme.kind === 'word' || lexeme.kind === 'identifier' ? lexeme.text.toLocaleLowerCase('en') : lexeme.text,
          startOffset: lexeme.start,
          endOffset: lexeme.end,
          characterLength: lexeme.text.length,
          valueHash: scientificContentHash(lexeme.text),
        });
      }
      return;
    }

    if (typeof current === 'number') {
      emit({ jsonPointer: path, parentTokenId, kind: 'number', imradRole: role, semanticRoles, text: String(current), normalized: String(current), valueHash: scientificContentHash(current) });
      return;
    }
    if (typeof current === 'boolean') {
      emit({ jsonPointer: path, parentTokenId, kind: 'boolean', imradRole: role, semanticRoles, text: String(current), normalized: String(current), valueHash: scientificContentHash(current) });
      return;
    }
    emit({ jsonPointer: path, parentTokenId, kind: 'null', imradRole: role, semanticRoles, text: 'null', normalized: 'null', valueHash: scientificContentHash(null) });
  };

  walk(canonical, [], null, 'other');
  const counts = stableCounts(tokens);
  const canonicalJson = JSON.stringify(canonical) ?? 'null';
  const unsignedDocument = {
    schemaVersion: ARTIFACT_TOKEN_DOCUMENT_SCHEMA,
    artifactKey,
    artifactHash,
    generatedAt,
    tokens,
    counts,
    modelBudget: {
      method: 'utf8-four-byte-estimate' as const,
      estimatedTokens: estimateModelTokens(canonicalJson),
      exact: false as const,
    },
  };
  return { ...unsignedDocument, documentHash: scientificContentHash({ ...unsignedDocument, generatedAt: undefined }) };
}

export function verifyArtifactTokenDocument(document: ArtifactTokenDocument): void {
  if (document.schemaVersion !== ARTIFACT_TOKEN_DOCUMENT_SCHEMA) throw new Error('Unsupported artifact token document schema.');
  cleanArtifactKey(document.artifactKey);
  if (!Number.isFinite(Date.parse(document.generatedAt))) throw new Error('Artifact token document generatedAt is invalid.');
  const ids = new Set<string>();
  for (let index = 0; index < document.tokens.length; index += 1) {
    const token = document.tokens[index];
    if (!token) throw new Error(`Artifact token ${index + 1} is missing.`);
    if (token.sequence !== index + 1) throw new Error(`Artifact token sequence mismatch at ${index + 1}.`);
    if (token.artifactKey !== document.artifactKey) throw new Error(`Artifact token ${token.tokenId} belongs to a different artifact.`);
    const { tokenId, ...unsigned } = token;
    if (tokenId !== tokenIdentity(unsigned)) throw new Error(`Artifact token identity mismatch for ${tokenId}.`);
    if (ids.has(tokenId)) throw new Error(`Artifact token document duplicates ${tokenId}.`);
    if (token.parentTokenId !== null && !ids.has(token.parentTokenId)) throw new Error(`Artifact token ${tokenId} references a missing or forward parent.`);
    ids.add(tokenId);
  }
  const expectedCounts = stableCounts(document.tokens);
  if (scientificContentHash(expectedCounts) !== scientificContentHash(document.counts)) throw new Error('Artifact token count summary mismatch.');
  const { documentHash, ...unsignedDocument } = document;
  const expectedHash = scientificContentHash({ ...unsignedDocument, generatedAt: undefined });
  if (documentHash !== expectedHash) throw new Error('Artifact token document hash mismatch.');
}
