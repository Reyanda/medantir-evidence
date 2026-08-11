import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  SR_QUALIFICATION_COMPONENTS,
  createSrQualificationCandidate,
  createSrQualificationCandidateVerificationReceipt,
  type SrQualificationCandidateInput,
} from '../src/benchmark/sr-qualification-corpus.js';
import {
  createSrQualificationReceiptSignatureEnvelope,
  createSrQualificationTrustRegistry,
  verifySrQualificationReceiptSignatures,
  type SrQualificationReceiptSignature,
  type SrQualificationVerifierKey,
} from '../src/benchmark/sr-qualification-signatures.js';

function completeCandidate(): SrQualificationCandidateInput {
  const assets = {} as SrQualificationCandidateInput['assets'];
  SR_QUALIFICATION_COMPONENTS.forEach((component, index) => {
    assets[component] = {
      status: 'frozen-verified',
      basis: 'source-reconstructed',
      receiptHash: (index + 1).toString(16).padStart(2, '0').repeat(32),
    };
  });
  return {
    candidateId: 'QUALIFIED',
    title: 'Qualified review',
    domain: 'nutrition',
    methodologicalClass: 'intervention-meta-analysis',
    publication: { doi: '10.1000/qualified', year: 2022 },
    assets,
  };
}

function verificationReceipt() {
  const candidate = createSrQualificationCandidate(completeCandidate());
  return createSrQualificationCandidateVerificationReceipt({
    candidate,
    verificationBasis: 'dual-independent-audit',
    verifierId: 'adjudication-process',
    verifiedAt: '2026-08-10T18:00:00Z',
  });
}

function key(keyId: string, status: SrQualificationVerifierKey['status'] = 'active') {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const descriptor: SrQualificationVerifierKey = {
    keyId,
    algorithm: 'ed25519',
    publicKeyPem,
    status,
    scopes: ['qualification-candidate'],
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
  };
  return { pair, descriptor };
}

function payload(input: { receiptHash: string; candidateId: string; keyId: string; signedAt: string }): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'MEDANTIR-SR-QUALIFICATION-CANDIDATE',
    receiptHash: input.receiptHash,
    candidateId: input.candidateId,
    keyId: input.keyId,
    signedAt: input.signedAt,
  }), 'utf8');
}

function envelope(input: {
  receiptHash: string;
  candidateId: string;
  keyId: string;
  signedAt: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
}): SrQualificationReceiptSignature {
  const signatureBase64 = sign(null, payload(input), input.privateKey).toString('base64');
  return createSrQualificationReceiptSignatureEnvelope({
    receiptHash: input.receiptHash,
    candidateId: input.candidateId,
    keyId: input.keyId,
    algorithm: 'ed25519',
    signedAt: input.signedAt,
    signatureBase64,
  });
}

test('two independent trusted Ed25519 keys satisfy qualification quorum', () => {
  const receipt = verificationReceipt();
  const k1 = key('VERIFIER-A');
  const k2 = key('VERIFIER-B');
  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST',
    registryVersion: '1',
    minimumDistinctSigners: 2,
    keys: [k1.descriptor, k2.descriptor],
  });
  const signatures = [k1, k2].map(({ pair, descriptor }) => envelope({
    receiptHash: receipt.receiptHash,
    candidateId: receipt.candidateId,
    keyId: descriptor.keyId,
    signedAt: '2026-08-10T18:05:00Z',
    privateKey: pair.privateKey,
  }));
  const verification = verifySrQualificationReceiptSignatures({ receipt, signatures, registry });
  assert.equal(verification.valid, true);
  assert.deepEqual(verification.trustedSigners, ['VERIFIER-A', 'VERIFIER-B']);
  assert.deepEqual(verification.invalidSignatures, []);
  assert.match(verification.verificationHash, /^[a-f0-9]{64}$/);
});

