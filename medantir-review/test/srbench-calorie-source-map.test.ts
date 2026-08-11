import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('calorie-reformulation source map keeps public artifact availability separate from exact runtime qualification', async () => {
  const sourceMap = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/calorie-reformulation-2022/source-discovery.json'), 'utf8')) as {
    status: string;
    registration: { prospero: string; osfId: string };
    publicArtifactClaim: { osfId: string; declaredArtifacts: string[]; access: string };
    publishedAnalysisContract: {
      modelFamily: string;
      withinStudyCorrelation: number;
      correlationSensitivityValues: number[];
      runtimeVersion: string | null;
      runtimeQualificationReady: boolean;
    };
    qualificationPlan: { immutableObjectsResolved: boolean };
  };

  assert.equal(sourceMap.status, 'source-map-frozen-objects-pending');
  assert.equal(sourceMap.registration.prospero, 'CRD42020223973');
  assert.equal(sourceMap.registration.osfId, 'DJ4YF');
  assert.equal(sourceMap.publicArtifactClaim.osfId, 'DJ4YF');
  assert.equal(sourceMap.publicArtifactClaim.access, 'public-without-restriction');
  assert.deepEqual(sourceMap.publicArtifactClaim.declaredArtifacts, ['manuscript data', 'codebook', 'analytic code']);

  assert.equal(sourceMap.publishedAnalysisContract.modelFamily, 'multi-level meta-analysis');
  assert.equal(sourceMap.publishedAnalysisContract.withinStudyCorrelation, 0.8);
  assert.deepEqual(sourceMap.publishedAnalysisContract.correlationSensitivityValues, [0.6, 0.4]);
  assert.equal(sourceMap.publishedAnalysisContract.runtimeVersion, null);
  assert.equal(sourceMap.publishedAnalysisContract.runtimeQualificationReady, false);
  assert.equal(sourceMap.qualificationPlan.immutableObjectsResolved, false);
});
