import { describe, expect, it, vi } from 'vitest';
import {
  createGmailOperatorEmailConsumer,
  OperatorEmailDeliveryError,
  type OperatorEmailTransport,
} from './index.js';

const configuration = {
  sender: 'operator@example.test',
  recipient: 'operator@example.test',
  smtpUser: 'operator@example.test',
  smtpAppPassword: 'abcdefghijklmnop',
};

describe('Gmail operator email consumer', () => {
  it('binds delivery to one internal recipient with network-safe options', async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const sendMail = vi.fn().mockResolvedValue({
      accepted: ['operator@example.test'],
      rejected: [],
      messageId: '<synthetic@example.test>',
      response: '250 accepted',
    });
    const factory = vi.fn((): OperatorEmailTransport => ({ verify, sendMail }));
    const consumer = createGmailOperatorEmailConsumer(configuration, factory);
    const result = await consumer.sendInternalTest({
      subject: 'Internal test',
      body: 'No lead is involved.',
    });

    expect(result).toEqual({
      provider: 'GMAIL_SMTP',
      messageId: '<synthetic@example.test>',
      response: '250 accepted',
    });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'operator@example.test',
      to: 'operator@example.test',
      subject: 'Internal test',
      text: 'No lead is involved.',
      disableFileAccess: true,
      disableUrlAccess: true,
    }));
  });

  it('rejects mismatched sender, recipient, or SMTP user', () => {
    expect(() => createGmailOperatorEmailConsumer({
      ...configuration,
      recipient: 'lead@example.test',
    })).toThrow(OperatorEmailDeliveryError);
  });

  it('fails closed when the provider does not accept exactly one recipient', async () => {
    const consumer = createGmailOperatorEmailConsumer(configuration, () => ({
      verify: vi.fn().mockResolvedValue(true),
      sendMail: vi.fn().mockResolvedValue({
        accepted: [],
        rejected: ['operator@example.test'],
        messageId: '',
        response: '550 rejected',
      }),
    }));
    await expect(consumer.sendInternalTest({
      subject: 'Internal test',
      body: 'No lead is involved.',
    })).rejects.toMatchObject({ code: 'DELIVERY_REJECTED' });
  });
});
