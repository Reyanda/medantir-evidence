import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  materializeGitHubHumanScreeningCase,
  parseCsv,
  type GitHubPinnedTextSource,
} from '../src/benchmark/github-screening-case-materializer.js';

function gitBlobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8')).update(bytes).digest('hex');
}

const screener1 = `Title,Abstract,Include?,Screener Name\nA,"Clinical LLM, comma and\nnewline",Yes,R1\nB,Nonclinical writing task,No,R1\nC,Clinical diagnosis with LLM,Yes,R1\n`;
const screener2 = `Title,Abstract,Include?,Screener Name\nA,"Clinical LLM, comma and\nnewline",Yes,R2\nB,Nonclinical writing task,Yes,R2\nC,Clinical diagnosis with LLM,Yes,R2\n`;
const tiebreaks = `Title,Abstract,Screener 1,Screener 2,Final Decision\nB,Nonclinical writing task,No,Yes,No\n`;
const instructions = `{"include":["clinical LLM evaluation"],"exclude":["nonclinical writing"]}`;

function source(path: string, text: string): GitHubPinnedTextSource {
  return { path, blobSha: gitBlobSha(text) };
}

function fixtureFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }) as typeof fetch;
}

function input(fetchImpl: typeof fetch) {
  const repo = 'org/review';
  const commit = 'a'.repeat(40);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  return {
    repository: repo,
    commit,
    candidateId: 'SRQ-FIXTURE',
    caseId: 'CASE-FIXTURE',
    title: 'Human screening fixture',
    domain: 'fixture-domain',
    sourceReview: { doi: '10.1000/fixture' },
    screener1: source('s1.csv', screener1),
    screener2: source('s2.csv', screener2),
    tiebreaks: source('ties.csv', tiebreaks),
    instructions: source('instructions.txt', instructions),
    fetchImpl,
    raw,
  };
}

test('CSV parser preserves quoted commas, escaped structure and embedded newlines', () => {
  const rows = parseCsv(screener1);
  assert.equal(rows.length, 3);
  assert.equal(rows[0]!.Title, 'A');
  assert.equal(rows[0]!.Abstract, 'Clinical LLM, comma and\nnewline');
  assert.equal(rows[2]!['Include?'], 'Yes');
});

test('dual-human screening materialization reconstructs exact agreement and tiebreak gold', async () => {
  const repo = 'org/review';
  const commit = 'a'.repeat(40);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  const fetchImpl = fixtureFetch({
    [raw('s1.csv')]: screener1,
    [raw('s2.csv')]: screener2,
    [raw('ties.csv')]: tiebreaks,
    [raw('instructions.txt')]: instructions,
  });
  const { raw: _raw, ...args } = input(fetchImpl);
  const result = await materializeGitHubHumanScreeningCase(args);
  assert.deepEqual(result.materialization.counts, {
    screener1UniqueTitles: 3,
    screener2UniqueTitles: 3,
    intersection: 3,
    agreements: 2,
    disagreements: 1,
    tiebreaksUsed: 1,
    included: 2,
    excluded: 1,
  });
  assert.deepEqual(result.taskGold.decisions, [
    { recordId: 'LLMCLINICAL-0001', decision: 'include' },
    { recordId: 'LLMCLINICAL-0002', decision: 'exclude' },
    { recordId: 'LLMCLINICAL-0003', decision: 'include' },
  ]);
  assert.equal(result.taskInput.records[0]!.abstract, 'Clinical LLM, comma and\nnewline');
  const task = (result.caseDefinition.tasks as Array<Record<string, any>>)[0]!;
  assert.equal(task.scorer.falseNegativeFatal, true);
  assert.match(task.instruction, /FROZEN SCREENING CONTRACT/);
  assert.match(result.materialization.sourceManifestHash, /^[a-f0-9]{64}$/);
  assert.match(result.materialization.materializationHash, /^[a-f0-9]{64}$/);
  assert.equal(result.materialization.sources.every((item) => item.objectId === `HOBJ-${item.sha256}`), true);
});

test('blob tampering fails before human gold can be materialized', async () => {
  const repo = 'org/review';
  const commit = 'a'.repeat(40);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  const fetchImpl = fixtureFetch({
    [raw('s1.csv')]: `${screener1}tampered`,
    [raw('s2.csv')]: screener2,
    [raw('ties.csv')]: tiebreaks,
    [raw('instructions.txt')]: instructions,
  });
  const { raw: _raw, ...args } = input(fetchImpl);
  await assert.rejects(() => materializeGitHubHumanScreeningCase(args), /Git blob SHA mismatch/i);
});

test('unadjudicated human disagreement fails closed', async () => {
  const repo = 'org/review';
  const commit = 'a'.repeat(40);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  const emptyTies = 'Title,Abstract,Screener 1,Screener 2,Final Decision\n';
  const fetchImpl = fixtureFetch({
    [raw('s1.csv')]: screener1,
    [raw('s2.csv')]: screener2,
    [raw('ties.csv')]: emptyTies,
    [raw('instructions.txt')]: instructions,
  });
  const { raw: _raw, tiebreaks: _ties, ...base } = input(fetchImpl);
  await assert.rejects(() => materializeGitHubHumanScreeningCase({ ...base, tiebreaks: source('ties.csv', emptyTies) }), /has no final tiebreak decision/i);
});

test('screeners cannot silently disagree on source abstract text', async () => {
  const changed = screener2.replace('Clinical diagnosis with LLM', 'Different abstract bytes');
  const repo = 'org/review';
  const commit = 'a'.repeat(40);
  const raw = (path: string) => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  const fetchImpl = fixtureFetch({
    [raw('s1.csv')]: screener1,
    [raw('s2.csv')]: changed,
    [raw('ties.csv')]: tiebreaks,
    [raw('instructions.txt')]: instructions,
  });
  const { raw: _raw, screener2: _s2, ...base } = input(fetchImpl);
  await assert.rejects(() => materializeGitHubHumanScreeningCase({ ...base, screener2: source('s2.csv', changed) }), /disagree on abstract text/i);
});
