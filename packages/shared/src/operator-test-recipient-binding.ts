import {
  createHash,
  createHmac,
  hkdfSync,
  timingSafeEqual,
} from 'node:crypto';

export const OPERATOR_RECIPIENT_BINDING_VERSION = 'operator-recipient-binding-v1';
export const OPERATOR_RECIPIENT_BINDING_MAC_BYTES = 32;
export const OPERATOR_RECIPIENT_BINDING_NONCE_BYTES = 32;

const PROOF_DOMAIN = 'lead-finder/operator-test/recipient-proof/v1';
const RECEIPT_DOMAIN = 'lead-finder/operator-test/recipient-receipt/v1';
const PRINCIPAL_DOMAIN = 'lead-finder/operator-test/principal-binding/v1';
const EMPTY_SALT = Buffer.alloc(0);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type ProofInput = Readonly<{
  bindingVersion: string;
  bindingNonce: string;
  idempotencyKey: string;
  recipientE164: string;
  templateId: string;
  templateVersion: string;
  messageDigest: string;
}>;

type PrincipalBindingInput = Readonly<{
  bindingVersion: string;
  bindingNonce: string;
  principalId: string;
}>;

type ReceiptInput = Readonly<{
  bindingVersion: string;
  bindingNonce: string;
  idempotencyKey: string;
  preparationId: string;
  recipientE164: string;
  templateId: string;
  templateVersion: string;
  messageDigest: string;
  principalBinding: string;
}>;

export function encodeCanonicalFields(fields: readonly string[]): Buffer {
  const encoded = fields.map((field) => Buffer.from(field, 'utf8'));
  const totalLength = encoded.reduce((total, field) => total + 4 + field.length, 0);
  const output = Buffer.allocUnsafe(totalLength);
  let offset = 0;
  for (const field of encoded) {
    output.writeUInt32BE(field.length, offset);
    offset += 4;
    field.copy(output, offset);
    offset += field.length;
  }
  return output;
}

export function decodeStrictBase64Url(value: string, expectedBytes: number): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(value) || value.includes('=') || value.length === 0) return undefined;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== expectedBytes || decoded.toString('base64url') !== value) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

export const digestOperatorTestMessage = (message: string): string =>
  createHash('sha256').update(Buffer.from(message, 'utf8')).digest('base64url');

const deriveKey = (bindingKey: string, domain: string): Buffer =>
  Buffer.from(hkdfSync('sha256', Buffer.from(bindingKey, 'utf8'), EMPTY_SALT, domain, 32));

const mac = (bindingKey: string, domain: string, fields: readonly string[]): Buffer =>
  createHmac('sha256', deriveKey(bindingKey, domain)).update(encodeCanonicalFields(fields)).digest();

const proofFields = (input: ProofInput) => [
  input.bindingVersion,
  input.bindingNonce,
  input.idempotencyKey,
  input.recipientE164,
  input.templateId,
  input.templateVersion,
  input.messageDigest,
] as const;

const principalFields = (input: PrincipalBindingInput) => [
  input.bindingVersion,
  input.bindingNonce,
  input.principalId,
] as const;

const receiptFields = (input: ReceiptInput) => [
  input.bindingVersion,
  input.bindingNonce,
  input.idempotencyKey,
  input.preparationId,
  input.recipientE164,
  input.templateId,
  input.templateVersion,
  input.messageDigest,
  input.principalBinding,
] as const;

export const createOperatorRecipientProof = (bindingKey: string, input: ProofInput): string =>
  mac(bindingKey, PROOF_DOMAIN, proofFields(input)).toString('base64url');

export const createOperatorPrincipalBinding = (
  bindingKey: string,
  input: PrincipalBindingInput,
): string => mac(bindingKey, PRINCIPAL_DOMAIN, principalFields(input)).toString('base64url');

export const createOperatorRecipientReceipt = (bindingKey: string, input: ReceiptInput): string =>
  mac(bindingKey, RECEIPT_DOMAIN, receiptFields(input)).toString('base64url');

const verifyMac = (
  supplied: string,
  bindingKey: string,
  domain: string,
  fields: readonly string[],
): boolean => {
  const decoded = decodeStrictBase64Url(supplied, OPERATOR_RECIPIENT_BINDING_MAC_BYTES);
  if (!decoded) return false;
  try {
    return timingSafeEqual(decoded, mac(bindingKey, domain, fields));
  } catch {
    return false;
  }
};

export const verifyOperatorRecipientProof = (
  bindingKey: string,
  input: ProofInput,
  suppliedProof: string,
): boolean => verifyMac(suppliedProof, bindingKey, PROOF_DOMAIN, proofFields(input));

export const verifyOperatorRecipientReceipt = (
  bindingKey: string,
  input: ReceiptInput,
  suppliedReceipt: string,
): boolean => verifyMac(suppliedReceipt, bindingKey, RECEIPT_DOMAIN, receiptFields(input));
