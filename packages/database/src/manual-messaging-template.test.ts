import { describe, expect, it } from 'vitest';
import { approvedTemplates } from '@lead-finder/messaging';
import { isOperatorWhatsAppTestTemplate } from './manual-messaging.js';

describe('HML WhatsApp Cloud template guard', () => {
  it('recognises only the approved internal operator template', () => {
    expect(
      isOperatorWhatsAppTestTemplate(
        'WHATSAPP',
        approvedTemplates.operatorWhatsappTestV1.id,
        approvedTemplates.operatorWhatsappTestV1.version,
      ),
    ).toBe(true);
    expect(
      isOperatorWhatsAppTestTemplate(
        'WHATSAPP',
        approvedTemplates.whatsappV1.id,
        approvedTemplates.whatsappV1.version,
      ),
    ).toBe(false);
    expect(
      isOperatorWhatsAppTestTemplate(
        'EMAIL',
        approvedTemplates.operatorWhatsappTestV1.id,
        approvedTemplates.operatorWhatsappTestV1.version,
      ),
    ).toBe(false);
  });

  it('keeps the internal test text separate from the commercial template', () => {
    expect(approvedTemplates.operatorWhatsappTestV1.body).toContain('teste interno autorizado');
    expect(approvedTemplates.operatorWhatsappTestV1.body).not.toContain(
      'Você autorizou nosso contato',
    );
  });
});
