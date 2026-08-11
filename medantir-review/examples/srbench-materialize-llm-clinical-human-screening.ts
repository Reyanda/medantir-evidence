import { resolve } from 'node:path';
import { writeGitHubHumanScreeningCase } from '../src/benchmark/github-screening-case-materializer.js';

const outputDir = resolve(process.env.SRBENCH_LLM_CLINICAL_OUTPUT_DIR
  ?? 'artifacts/srbench-cases/llm-clinical-2026-human-screening');

const result = await writeGitHubHumanScreeningCase({
  repository: 'nyuolab/llms-in-clinical-medicine-systematic-review',
  commit: '69597fdd1dd2cd45417446997af5af671853e2ec',
  candidateId: 'SRQ-LLM-CLINICAL-2026',
  caseId: 'SRBENCH-LLM-CLINICAL-2026-HUMAN500',
  title: 'Nature Medicine LLM clinical review: frozen 500-record dual-human screening benchmark',
  domain: 'clinical-ai-meta-research',
  sourceReview: {
    doi: '10.1038/s41591-026-04229-5',
    pmid: '41776077',
    pmcid: 'PMC13004689',
    citation: 'Systematic review of large language models in clinical medicine with LLM-assisted screening',
  },
  screener1: {
    path: 'Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Screener Group 1.csv',
    blobSha: 'daaa8b1d274fd1cd3df9da22a9bec27d318bbf08',
  },
  screener2: {
    path: 'Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Screener Group 2.csv',
    blobSha: '7b07436c32aa96685035e18998570c0ecf315939',
  },
  tiebreaks: {
    path: 'Human Screening and Tiering Data/Nature Medicine LLM Systematic Review - Tiebreaks.csv',
    blobSha: 'd18c9a588ed5df2fec607a663cf09cb8159bb401',
  },
  instructions: {
    path: 'Prompts/screening_instructions.txt',
    blobSha: '0f56006f2b019e6d7531866805d7e6fc5e801c30',
  },
  ...(process.env.GITHUB_TOKEN ? { githubToken: process.env.GITHUB_TOKEN } : {}),
  outputDir,
});

console.log(JSON.stringify({
  outputDir: result.outputDir,
  caseId: result.materialization.caseId,
  repository: result.materialization.repository,
  commit: result.materialization.commit,
  counts: result.materialization.counts,
  sourceManifestHash: result.materialization.sourceManifestHash,
  materializationHash: result.materialization.materializationHash,
  next: `SRBENCH_SUITE='${resolve(outputDir, 'suite.json')}' SRBENCH_MODELS='model-a,model-b' npm run benchmark:sr`,
}, null, 2));
