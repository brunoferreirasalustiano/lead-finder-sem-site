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
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (
    defaultCountry === 'BR' &&
    !digits.startsWith('55') &&
    (digits.length === 10 || digits.length === 11)
  )
    digits = `55${digits}`;
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
