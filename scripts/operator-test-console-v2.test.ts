import { describe, expect, it } from 'vitest';
import { approvedTemplates } from '@lead-finder/messaging';
import {
  createOperatorPrincipalBinding,
  createOperatorRecipientReceipt,
  digestOperatorTestMessage,
  OPERATOR_RECIPIENT_BINDING_VERSION,
} from '@lead-finder/shared';
import { resolveOperatorConsoleConfig } from './operator-test-console.js';
import {
  normalizeAndValidateOperatorPreparation,
  OperatorPreparationContractError,
  validateOperatorPreparationReceiptOrThrow,
} from './operator-test-console-v2.js';

const PHONE = '+12025550100';
const BINDING_KEY = 'operator-test-recipient-binding-key-0001';
const IDEMPOTENCY_KEY = 'operator-test-idempotency-0001';
const PREPARATION_ID = 'fbd6c2ce-7922-4f86-8a25-ffb715cad85b';
const NONCE = Buffer.alloc(32, 1).toString('base64url');

const config = resolveOperatorConsoleConfig({
  LEAD_FINDER_API_URL: 'https://api.example.com',
  API_AUTH_TOKEN: 'x'.repeat(32),
  OPERATOR_TEST_AUTHORIZED: 'true',
  OPERATOR_TEST_WHATSAPP_E164: PHONE,
  OPERATOR_TEST_RECIPIENT_BINDING_KEY: BINDING_KEY,
});

const responsePayload = (preparedAt: string, receiptKey = BINDING_KEY) => {
  const principalBinding = createOperatorPrincipalBinding(receiptKey, {
    bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
    bindingNonce: NONCE,
    principalId: 'operator-bruno',
  });
  const recipientBindingReceipt = createOperatorRecipientReceipt(receiptKey, {
    bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
    bindingNonce: NONCE,
    idempotencyKey: IDEMPOTENCY_KEY,
    preparationId: PREPARATION_ID,
    recipientE164: PHONE,
    templateId: 'operator-whatsapp-channel-test',
    templateVersion: 'v1',
    messageDigest: digestOperatorTestMessage(approvedTemplates.operatorWhatsappTestV1.body),
    principalBinding,
  });
  return {
    preparationId: PREPARATION_ID,
    state: 'PREPARED',
    purpose: 'OPERATOR_TEST',
    channel: 'WHATSAPP',
    templateId: 'operator-whatsapp-channel-test',
    templateVersion: 'v1',
    preparedAt,
    replayed: false,
    bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
    bindingNonce: NONCE,
    principalBinding,
    recipientBindingReceipt,
  };
};

const activePreparation = (preparedAt: string, receiptKey = BINDING_KEY) => ({
  ...normalizeAndValidateOperatorPreparation(responsePayload(preparedAt, receiptKey)),
  preparationIdempotencyKey: IDEMPOTENCY_KEY,
  maskedPhone: '••••0100',
  message: approvedTemplates.operatorWhatsappTestV1.body,
  link: config.link,
});

describe('operator test console v2 contract diagnostics', () => {
  it('accepts and canonicalizes ISO and PostgreSQL timestamp representations', () => {
    expect(normalizeAndValidateOperatorPreparation(
      responsePayload('2026-08-04T18:12:34.123Z'),
    ).preparedAt).toBe('2026-08-04T18:12:34.123Z');

    expect(normalizeAndValidateOperatorPreparation(
      responsePayload('2026-08-04 18:12:34.123456+00'),
    ).preparedAt).toBe('2026-08-04T18:12:34.123Z');
  });

  it('reports only missing or extra field names, never field values', () => {
    const missing = responsePayload('2026-08-04T18:12:34.123Z') as Record<string, unknown>;
    delete missing.preparedAt;
    expect(() => normalizeAndValidateOperatorPreparation(missing)).toThrow(
      'PREPARATION_RESPONSE_MISSING_FIELDS:preparedAt',
    );

    const extra = {
      ...responsePayload('2026-08-04T18:12:34.123Z'),
      phone: PHONE,
      link: config.link,
    };
    expect(() => normalizeAndValidateOperatorPreparation(extra)).toThrow(
      'PREPARATION_RESPONSE_EXTRA_FIELDS:link,phone',
    );
    try {
      normalizeAndValidateOperatorPreparation(extra);
    } catch (error) {
      expect(error).toBeInstanceOf(OperatorPreparationContractError);
      expect(String(error)).not.toContain(PHONE);
      expect(String(error)).not.toContain('wa.me');
    }
  });

  it('separates schema errors from receipt verification failures', () => {
    expect(() => normalizeAndValidateOperatorPreparation({
      ...responsePayload('2026-08-04T18:12:34.123Z'),
      replayed: 'false',
    })).toThrow('PREPARATION_RESPONSE_SCHEMA_INVALID');

    expect(() => validateOperatorPreparationReceiptOrThrow(
      activePreparation('2026-08-04T18:12:34.123Z'),
      config,
    )).not.toThrow();

    expect(() => validateOperatorPreparationReceiptOrThrow(
      activePreparation('2026-08-04T18:12:34.123Z', 'different-binding-key-for-receipt-0001'),
      config,
    )).toThrow('PREPARATION_RECEIPT_INVALID');
  });
});
