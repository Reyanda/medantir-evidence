import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scientificContentHash } from '../core/canonical-hash.js';

export const GITHUB_SCREENING_MATERIALIZATION_SCHEMA_VERSION = 'medantir-github-screening-materialization/1' as const;

export interface GitHubPinnedTextSource {
  path: string;
  blobSha: string;
}

export interface GitHubHumanScreeningMaterializerInput {
  repository: string;
  commit: string;
  candidateId: string;
  caseId: string;
  title: string;
  domain: string;
  sourceReview: { doi?: string; pmid?: string; pmcid?: string; citation?: string };
  screener1: GitHubPinnedTextSource;
  screener2: GitHubPinnedTextSource;
  tiebreaks: GitHubPinnedTextSource;
  instructions: GitHubPinnedTextSource;
  fetchImpl?: typeof fetch;
  githubToken?: string;
}

export interface GitHubMaterializedObject {
  repository: string;
  commit: string;
  path: string;
  gitBlobSha: string;
  objectId: string;
  sha256: string;
  byteLength: number;
}

export interface HumanScreeningGoldRow {
  recordId: string;
  title: string;
  abstract: string;
  decision: 'include' | 'exclude';
  adjudication: 'agreement' | 'tiebreak';
}

export interface GitHubHumanScreeningMaterialization {
  schemaVersion: typeof GITHUB_SCREENING_MATERIALIZATION_SCHEMA_VERSION;
  repository: string;
  commit: string;
  candidateId: string;
  caseId: string;
  sources: GitHubMaterializedObject[];
  counts: {
    screener1UniqueTitles: number;
    screener2UniqueTitles: number;
    intersection: number;
    agreements: number;
    disagreements: number;
    tiebreaksUsed: number;
    included: number;
    excluded: number;
  };
  sourceManifestHash: string;
  materializationHash: string;
}

interface CsvRow { [key: string]: string }

function fullCommit(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error('GitHub screening materializer requires a full 40-character commit SHA.');
  return result;
}

function blobSha(value: string, label: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error(`${label} must be a full Git blob SHA.`);
  return result;
}

function repository(value: string): string {
  const result = value.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(result)) throw new Error('GitHub repository must be owner/name.');
  return result;
}

function sourcePath(value: string): string {
  const result = value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!result || result.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Invalid GitHub source path '${value}'.`);
  return result;
}

function rawUrl(repo: string, commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function gitBlobSha(bytes: Uint8Array): string {
  const prefix = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8');
  return createHash('sha1').update(prefix).update(bytes).digest('hex');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchPinnedSource(input: {
  repo: string;
  commit: string;
  source: GitHubPinnedTextSource;
  fetchImpl: typeof fetch;
  githubToken?: string;
}): Promise<{ text: string; object: GitHubMaterializedObject }> {
  const path = sourcePath(input.source.path);
  const expectedBlob = blobSha(input.source.blobSha, `GitHub blob for '${path}'`);
  const response = await input.fetchImpl(rawUrl(input.repo, input.commit, path), {
    headers: input.githubToken?.trim() ? { authorization: `Bearer ${input.githubToken.trim()}` } : {},
  });
  if (!response.ok) throw new Error(`GitHub source download failed HTTP ${response.status} for '${path}'.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const observedBlob = gitBlobSha(bytes);
  if (observedBlob !== expectedBlob) throw new Error(`Git blob SHA mismatch for '${path}': expected ${expectedBlob}, observed ${observedBlob}.`);
  const digest = sha256(bytes);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return {
    text,
    object: {
      repository: input.repo,
      commit: input.commit,
      path,
      gitBlobSha: observedBlob,
      objectId: `HOBJ-${digest}`,
      sha256: digest,
      byteLength: bytes.byteLength,
    },
  };
}

/** RFC-4180-style parser supporting quoted commas, escaped quotes and embedded newlines. */
export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += char;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field.');
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (rows.length === 0) throw new Error('CSV contains no rows.');
  const headers = rows[0]!.map((header) => header.trim());
  if (headers.some((header) => !header)) {
    // The historical human-screening CSVs contain trailing summary columns with blank headers.
    // Preserve their positions but do not expose them as named fields.
  }
  return rows.slice(1).filter((values) => values.some((value) => value.trim())).map((values) => {
    const output: CsvRow = {};
    headers.forEach((header, index) => { if (header) output[header] = values[index] ?? ''; });
    return output;
  });
}

function normalizeDecision(value: string, label: string): 'include' | 'exclude' {
  const result = value.trim().toLowerCase();
  if (result === 'yes' || result === 'include' || result === 'included') return 'include';
  if (result === 'no' || result === 'exclude' || result === 'excluded') return 'exclude';
  throw new Error(`${label} has unsupported decision '${value}'.`);
}

