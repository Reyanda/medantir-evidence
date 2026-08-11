import test from 'node:test';
import assert from 'node:assert/strict';
import {
  revMan54AlgorithmContractHash,
  revMan54RandomEffectsMeanDifference,
  revMan54RandomEffectsRiskRatio,
  revMan54RuntimeFingerprint,
} from '../src/historical/revman-5.4-compat.js';

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('RevMan 5.4 MH/DL random-effects RR follows documented MH-Q then DL inverse-variance weighting', () => {
  const result = revMan54RandomEffectsRiskRatio([
    { studyId: 's1', experimentalEvents: 10, experimentalTotal: 100, controlEvents: 20, controlTotal: 100 },
    { studyId: 's2', experimentalEvents: 30, experimentalTotal: 100, controlEvents: 25, controlTotal: 100 },
    { studyId: 's3', experimentalEvents: 5, experimentalTotal: 50, controlEvents: 10, controlTotal: 50 },
  ]);

  close(result.fixedEffect, 0.8181818181818182);
  close(result.q, 5.548766186164733);
  close(result.tauSquared, 0.21852928620067041);
  close(result.iSquared, 63.95595105472653);
  close(result.pooledEffect, 0.7259213075158082);
  close(result.ciLower, 0.3726138873696219);
  close(result.ciUpper, 1.4142300181708745);
  assert.equal(result.method, 'MH-DL-random');
  assert.deepEqual(result.omittedStudyIds, []);
  assert.deepEqual(result.correctedStudyIds, []);
});

test('RevMan relative-effect zero rules correct a single zero and omit double-zero/double-all-event studies', () => {
  const result = revMan54RandomEffectsRiskRatio([
    { studyId: 'single-zero', experimentalEvents: 0, experimentalTotal: 20, controlEvents: 3, controlTotal: 20 },
    { studyId: 'double-zero', experimentalEvents: 0, experimentalTotal: 30, controlEvents: 0, controlTotal: 30 },
    { studyId: 'double-all', experimentalEvents: 25, experimentalTotal: 25, controlEvents: 20, controlTotal: 20 },
    { studyId: 'ordinary', experimentalEvents: 4, experimentalTotal: 20, controlEvents: 5, controlTotal: 20 },
  ]);
  assert.deepEqual(result.correctedStudyIds, ['single-zero']);
  assert.deepEqual(result.omittedStudyIds, ['double-zero', 'double-all']);
  assert.equal(result.studyCount, 2);
  assert.ok(Number.isFinite(result.pooledEffect));
  assert.ok(result.pooledEffect > 0);
});

test('RevMan 5.4 IV/DL random-effects MD reproduces fixed Q, tau-squared, Wald CI and I-squared', () => {
  const result = revMan54RandomEffectsMeanDifference([
    { studyId: 'c1', experimentalMean: 10, experimentalSd: 2, experimentalTotal: 100, controlMean: 12, controlSd: 2.5, controlTotal: 100 },
    { studyId: 'c2', experimentalMean: 8, experimentalSd: 1.5, experimentalTotal: 80, controlMean: 9, controlSd: 1.7, controlTotal: 80 },
    { studyId: 'c3', experimentalMean: 15, experimentalSd: 3, experimentalTotal: 60, controlMean: 12, controlSd: 2.8, controlTotal: 60 },
  ]);
  close(result.fixedEffect, -0.8443497650401979);
  close(result.q, 66.06346919454953);
  close(result.tauSquared, 3.822100670515925);
  close(result.iSquared, 96.9726082744607);
  close(result.pooledEffect, -0.04723546918935856);
  close(result.standardError, 1.1502220725179095);
  close(result.ciLower, -2.3016293055474795);
  close(result.ciUpper, 2.2071583671687622);
  assert.equal(result.method, 'IV-DL-random');
});

test('RevMan 5.4 runtime fingerprint is bound to an immutable algorithm contract', () => {
  const fingerprint = revMan54RuntimeFingerprint();
  assert.equal(fingerprint.engine, 'MEDANTIR RevMan 5.4 compatibility engine');
  assert.equal(fingerprint.algorithmContractHash, revMan54AlgorithmContractHash());
  assert.equal(fingerprint.numericTolerance, 1e-12);
  assert.match(fingerprint.algorithmContractHash, /^[a-f0-9]{64}$/);
});

test('unsupported or invalid historical data fail closed rather than yielding a synthetic pooled result', () => {
  assert.throws(
    () => revMan54RandomEffectsRiskRatio([
      { studyId: 'bad', experimentalEvents: 11, experimentalTotal: 10, controlEvents: 1, controlTotal: 10 },
    ]),
    /events must be an integer between 0 and total/i,
  );
  assert.throws(
    () => revMan54RandomEffectsMeanDifference([
      { studyId: 'bad-md', experimentalMean: 1, experimentalSd: 0, experimentalTotal: 10, controlMean: 1, controlSd: 0, controlTotal: 10 },
    ]),
    /variance must be positive/i,
  );
});
