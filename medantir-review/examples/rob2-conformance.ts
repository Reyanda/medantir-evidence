import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  evaluateRob2Conformance,
  type Rob2ConformanceSuite,
} from '../src/appraisal/rob2-conformance.js';

const suitePath = resolve(process.env.ROB2_CONFORMANCE_SUITE ?? 'benchmarks/rob2-2019/conformance-suite.json');
const outputPath = resolve(process.env.ROB2_CONFORMANCE_REPORT ?? 'artifacts/rob2-conformance/report.json');
const suite = JSON.parse(await readFile(suitePath, 'utf8')) as Rob2ConformanceSuite;
const report = evaluateRob2Conformance(suite);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  suitePath,
  ...report,
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (!report.certificationEligible) {
  throw new Error(`RoB 2 official conformance is not certification-eligible: ${report.blockers.join(', ') || 'unknown blocker'}`);
}