function titleMap(rows: CsvRow[], decisionColumn: string, label: string): Map<string, { abstract: string; decision: 'include' | 'exclude' }> {
  const map = new Map<string, { abstract: string; decision: 'include' | 'exclude' }>();
  for (const row of rows) {
    const title = (row.Title ?? '').trim();
    if (!title) continue;
    if (map.has(title)) throw new Error(`${label} contains duplicate title '${title}'.`);
    const abstract = row.Abstract ?? '';
    map.set(title, { abstract, decision: normalizeDecision(row[decisionColumn] ?? '', `${label} '${title}'`) });
  }
  return map;
}

function tiebreakMap(rows: CsvRow[]): Map<string, 'include' | 'exclude'> {
  const map = new Map<string, 'include' | 'exclude'>();
  for (const row of rows) {
    const title = (row.Title ?? '').trim();
    if (!title) continue;
    if (map.has(title)) throw new Error(`Tiebreak CSV contains duplicate title '${title}'.`);
    map.set(title, normalizeDecision(row['Final Decision'] ?? '', `Tiebreak '${title}'`));
  }
  return map;
}

function makeRows(input: { screener1: string; screener2: string; tiebreaks: string }): {
  rows: HumanScreeningGoldRow[];
  counts: GitHubHumanScreeningMaterialization['counts'];
} {
  const one = titleMap(parseCsv(input.screener1), 'Include?', 'Screener 1');
  const two = titleMap(parseCsv(input.screener2), 'Include?', 'Screener 2');
  const ties = tiebreakMap(parseCsv(input.tiebreaks));
  const intersection = [...one.keys()].filter((title) => two.has(title)).sort((a, b) => a.localeCompare(b));
  if (intersection.length === 0) throw new Error('Human screening sources have no overlapping titles.');
  const rows: HumanScreeningGoldRow[] = [];
  let agreements = 0;
  let disagreements = 0;
  let tiebreaksUsed = 0;
  intersection.forEach((title, index) => {
    const left = one.get(title)!;
    const right = two.get(title)!;
    if (left.abstract !== right.abstract) throw new Error(`Screeners disagree on abstract text for '${title}'.`);
    let decision: 'include' | 'exclude';
    let adjudication: 'agreement' | 'tiebreak';
    if (left.decision === right.decision) {
      decision = left.decision;
      adjudication = 'agreement';
      agreements += 1;
    } else {
      disagreements += 1;
      const final = ties.get(title);
      if (!final) throw new Error(`Human disagreement for '${title}' has no final tiebreak decision.`);
      decision = final;
      adjudication = 'tiebreak';
      tiebreaksUsed += 1;
    }
    rows.push({
      recordId: `LLMCLINICAL-${String(index + 1).padStart(4, '0')}`,
      title,
      abstract: left.abstract,
      decision,
      adjudication,
    });
  });
  if (tiebreaksUsed !== disagreements) throw new Error('Not every human disagreement was adjudicated.');
  return {
    rows,
    counts: {
      screener1UniqueTitles: one.size,
      screener2UniqueTitles: two.size,
      intersection: intersection.length,
      agreements,
      disagreements,
      tiebreaksUsed,
      included: rows.filter((row) => row.decision === 'include').length,
      excluded: rows.filter((row) => row.decision === 'exclude').length,
    },
  };
}

