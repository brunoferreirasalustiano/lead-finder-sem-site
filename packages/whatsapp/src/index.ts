import { z } from 'zod';

export const e164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/);
export type PhoneNormalizationResult =
  | { ok: true; e164: string; digits: string }
  | { ok: false; code: 'MISSING_PHONE' | 'INVALID_PHONE' };
export function normalizePhoneE164(
  value: string | null | undefined,
  defaultCountry: 'BR' | undefined = 'BR',
): PhoneNormalizationResult {
  if (!value?.trim()) return { ok: false, code: 'MISSING_PHONE' };
  if (!/^[\d\s()+.-]+$/.test(value)) return { ok: false, code: 'INVALID_PHONE' };
  const trimmed = value.trim();
  const explicitInternational = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (defaultCountry === 'BR' && !explicitInternational) {
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    else if (!((digits.length === 12 || digits.length === 13) && digits.startsWith('55')))
      return { ok: false, code: 'INVALID_PHONE' };
  }
  const e164 = `+${digits}`;
  return e164Schema.safeParse(e164).success
    ? { ok: true, e164, digits }
    : { ok: false, code: 'INVALID_PHONE' };
}
export function createWhatsAppManualUrl(phone: string, message: string) {
  const normalized = normalizePhoneE164(phone);
  if (!normalized.ok) throw new Error(normalized.code);
  if (message.length < 1 || message.length > 2000) throw new Error('INVALID_MESSAGE');
  return `https://wa.me/${normalized.digits}?text=${encodeURIComponent(message)}`;
}
export class FakeWhatsAppProvider {
  prepare(phone: string, message: string) {
    return {
      kind: 'MANUAL_PREPARATION' as const,
      url: createWhatsAppManualUrl(phone, message),
      networkCalls: 0,
      sent: false,
    };
  }
}

export type WhatsAppCloudDelivery = Readonly<{
  provider: 'WHATSAPP_CLOUD_API';
  messageId: string;
}>;

export class WhatsAppCloudApiError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_CONFIGURATION' | 'NETWORK_ERROR' | 'PROVIDER_REJECTED' | 'INVALID_PROVIDER_RESPONSE',
  ) {
    super(message);
  }
}

type WhatsAppCloudFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const cloudApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const cloudIdSchema = z.string().regex(/^\d{5,30}$/);
const cloudAccessTokenSchema = z.string().min(32).max(4096).regex(/^[\x21-\x7e]+$/);

const responseMessageId = (value: unknown) => {
  if (value === null || typeof value !== 'object') return undefined;
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length !== 1) return undefined;
  const id = (messages[0] as { id?: unknown } | null)?.id;
  return typeof id === 'string' && /^[A-Za-z0-9._=-]{8,256}$/.test(id) ? id : undefined;
};

/**
 * Creates a minimal Cloud API client. The token is captured in a closure and
 * never included in errors, return values, or structured logs.
 */
export function createWhatsAppCloudApiClient(input: {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: WhatsAppCloudFetch;
}) {
  const phoneNumberId = cloudIdSchema.safeParse(input.phoneNumberId);
  const accessToken = cloudAccessTokenSchema.safeParse(input.accessToken);
  const apiVersion = cloudApiVersionSchema.safeParse(input.apiVersion ?? 'v23.0');
  if (!phoneNumberId.success || !accessToken.success || !apiVersion.success) {
    throw new WhatsAppCloudApiError('WhatsApp Cloud configuration is invalid', 'INVALID_CONFIGURATION');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpoint = `https://graph.facebook.com/${apiVersion.data}/${phoneNumberId.data}/messages`;

  return {
    async sendText(message: { recipient: string; body: string }): Promise<WhatsAppCloudDelivery> {
      const normalized = normalizePhoneE164(message.recipient);
      if (!normalized.ok || message.body.length < 1 || message.body.length > 4096) {
        throw new WhatsAppCloudApiError('WhatsApp message is invalid', 'INVALID_CONFIGURATION');
      }
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken.data}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalized.digits,
            type: 'text',
            text: { preview_url: false, body: message.body },
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new WhatsAppCloudApiError('WhatsApp Cloud provider unavailable', 'NETWORK_ERROR');
      }
      if (!response.ok) {
        throw new WhatsAppCloudApiError('WhatsApp Cloud provider rejected the message', 'PROVIDER_REJECTED');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new WhatsAppCloudApiError('WhatsApp Cloud provider response is invalid', 'INVALID_PROVIDER_RESPONSE');
      }
      const messageId = responseMessageId(payload);
      if (!messageId) {
        throw new WhatsAppCloudApiError('WhatsApp Cloud provider response is invalid', 'INVALID_PROVIDER_RESPONSE');
      }
      return { provider: 'WHATSAPP_CLOUD_API', messageId };
    },
  };
}
