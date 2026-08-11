import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createOsfFixtureFetch, type OsfSourceFixture } from '../src/benchmark/osf-source-resolver.js';
import { inventoryOsfSources } from '../src/benchmark/osf-source-inventory.js';

const nodeId = process.env.SRBENCH_OSF_NODE?.trim();
if (!nodeId) throw new Error('Set SRBENCH_OSF_NODE to the OSF project/node ID to inventory.');

const fixturePath = process.env.SRBENCH_OSF_FIXTURE_FILE?.trim();
let fetchImpl: typeof fetch | undefined;
if (fixturePath) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as OsfSourceFixture;
  fetchImpl = createOsfFixtureFetch(fixture);
}
const bearerToken = process.env.OSF_API_TOKEN?.trim();
const inventory = await inventoryOsfSources({
  nodeId,
  ...(fetchImpl ? { fetchImpl } : {}),
  ...(bearerToken ? { bearerToken } : {}),
});

const outputDir = resolve(process.env.SRBENCH_OSF_OUTPUT_DIR ?? 'artifacts/srbench-qualification');
await mkdir(outputDir, { recursive: true });
const outputPath = resolve(outputDir, `${nodeId.toLowerCase()}-osf-inventory.json`);
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  nodeId: inventory.nodeId,
  qualificationReady: inventory.qualificationReady,
  entryCount: inventory.entries.length,
  inventoryHash: inventory.inventoryHash,
  fixtureMode: Boolean(fixturePath),
  outputPath,
}, null, 2));
