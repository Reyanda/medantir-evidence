import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { FilesystemHistoricalObjectStore } from '../src/historical/filesystem-object-store.js';
import {
  createOsfFixtureFetch,
  resolveOsfSources,
  type OsfSourceFixture,
  type OsfSourceResolutionInput,
} from '../src/benchmark/osf-source-resolver.js';

type ResolutionFile = Omit<OsfSourceResolutionInput, 'fetchImpl' | 'bearerToken' | 'archiveStore'>;

const inputFile = process.env.SRBENCH_OSF_RESOLVE_FILE?.trim();
if (!inputFile) throw new Error('Set SRBENCH_OSF_RESOLVE_FILE to a JSON resolution request with explicit target revisions.');

const inputPath = resolve(inputFile);
const request = JSON.parse(await readFile(inputPath, 'utf8')) as ResolutionFile;
const fixturePath = process.env.SRBENCH_OSF_FIXTURE_FILE?.trim();
let fetchImpl: typeof fetch | undefined;
if (fixturePath) {
  const fixture = JSON.parse(await readFile(resolve(fixturePath), 'utf8')) as OsfSourceFixture;
  fetchImpl = createOsfFixtureFetch(fixture);
}
const bearerToken = process.env.OSF_API_TOKEN?.trim();
const outputDir = resolve(process.env.SRBENCH_OSF_OUTPUT_DIR ?? 'artifacts/srbench-qualification');
const objectStoreRoot = resolve(process.env.SRBENCH_OBJECT_STORE_DIR ?? resolve(outputDir, 'object-store'));
const archiveStore = request.archiveMetadata ? new FilesystemHistoricalObjectStore(objectStoreRoot) : undefined;
const resolution = await resolveOsfSources({
  ...request,
  ...(fetchImpl ? { fetchImpl } : {}),
  ...(bearerToken ? { bearerToken } : {}),
  ...(archiveStore ? { archiveStore } : {}),
});

await mkdir(outputDir, { recursive: true });
const safeInput = basename(inputPath).replace(/\.json$/i, '').replace(/[^a-z0-9._-]+/gi, '-');
const outputPath = resolve(outputDir, `${safeInput}-resolved.json`);
await writeFile(outputPath, `${JSON.stringify(resolution, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  nodeId: resolution.nodeId,
  candidateId: resolution.sourceCapture.candidateId,
  component: resolution.sourceCapture.component,
  sourceRole: resolution.sourceCapture.sourceRole,
  qualificationUse: resolution.sourceCapture.qualificationUse,
  resolvedObjectCount: resolution.resolvedObjects.length,
  objectIds: resolution.resolvedObjects.map((item) => item.objectId),
  archivePersistence: resolution.archivePersistence,
  archiveObjectIds: resolution.archiveReceipts.map((item) => item.objectId),
  captureMethod: resolution.sourceCapture.captureMethod,
  captureHash: resolution.sourceCapture.captureHash,
  resolutionHash: resolution.resolutionHash,
  fixtureMode: Boolean(fixturePath),
  objectStoreRoot: archiveStore ? objectStoreRoot : null,
  outputPath,
}, null, 2));
