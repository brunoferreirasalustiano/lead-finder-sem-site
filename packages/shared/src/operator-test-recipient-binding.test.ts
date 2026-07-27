import { describe, expect, it } from 'vitest';
import {
  createOperatorPrincipalBinding,
  createOperatorRecipientProof,
  createOperatorRecipientReceipt,
  decodeStrictBase64Url,
  digestOperatorTestMessage,
  encodeCanonicalFields,
  OPERATOR_RECIPIENT_BINDING_VERSION,
  verifyOperatorRecipientProof,
  verifyOperatorRecipientReceipt,
} from './operator-test-recipient-binding.js';

const bindingKey = 'recipient-binding-key-for-tests-000000000001';
const otherBindingKey = 'recipient-binding-key-for-tests-000000000002';
const bindingNonce = Buffer.alloc(32, 1).toString('base64url');
const idempotencyKey = '11111111-1111-4111-8111-111111111111';
const recipientE164 = '+12025550100';
const messageDigest = digestOperatorTestMessage('Synthetic operator test message');

const proofInput = {
  bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
  bindingNonce,
  idempotencyKey,
  recipientE164,
  templateId: 'operator-whatsapp-channel-test',
  templateVersion: 'v1',
  messageDigest,
};

const principalBinding = createOperatorPrincipalBinding(bindingKey, {
  bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
  bindingNonce,
  principalId: 'synthetic-operator',
});

const receiptInput = {
  ...proofInput,
  preparationId: '22222222-2222-4222-8222-222222222222',
  principalBinding,
};

describe('operator recipient binding cryptography', () => {
  it('uses unambiguous uint32 length-prefixed UTF-8 canonical encoding', () => {
    expect(encodeCanonicalFields(['ab', 'c'])).not.toEqual(encodeCanonicalFields(['a', 'bc']));
    expect(encodeCanonicalFields(['á']).toString('hex')).toBe('00000002c3a1');
  });

  it('accepts equal recipients and rejects a different server recipient', () => {
    const proof = createOperatorRecipientProof(bindingKey, proofInput);
    expect(verifyOperatorRecipientProof(bindingKey, proofInput, proof)).toBe(true);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      { ...proofInput, recipientE164: '+12025550101' },
      proof,
    )).toBe(false);
  });

  it('rejects proof tampering, a different key, version, nonce, idempotency or message', () => {
    const proof = createOperatorRecipientProof(bindingKey, proofInput);
    const alteredProof = `${proof.slice(0, -1)}${proof.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyOperatorRecipientProof(bindingKey, proofInput, alteredProof)).toBe(false);
    expect(verifyOperatorRecipientProof(otherBindingKey, proofInput, proof)).toBe(false);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      { ...proofInput, bindingVersion: 'operator-recipient-binding-v2' },
      proof,
    )).toBe(false);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      { ...proofInput, bindingNonce: Buffer.alloc(32, 2).toString('base64url') },
      proof,
    )).toBe(false);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      { ...proofInput, idempotencyKey: '33333333-3333-4333-8333-333333333333' },
      proof,
    )).toBe(false);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      { ...proofInput, messageDigest: digestOperatorTestMessage('Altered message') },
      proof,
    )).toBe(false);
  });

  it('authenticates every receipt field and rejects tampering', () => {
    const receipt = createOperatorRecipientReceipt(bindingKey, receiptInput);
    expect(verifyOperatorRecipientReceipt(bindingKey, receiptInput, receipt)).toBe(true);

    const mutations = [
      { bindingNonce: Buffer.alloc(32, 3).toString('base64url') },
      { idempotencyKey: '44444444-4444-4444-8444-444444444444' },
      { preparationId: '55555555-5555-4555-8555-555555555555' },
      { templateId: 'altered-template' },
      { templateVersion: 'v2' },
      { messageDigest: digestOperatorTestMessage('Altered message') },
      { principalBinding: Buffer.alloc(32, 4).toString('base64url') },
      { bindingVersion: 'operator-recipient-binding-v2' },
    ];
    for (const mutation of mutations) {
      expect(verifyOperatorRecipientReceipt(
        bindingKey,
        { ...receiptInput, ...mutation },
        receipt,
      )).toBe(false);
    }
    expect(verifyOperatorRecipientReceipt(otherBindingKey, receiptInput, receipt)).toBe(false);
    const alteredReceipt = `${receipt.slice(0, -1)}${receipt.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyOperatorRecipientReceipt(bindingKey, receiptInput, alteredReceipt)).toBe(false);
  });

  it('decodes base64url strictly and rejects padding, base64, and wrong MAC sizes', () => {
    expect(decodeStrictBase64Url(Buffer.alloc(32).toString('base64url'), 32)).toHaveLength(32);
    for (const invalid of [
      `${Buffer.alloc(32).toString('base64url')}=`,
      '//////////////////////////////////////////8=',
      Buffer.alloc(31).toString('base64url'),
      Buffer.alloc(33).toString('base64url'),
      '',
    ]) {
      expect(decodeStrictBase64Url(invalid, 32)).toBeUndefined();
    }
    expect(verifyOperatorRecipientProof(
      bindingKey,
      proofInput,
      Buffer.alloc(31).toString('base64url'),
    )).toBe(false);
    expect(verifyOperatorRecipientProof(
      bindingKey,
      proofInput,
      Buffer.alloc(33).toString('base64url'),
    )).toBe(false);
  });
});
