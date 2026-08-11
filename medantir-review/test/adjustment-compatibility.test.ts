import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessAdjustmentCompatibility,
  createAdjustmentIdentity,
  validateAdjustmentIdentity,
  type AdjustmentEquivalenceRule,
} from '../src/synthesis/adjustment-compatibility.js';

const evidence = (id: string) => [`evidence-${id}`];

const crude = createAdjustmentIdentity({
  status: 'unadjusted',
  estimand: 'marginal',
  sourceEvidenceIds: evidence('crude'),
  rationale: 'Trial report presents the unadjusted randomized comparison.',
});
const ageSex = createAdjustmentIdentity({
  status: 'adjusted',
  estimand: 'conditional',
  covariates: ['Age', 'Sex'],
  sourceEvidenceIds: evidence('age-sex'),
  rationale: 'Model adjusted for age and sex.',
});
const ageSexDuplicateCase = createAdjustmentIdentity({
  status: 'adjusted',
  estimand: 'conditional',
  covariates: [' sex ', 'AGE'],
  sourceEvidenceIds: evidence('age-sex'),
  rationale: 'Model adjusted for age and sex.',
});
const ageSexSeverity = createAdjustmentIdentity({
  status: 'adjusted',
  estimand: 'conditional',
  covariates: ['age', 'sex', 'baseline severity'],
  sourceEvidenceIds: evidence('age-sex-severity'),
  rationale: 'Model adjusted for age, sex, and baseline severity.',
});
const unknown = createAdjustmentIdentity({
  status: 'unknown',
  estimand: 'unspecified',
  rationale: 'Report does not state whether the estimate is adjusted.',
});

const descriptor = (studyId: string, adjustment: typeof crude) => ({ studyId, outcome: 'mortality', adjustment });

function rule(hashes: string[]): AdjustmentEquivalenceRule {
  return {
    id: 'protocol-equivalence-1',
    protocolHash: 'protocol-sha-123',
    rationale: 'Protocol prespecifies these estimates as exchangeable for this outcome after methodological review.',
    actorId: 'reviewer:gm',
    createdAt: '2026-08-11T05:00:00.000Z',
    allowedIdentityHashes: hashes,
  };
}

test('normalized identical adjusted covariate sets have identical identity', () => {
  assert.equal(ageSex.identityHash, ageSexDuplicateCase.identityHash);
  assert.deepEqual(ageSex.covariates, ['age', 'sex']);
  validateAdjustmentIdentity(ageSex);
});

test('homogeneous unadjusted marginal estimates are compatible', () => {
  const receipt = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', crude),
  ]);
  assert.equal(receipt.status, 'compatible');
  assert.equal(receipt.conflicts.length, 0);
  assert.equal(receipt.groups.length, 1);
  assert.equal(receipt.receiptHash.length, 64);
});

test('homogeneous adjusted estimates using the exact same covariate set are compatible', () => {
  const receipt = assessAdjustmentCompatibility([
    descriptor('s1', ageSex),
    descriptor('s2', ageSexDuplicateCase),
  ]);
  assert.equal(receipt.status, 'compatible');
  assert.equal(receipt.groups.length, 1);
});

test('crude and adjusted estimates are incompatible without explicit protocol equivalence', () => {
  const receipt = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', ageSex),
  ]);
  assert.equal(receipt.status, 'incompatible');
  assert.ok(receipt.conflicts.some((item) => /Adjusted and unadjusted/i.test(item)));
  assert.ok(receipt.conflicts.some((item) => /different or unspecified marginal\/conditional estimands/i.test(item)));
});

test('materially different adjusted covariate sets are not silently mixed', () => {
  const receipt = assessAdjustmentCompatibility([
    descriptor('s1', ageSex),
    descriptor('s2', ageSexSeverity),
  ]);
  assert.equal(receipt.status, 'incompatible');
  assert.ok(receipt.conflicts.some((item) => /different covariate sets/i.test(item)));
});

test('unknown adjustment status is certification debt rather than assumed unadjusted', () => {
  const receipt = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', unknown),
  ]);
  assert.equal(receipt.status, 'unclassified');
  assert.ok(receipt.conflicts.some((item) => /unknown adjustment status/i.test(item)));
});

test('protocol equivalence can authorize only the exact identity hashes it names', () => {
  const blocked = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', ageSex),
  ]);
  assert.equal(blocked.status, 'incompatible');

  const authorized = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', ageSex),
  ], rule([crude.identityHash, ageSex.identityHash]));
  assert.equal(authorized.status, 'compatible');
  assert.equal(authorized.ruleId, 'protocol-equivalence-1');
  assert.equal(authorized.conflicts.length, 0);

  const notAuthorized = assessAdjustmentCompatibility([
    descriptor('s1', crude),
    descriptor('s2', ageSexSeverity),
  ], rule([crude.identityHash, ageSex.identityHash]));
  assert.notEqual(notAuthorized.status, 'compatible');
});

test('adjusted identity requires covariates and source evidence; unadjusted cannot declare covariates', () => {
  assert.throws(() => createAdjustmentIdentity({
    status: 'adjusted', estimand: 'conditional', covariates: [], sourceEvidenceIds: ['x'], rationale: 'bad',
  }), /requires the reported adjustment covariates/);
  assert.throws(() => createAdjustmentIdentity({
    status: 'adjusted', estimand: 'conditional', covariates: ['age'], sourceEvidenceIds: [], rationale: 'bad',
  }), /requires source evidence/);
  assert.throws(() => createAdjustmentIdentity({
    status: 'unadjusted', estimand: 'marginal', covariates: ['age'], sourceEvidenceIds: ['x'], rationale: 'bad',
  }), /cannot declare adjustment covariates/);
});

test('tampered adjustment identity hash is rejected', () => {
  assert.throws(() => validateAdjustmentIdentity({ ...ageSex, identityHash: '0'.repeat(64) }), /hash mismatch/);
});
