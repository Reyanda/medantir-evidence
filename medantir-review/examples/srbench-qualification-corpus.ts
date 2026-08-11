import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SR_QUALIFICATION_CORPUS_SCHEMA_VERSION,
  createSrQualificationCorpus,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';

interface CorpusFile {
  schemaVersion: string;
  corpusId: string;
  corpusVersion: string;
  candidates: SrQualificationCandidateInput[];
}

const sourcePath = resolve(process.env.SRBENCH_QUALIFICATION_FILE ?? 'benchmarks/srbench-v1/qualification-candidates.json');
const outputDir = resolve(process.env.SRBENCH_QUALIFICATION_OUTPUT_DIR ?? 'artifacts/srbench-qualification');
const raw = JSON.parse(await readFile(sourcePath, 'utf8')) as CorpusFile;
if (raw.schemaVersion !== SR_QUALIFICATION_CORPUS_SCHEMA_VERSION) {
  throw new Error(`Unsupported SR qualification corpus schema '${raw.schemaVersion}'.`);
}
const corpus = createSrQualificationCorpus({
  corpusId: raw.corpusId,
  corpusVersion: raw.corpusVersion,
  candidates: raw.candidates,
});
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'qualification-corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');
await writeFile(resolve(outputDir, 'qualification-readiness.json'), `${JSON.stringify(corpus.candidates.map((candidate) => ({
  candidateId: candidate.candidateId,
  domain: candidate.domain,
  methodologicalClass: candidate.methodologicalClass,
  readiness: candidate.readiness,
  completeComponents: candidate.completeComponents,
  buildableComponents: candidate.buildableComponents,
  missingOrWeakComponents: candidate.missingOrWeakComponents,
  promotionEligible: candidate.promotionEligible,
  candidateHash: candidate.candidateHash,
})), null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  corpusId: corpus.corpusId,
  corpusVersion: corpus.corpusVersion,
  corpusHash: corpus.corpusHash,
  validationReadyCandidates: corpus.validationReadyCandidates,
  validationReadyDomains: corpus.validationReadyDomains,
  candidates: corpus.candidates.map((candidate) => ({
    id: candidate.candidateId,
    readiness: candidate.readiness,
    complete: candidate.completeComponents,
    buildable: candidate.buildableComponents,
    missingOrWeak: candidate.missingOrWeakComponents,
  })),
  outputDir,
}, null, 2));
