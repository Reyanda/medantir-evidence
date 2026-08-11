import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Hamilton qualification keeps registration, review project, public result deposit and restricted IPD roles distinct', async () => {
  const sourceMap = JSON.parse(await readFile(resolve('benchmarks/srbench-v1/hamilton-sharing-2023/source-discovery.json'), 'utf8')) as {
    status: string;
    osfRoles: Record<string, { osfId: string; benchmarkGoldEligible?: boolean }>;
    publishedRuntime: {
      r: string;
      packages: Record<string, string | null>;
      python: string;
      pythonPackages: Record<string, string>;
    };
    qualificationPlan: { immutableObjectsResolved: boolean };
  };

  assert.equal(sourceMap.status, 'source-map-frozen-objects-pending');
  const ids = Object.values(sourceMap.osfRoles).map((role) => role.osfId.toUpperCase());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(sourceMap.osfRoles.preregistration?.osfId, '7SX8U');
  assert.equal(sourceMap.osfRoles.reviewProject?.osfId, 'H75V4');
  assert.equal(sourceMap.osfRoles.resultsAndCodeDeposit?.osfId, 'U3YRP');
  assert.equal(sourceMap.osfRoles.publishedTableData?.osfId, 'CA89E');
  assert.equal(sourceMap.osfRoles.restrictedIpdRequestPortal?.osfId, 'STNK3');
  assert.equal(sourceMap.osfRoles.restrictedIpdRequestPortal?.benchmarkGoldEligible, false);

  assert.equal(sourceMap.publishedRuntime.r, '4.2.1');
  assert.equal(sourceMap.publishedRuntime.packages.meta, '5.5');
  assert.equal(sourceMap.publishedRuntime.packages.metafor, '3.8');
  assert.equal(sourceMap.publishedRuntime.packages.altmeta, '4.1');
  assert.equal(sourceMap.publishedRuntime.python, '3.10.7');
  assert.equal(sourceMap.publishedRuntime.pythonPackages.dimcli, '0.9.9.1');
  assert.equal(sourceMap.qualificationPlan.immutableObjectsResolved, false);
});
