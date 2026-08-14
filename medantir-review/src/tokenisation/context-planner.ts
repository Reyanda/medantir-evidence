import { scientificContentHash } from '../core/canonical-hash.js';
import { estimateModelTokens, isStructuralTokenKind, verifyArtifactTokenDocument } from './tokeniser.js';
import type {
  ArtifactContextPlan,
  ArtifactToken,
  ArtifactTokenDocument,
  ContextPlanChunk,
  ModelTokenCounterPort,
} from './types.js';

function topLevelBoundary(jsonPointer: string): string {
  const segment = jsonPointer.split('/').filter(Boolean)[0];
  return segment ? `/${segment}` : '/';
}

function tokenText(token: ArtifactToken): string {
  if (token.kind === 'field') return `${token.text ?? ''}:`;
  if (token.kind === 'array-item') return '';
  return token.text ?? '';
}

function joinTokenText(tokens: ArtifactToken[]): string {
  return tokens.map(tokenText).filter(Boolean).join(' ').replace(/\s+([,.;:!?%)\]])/g, '$1').replace(/([([])\s+/g, '$1').trim();
}

function chunk(
  document: ArtifactTokenDocument,
  boundary: string,
  tokens: ArtifactToken[],
  text: string,
  modelTokens: number,
  countMethod: ContextPlanChunk['countMethod'],
  splitBoundary: boolean,
): ContextPlanChunk {
  const content = {
    artifactKey: document.artifactKey,
    imradRole: tokens[0]?.imradRole ?? 'other' as const,
    boundary,
    tokenDocumentHash: document.documentHash,
    tokenIds: tokens.map((token) => token.tokenId),
    text,
    modelTokens,
    countMethod,
    splitBoundary,
  };
  return { ...content, chunkId: `ctx-${scientificContentHash(content)}` };
}

export function buildArtifactContextPlan(
  documents: ArtifactTokenDocument[],
  input: {
    maxContextTokens: number;
    reservedOutputTokens: number;
    counter?: ModelTokenCounterPort;
  },
): ArtifactContextPlan {
  if (!Number.isSafeInteger(input.maxContextTokens) || input.maxContextTokens < 1) throw new Error('maxContextTokens must be a positive integer.');
  if (!Number.isSafeInteger(input.reservedOutputTokens) || input.reservedOutputTokens < 0 || input.reservedOutputTokens >= input.maxContextTokens) throw new Error('reservedOutputTokens must be a non-negative integer smaller than maxContextTokens.');
  documents.forEach(verifyArtifactTokenDocument);
  const usableInputTokens = input.maxContextTokens - input.reservedOutputTokens;
  const count = (text: string): number => input.counter ? input.counter.count(text) : estimateModelTokens(text);
  const countMethod = input.counter ? 'exact-adapter' as const : 'utf8-four-byte-estimate' as const;
  const chunks: ContextPlanChunk[] = [];
  const warnings: string[] = [];

  for (const document of documents) {
    const groups = new Map<string, ArtifactToken[]>();
    for (const token of document.tokens) {
      if (isStructuralTokenKind(token.kind) && !['field', 'number', 'boolean', 'null'].includes(token.kind)) continue;
      const boundary = `${token.imradRole}:${topLevelBoundary(token.jsonPointer)}`;
      const group = groups.get(boundary) ?? [];
      group.push(token);
      groups.set(boundary, group);
    }
    for (const [boundary, tokens] of groups) {
      const completeText = joinTokenText(tokens);
      const completeCount = count(completeText);
      if (completeCount <= usableInputTokens) {
        chunks.push(chunk(document, boundary, tokens, completeText, completeCount, countMethod, false));
        continue;
      }
      warnings.push(`Boundary ${document.artifactKey}${boundary} exceeded the usable context budget and was split without crossing its artifact or IMRAD role.`);
      let current: ArtifactToken[] = [];
      for (const token of tokens) {
        const candidate = [...current, token];
        const candidateText = joinTokenText(candidate);
        if (current.length && count(candidateText) > usableInputTokens) {
          const text = joinTokenText(current);
          chunks.push(chunk(document, boundary, current, text, count(text), countMethod, true));
          current = [token];
        } else current = candidate;
      }
      if (current.length) {
        const text = joinTokenText(current);
        chunks.push(chunk(document, boundary, current, text, count(text), countMethod, true));
      }
    }
  }

  const content = {
    schemaVersion: 'medantir-artifact-context-plan/1' as const,
    maxContextTokens: input.maxContextTokens,
    reservedOutputTokens: input.reservedOutputTokens,
    usableInputTokens,
    countMethod,
    ...(input.counter ? { counterId: input.counter.counterId } : {}),
    chunks,
    warnings,
  };
  return { ...content, planHash: scientificContentHash(content) };
}
