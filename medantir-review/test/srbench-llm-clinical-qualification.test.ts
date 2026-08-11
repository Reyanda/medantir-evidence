import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createSrQualificationCandidate,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  createSrAnalysisReproductionPreflight,
  type SrAnalysisReproductionPreflightInput,
} from '../src/benchmark/sr-analysis-reproduction-preflight.js';

const ROOT = resolve('benchmarks/srbench-v1/llm-clinical-2026');
const SOURCE_COMMIT = '69597fdd1dd2cd45417446997af5af671853e2ec';

test('Nature Medicine LLM review is useful benchmark evidence but cannot masquerade as full-pipeline promotion gold', async () => {
  const raw = JSON.parse(await readFile(resolve(ROOT, 'qualification-candidate.json'), 'utf8')) as SrQualificationCandidateInput;
  const candidate = createSrQualificationCandidate(raw);

  assert.equal(candidate.candidateId, 'SRQ-LLM-CLINICAL-2026');
  assert.equal(candidate.domain, 'clinical-ai-meta-research');
  assert.equal(candidate.promotionEligible, false);
  assert.notEqual(candidate.readiness, 'validation-ready');

  assert.deepEqual(candidate.assets.protocol, {
    status: 'missing',
    basis: 'not-available',
    notes: [
      'The version-of-record explicitly states that the review was not prospectively registered and that a protocol was not prepared. This historical absence must not be backfilled retrospectively.'
    ]
  });
  assert.equal(candidate.assets['fulltext-truth'].status, 'missing');
  assert.equal(candidate.assets['fulltext-truth'].basis, 'not-available');
  assert.equal(candidate.assets['appraisal-truth'].status, 'missing');
  assert.equal(candidate.assets['appraisal-truth'].basis, 'not-available');

  assert.equal(candidate.assets['search-corpus'].status, 'frozen-unverified');
  assert.equal(candidate.assets['dedup-truth'].status, 'frozen-unverified');
  assert.equal(candidate.assets['tiab-truth'].status, 'available-unfrozen');
  assert.ok(candidate.assets['tiab-truth'].notes?.some((note) => /not full-corpus human screening truth/i.test(note)));
  assert.equal(candidate.assets['analysis-runtime'].status, 'frozen-unverified');
});

test('Nature Medicine LLM review runtime preflight fails closed on historical environment ambiguity', async () => {
  const raw = JSON.parse(await readFile(resolve(ROOT, 'runtime-preflight.json'), 'utf8')) as SrAnalysisReproductionPreflightInput;
  const report = createSrAnalysisReproductionPreflight(raw);

  assert.equal(report.sourceCommit, SOURCE_COMMIT);
  assert.equal(report.exactReproductionReady, false);
  assert.equal(report.runnableWithoutSemanticRepair, false);
  assert.equal(report.unresolvedRuntimeIdentity, true);
  assert.equal(report.blockerCount, 3);
  assert.equal(report.warningCount, 2);
  assert.ok(report.findings.some((finding) => finding.code === 'PYTHON_VERSION_CONFLICT'));
  assert.ok(report.findings.some((finding) => finding.code === 'POST_ANALYSIS_STATISTICAL_ALIGNMENT'));
  assert.ok(report.findings.some((finding) => finding.code === 'DEPENDENCY_MANIFEST_INCOMPLETE'));
});

test('source map distinguishes immutable Git identity from missing generated intermediates and from SHA-256 HOBJs', async () => {
  const map = JSON.parse(await readFile(resolve(ROOT, 'source-map.json'), 'utf8')) as any;
  assert.equal(map.sourceCommit, SOURCE_COMMIT);
  assert.equal(map.identityPolicy.gitCommitIsImmutableSourceIdentity, true);
  assert.equal(map.identityPolicy.gitBlobShaIsFineGrainedGitIdentity, true);
  assert.equal(map.identityPolicy.gitBlobShaIsNotSha256Hobj, true);
  assert.equal(map.identityPolicy.verificationRequiredBeforeGold, true);

  const paths = new Set(map.artifacts.map((item: any) => item.path));
  assert.ok(paths.has('embase-export-9-6-25.csv'));
  assert.ok(paths.has('pubmed-export-9-6-25.csv'));
  assert.ok(paths.has('scopus-export-9-6-25.csv'));
  assert.ok(paths.has('deduped_and_processed_studies.jsonl'));
  assert.ok(paths.has('Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Tiebreaks.csv'));
  assert.ok(paths.has('Batch Responses/GPT-5r-high-screening-output.jsonl'));

  const missing = new Set(map.missingNamedArtifacts.map((item: any) => item.path));
  assert.ok(missing.has('embase_pubmed_scopus_batch-GPT-5r-high.jsonl'));
  assert.ok(missing.has('deduped_and_processed_studies-GPT-5r-high.jsonl'));
});
