import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SR_QUALIFICATION_CORPUS_SCHEMA_VERSION,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  createSrQualificationSourceCapture,
  applySrQualificationSourceCapture,
  type SrQualificationSourceCapture,
} from '../src/benchmark/sr-qualification-source-capture.js';

interface CorpusFile {
  schemaVersion: string;
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}

interface CaptureSetFile {
  schemaVersion: 'medantir-sr-qualification-source-capture-set/1';
  captures: Array<Omit<SrQualificationSourceCapture, 'schemaVersion' | 'captureHash'>>;
}

const corpusPath = resolve(process.env.SRBENCH_QUALIFICATION_FILE ?? 'benchmarks/srbench-v1/qualification-candidates.json');
const capturesPath = resolve(process.env.SRBENCH_QUALIFICATION_CAPTURES_FILE ?? 'benchmarks/srbench-v1/qualification-source-captures.json');
const outputDir = resolve(process.env.SRBENCH_QUALIFICATION_OUTPUT_DIR ?? 'artifacts/srbench-qualification');
const corpusRaw = JSON.parse(await readFile(corpusPath, 'utf8')) as CorpusFile;
const captureRaw = JSON.parse(await readFile(capturesPath, 'utf8')) as CaptureSetFile;
if (corpusRaw.schemaVersion !== SR_QUALIFICATION_CORPUS_SCHEMA_VERSION) throw new Error(`Unsupported qualification corpus schema '${corpusRaw.schemaVersion}'.`);
if (captureRaw.schemaVersion !== 'medantir-sr-qualification-source-capture-set/1') throw new Error(`Unsupported qualification capture-set schema '${captureRaw.schemaVersion}'.`);

const candidates = new Map(corpusRaw.candidates.map((candidate) => [candidate.candidateId, structuredClone(candidate)]));
const captures = captureRaw.captures.map(createSrQualificationSourceCapture);
for (const capture of captures) {
  const candidate = candidates.get(capture.candidateId);
  if (!candidate) throw new Error(`Qualification source capture references unknown candidate '${capture.candidateId}'.`);
  candidates.set(capture.candidateId, applySrQualificationSourceCapture({ candidate, capture }));
}
const corpus = createSrQualificationCorpus({
  corpusId: corpusRaw.corpusId,
  corpusVersion: corpusRaw.corpusVersion,
  candidates: [...candidates.values()],
});
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'qualification-source-captures.json'), `${JSON.stringify(captures, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDir, 'qualification-corpus-after-capture.json'), `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  corpusHash: corpus.corpusHash,
  captures: captures.map((capture) => ({ candidateId: capture.candidateId, component: capture.component, captureHash: capture.captureHash })),
  candidates: corpus.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    readiness: candidate.readiness,
    completeComponents: candidate.completeComponents,
    buildableComponents: candidate.buildableComponents,
    promotionEligible: candidate.promotionEligible,
  })),
  outputDir,
}, null, 2));