test('one signer cannot satisfy a two-key quorum and duplicate signature does not help', () => {
  const receipt = verificationReceipt();
  const k1 = key('VERIFIER-A');
  const k2 = key('VERIFIER-B');
  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST', registryVersion: '1', minimumDistinctSigners: 2, keys: [k1.descriptor, k2.descriptor],
  });
  const signature = envelope({
    receiptHash: receipt.receiptHash,
    candidateId: receipt.candidateId,
    keyId: k1.descriptor.keyId,
    signedAt: '2026-08-10T18:05:00Z',
    privateKey: k1.pair.privateKey,
  });
  const verification = verifySrQualificationReceiptSignatures({ receipt, signatures: [signature, signature], registry });
  assert.equal(verification.valid, false);
  assert.deepEqual(verification.trustedSigners, ['VERIFIER-A']);
  assert.ok(verification.invalidSignatures.some((item) => /duplicate signature/i.test(item.reason)));
});

test('revoked, expired and wrong-scope keys cannot contribute quorum', () => {
  const receipt = verificationReceipt();
  const active = key('ACTIVE');
  const revoked = key('REVOKED', 'revoked');
  const expired = key('EXPIRED');
  expired.descriptor.validUntil = '2026-02-01T00:00:00Z';
  const wrongScope = key('WRONG-SCOPE');
  wrongScope.descriptor.scopes = [] as never;

  assert.throws(() => createSrQualificationTrustRegistry({
    registryId: 'BAD-SCOPE', registryVersion: '1', minimumDistinctSigners: 1, keys: [wrongScope.descriptor],
  }), /at least one scope/i);

  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST', registryVersion: '1', minimumDistinctSigners: 1, keys: [active.descriptor, revoked.descriptor, expired.descriptor],
  });
  const signatures = [revoked, expired].map(({ pair, descriptor }) => envelope({
    receiptHash: receipt.receiptHash,
    candidateId: receipt.candidateId,
    keyId: descriptor.keyId,
    signedAt: '2026-08-10T18:05:00Z',
    privateKey: pair.privateKey,
  }));
  const verification = verifySrQualificationReceiptSignatures({ receipt, signatures, registry });
  assert.equal(verification.valid, false);
  assert.equal(verification.trustedSigners.length, 0);
  assert.ok(verification.invalidSignatures.some((item) => item.keyId === 'REVOKED' && /not active/i.test(item.reason)));
  assert.ok(verification.invalidSignatures.some((item) => item.keyId === 'EXPIRED' && /validity window/i.test(item.reason)));
});

test('signature cannot be replayed onto a changed qualification receipt', () => {
  const receipt = verificationReceipt();
  const signer = key('VERIFIER-A');
  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST', registryVersion: '1', minimumDistinctSigners: 1, keys: [signer.descriptor],
  });
  const signature = envelope({
    receiptHash: receipt.receiptHash,
    candidateId: receipt.candidateId,
    keyId: signer.descriptor.keyId,
    signedAt: '2026-08-10T18:05:00Z',
    privateKey: signer.pair.privateKey,
  });
  const changed = { ...receipt, receiptHash: 'f'.repeat(64) };
  const verification = verifySrQualificationReceiptSignatures({ receipt: changed, signatures: [signature], registry });
  assert.equal(verification.valid, false);
  assert.ok(verification.invalidSignatures.some((item) => /different qualification receipt/i.test(item.reason)));
});

test('cryptographically invalid signature is rejected even when envelope fields look correct', () => {
  const receipt = verificationReceipt();
  const trusted = key('VERIFIER-A');
  const attacker = key('ATTACKER');
  const registry = createSrQualificationTrustRegistry({
    registryId: 'TRUST', registryVersion: '1', minimumDistinctSigners: 1, keys: [trusted.descriptor],
  });
  const forged = envelope({
    receiptHash: receipt.receiptHash,
    candidateId: receipt.candidateId,
    keyId: trusted.descriptor.keyId,
    signedAt: '2026-08-10T18:05:00Z',
    privateKey: attacker.pair.privateKey,
  });
  const verification = verifySrQualificationReceiptSignatures({ receipt, signatures: [forged], registry });
  assert.equal(verification.valid, false);
  assert.ok(verification.invalidSignatures.some((item) => /signature is invalid/i.test(item.reason)));
});