export async function materializeGitHubHumanScreeningCase(input: GitHubHumanScreeningMaterializerInput): Promise<{
  materialization: GitHubHumanScreeningMaterialization;
  caseDefinition: Record<string, unknown>;
  suiteDefinition: Record<string, unknown>;
  taskInput: { records: Array<{ recordId: string; title: string; abstract: string }> };
  taskGold: { decisions: Array<{ recordId: string; decision: 'include' | 'exclude' }> };
}> {
  const repo = repository(input.repository);
  const commit = fullCommit(input.commit);
  if (!input.candidateId.trim() || !input.caseId.trim() || !input.title.trim() || !input.domain.trim()) throw new Error('Materializer requires candidate, case, title and domain identity.');
  const fetchImpl = input.fetchImpl ?? fetch;
  const sources = await Promise.all([
    fetchPinnedSource({ repo, commit, source: input.screener1, fetchImpl, ...(input.githubToken ? { githubToken: input.githubToken } : {}) }),
    fetchPinnedSource({ repo, commit, source: input.screener2, fetchImpl, ...(input.githubToken ? { githubToken: input.githubToken } : {}) }),
    fetchPinnedSource({ repo, commit, source: input.tiebreaks, fetchImpl, ...(input.githubToken ? { githubToken: input.githubToken } : {}) }),
    fetchPinnedSource({ repo, commit, source: input.instructions, fetchImpl, ...(input.githubToken ? { githubToken: input.githubToken } : {}) }),
  ]);
  const reconstructed = makeRows({ screener1: sources[0]!.text, screener2: sources[1]!.text, tiebreaks: sources[2]!.text });
  const sourceObjects = sources.map((source) => source.object).sort((a, b) => a.path.localeCompare(b.path));
  const sourceManifestBase = { repository: repo, commit, sources: sourceObjects, counts: reconstructed.counts };
  const sourceManifestHash = scientificContentHash(sourceManifestBase);
  const materializationBase = {
    schemaVersion: GITHUB_SCREENING_MATERIALIZATION_SCHEMA_VERSION,
    repository: repo,
    commit,
    candidateId: input.candidateId.trim(),
    caseId: input.caseId.trim(),
    sources: sourceObjects,
    counts: reconstructed.counts,
    sourceManifestHash,
  };
  const materialization: GitHubHumanScreeningMaterialization = {
    ...materializationBase,
    materializationHash: scientificContentHash(materializationBase),
  };
  const taskInput = {
    records: reconstructed.rows.map((row) => ({ recordId: row.recordId, title: row.title, abstract: row.abstract })),
  };
  const taskGold = {
    decisions: reconstructed.rows.map((row) => ({ recordId: row.recordId, decision: row.decision })),
  };
  const missing = (reason: string) => ({ status: 'missing', reason });
  const caseDefinition = {
    schemaVersion: 'medantir-srbench/1',
    benchmarkClass: 'published-review',
    caseId: input.caseId.trim(),
    title: input.title.trim(),
    domain: input.domain.trim(),
    reviewType: 'systematic',
    sourceReview: input.sourceReview,
    stageReceiptFiles: { 'tiab-screening': 'source-manifest.json' },
    stageGold: {
      question: missing('Specialist hard-screening case; question stage is outside this isolated benchmark.'),
      protocol: missing('The historical review had no prospective protocol; this absence is not backfilled.'),
      search: missing('Search execution is outside this isolated hard-screening case.'),
      deduplication: missing('Deduplication execution is outside this isolated hard-screening case.'),
      'tiab-screening': { status: 'complete', receiptHash: 'AUTO' },
      'fulltext-screening': missing('No separate classical full-text ledger is asserted by this case.'),
      extraction: missing('Extraction is outside this isolated hard-screening case.'),
      appraisal: missing('No classical study-level appraisal plane is asserted by this case.'),
      synthesis: missing('Synthesis is outside this isolated hard-screening case.'),
      report: missing('Report regeneration is outside this isolated hard-screening case.'),
    },
    tasks: [{
      id: 'llm-clinical-human-500-ti-ab-screening',
      stage: 'tiab-screening',
      critical: true,
      instruction: `Apply the frozen historical screening contract below to every title/abstract record. Return exactly one decision per recordId using decision='include' or decision='exclude'. Do not omit records and do not invent IDs.\n\nFROZEN SCREENING CONTRACT:\n${sources[3]!.text}`,
      inputFile: 'input.json',
      goldFile: 'gold.json',
      outputSchema: { decisions: [{ recordId: 'LLMCLINICAL-0001', decision: 'include|exclude' }] },
      scorer: {
        kind: 'classification-ledger',
        path: 'decisions',
        idKey: 'recordId',
        labelKey: 'decision',
        positiveLabel: 'include',
        negativeLabel: 'exclude',
        falseNegativeFatal: true,
      },
    }],
  };
  const suiteDefinition = {
    schemaVersion: 'medantir-srbench-suite/1',
    suiteId: `${input.caseId.trim()}-SUITE`,
    suiteVersion: '1.0.0',
    cases: [{ path: 'case.json', enabled: true, role: 'validation', qualificationCandidateId: input.candidateId.trim() }],
  };
  return { materialization, caseDefinition, suiteDefinition, taskInput, taskGold };
}

export async function writeGitHubHumanScreeningCase(input: GitHubHumanScreeningMaterializerInput & { outputDir: string }): Promise<{
  outputDir: string;
  materialization: GitHubHumanScreeningMaterialization;
}> {
  const result = await materializeGitHubHumanScreeningCase(input);
  const outputDir = resolve(input.outputDir);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDir, 'source-manifest.json'), `${JSON.stringify(result.materialization, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDir, 'input.json'), `${JSON.stringify(result.taskInput, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDir, 'gold.json'), `${JSON.stringify(result.taskGold, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDir, 'case.json'), `${JSON.stringify(result.caseDefinition, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDir, 'suite.json'), `${JSON.stringify(result.suiteDefinition, null, 2)}\n`, 'utf8'),
  ]);
  return { outputDir, materialization: result.materialization };
}
