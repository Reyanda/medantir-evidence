import test from 'node:test';
import assert from 'node:assert/strict';
import { createSrAnalysisReproductionPreflight } from '../src/benchmark/sr-analysis-reproduction-preflight.js';

const runtime = {
  candidateId: 'SRQ-OSF-RUNTIME',
  sourceRepository: 'osf.io/U3YRP',
  language: 'R' as const,
  runtimeVersion: '4.2.1',
  entrypoints: ['analysis/main.R'],
  dependencies: [
    { name: 'meta', version: '5.5' },
    { name: 'metafor', version: '3.8' },
    { name: 'altmeta', version: '4.1' },
  ],
  findings: [],
};

test('content-addressed deposit remains non-ready until immutable runtime objects are captured', () => {
  const report = createSrAnalysisReproductionPreflight({ ...runtime, sourceCommit: null });
  assert.equal(report.unresolvedSourceIdentity, true);
  assert.equal(report.unresolvedRuntimeIdentity, false);
  assert.equal(report.runnableWithoutSemanticRepair, true);
  assert.equal(report.exactReproductionReady, false);
});

test('valid HOBJ source capture satisfies non-Git source identity without weakening runtime checks', () => {
  const digest = 'a'.repeat(64);
  const report = createSrAnalysisReproductionPreflight({
    ...runtime,
    sourceCommit: null,
    sourceObjects: [{
      objectId: `HOBJ-${digest}`,
      sha256: digest,
      byteLength: 12345,
      path: 'analysis/main.R',
      revision: '3',
    }],
  });
  assert.equal(report.unresolvedSourceIdentity, false);
  assert.equal(report.unresolvedRuntimeIdentity, false);
  assert.equal(report.exactReproductionReady, true);
  assert.equal(report.sourceObjects?.[0]?.objectId, `HOBJ-${digest}`);
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test('mixed Git commit and HOBJ identities fail closed', () => {
  const digest = 'b'.repeat(64);
  assert.throws(() => createSrAnalysisReproductionPreflight({
    ...runtime,
    sourceCommit: 'a'.repeat(40),
    sourceObjects: [{ objectId: `HOBJ-${digest}`, sha256: digest, byteLength: 1 }],
  }), /either a Git commit or content-addressed source objects/i);
});

test('mismatched HOBJ identity cannot satisfy source resolution', () => {
  assert.throws(() => createSrAnalysisReproductionPreflight({
    ...runtime,
    sourceCommit: null,
    sourceObjects: [{ objectId: `HOBJ-${'b'.repeat(64)}`, sha256: 'a'.repeat(64), byteLength: 1 }],
  }), /objectId must equal HOBJ-<sha256>/i);
});
