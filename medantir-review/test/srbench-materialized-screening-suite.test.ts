import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGitHubHumanScreeningCase } from '../src/benchmark/github-screening-case-materializer.js';
import { loadSrBenchmarkSuite } from '../src/benchmark/sr-benchmark-suite.js';
import { srPipelineCoverage } from '../src/benchmark/sr-reproduction-benchmark.js';

function gitBlobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8')).update(bytes).digest('hex');
}

function fixtureFetch(routes: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

test('materialized human-screening case is leaderboard-valid but cannot enter promotion without a qualification corpus', async () => {
  const root = await mkdtemp(join(tmpdir(), 'srbench-human-screening-'));
  try {
    const repository = 'org/review';
    const commit = 'a'.repeat(40);
    const s1 = 'Title,Abstract,Include?\nA,Clinical LLM diagnosis,Yes\nB,Nonclinical writing,No\n';
    const s2 = 'Title,Abstract,Include?\nA,Clinical LLM diagnosis,Yes\nB,Nonclinical writing,Yes\n';
    const ties = 'Title,Abstract,Final Decision\nB,Nonclinical writing,No\n';
    const instructions = '{"include":["clinical"],"exclude":["nonclinical"]}';
    const raw = (path: string) => `https://raw.githubusercontent.com/${repository}/${commit}/${path}`;
    const fetchImpl = fixtureFetch({
      [raw('s1.csv')]: s1,
      [raw('s2.csv')]: s2,
      [raw('ties.csv')]: ties,
      [raw('instructions.txt')]: instructions,
    });
    const source = (path: string, text: string) => ({ path, blobSha: gitBlobSha(text) });
    await writeGitHubHumanScreeningCase({
      repository,
      commit,
      candidateId: 'SRQ-NONPROMOTION-FIXTURE',
      caseId: 'HUMAN-SCREENING-FIXTURE',
      title: 'Human screening integration fixture',
      domain: 'clinical-ai-meta-research',
      sourceReview: { doi: '10.1000/human-screening' },
      screener1: source('s1.csv', s1),
      screener2: source('s2.csv', s2),
      tiebreaks: source('ties.csv', ties),
      instructions: source('instructions.txt', instructions),
      fetchImpl,
      outputDir: root,
    });

    const loaded = await loadSrBenchmarkSuite(join(root, 'suite.json'));
    assert.equal(loaded.cases.length, 1);
    assert.equal(loaded.cases[0]!.role, 'validation');
    assert.equal(loaded.cases[0]!.benchmarkClass, 'published-review');
    assert.equal(srPipelineCoverage(loaded.cases[0]!.definition), 15);
    assert.equal(loaded.cases[0]!.definition.stageGold['tiab-screening'].status, 'complete');
    assert.equal(loaded.qualificationAdmissions.length, 1);
    assert.equal(loaded.qualificationAdmissions[0]!.status, 'blocked');
    assert.equal(loaded.qualificationAdmissions[0]!.promotionAdmitted, false);
    assert.ok(loaded.qualificationAdmissions[0]!.reasons.some((reason) => /No qualification corpus/i.test(reason)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
