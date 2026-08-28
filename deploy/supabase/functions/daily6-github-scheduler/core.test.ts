import { describe, expect, it } from 'vitest';
import {
  base64Url,
  classifyGithubDispatch,
  pemToPkcs8Bytes,
  resolveNaturalSlot,
  secureSecretEquals,
} from './core.js';

describe('Daily-6 Supabase scheduler core', () => {
  it.each([
    ['2026-08-28T12:07:00Z', '09'],
    ['2026-08-28T16:07:00Z', '13'],
    ['2026-08-28T19:07:00Z', '16'],
  ])('derives natural slot %s as %s without accepting caller slot data', (timestamp, slot) => {
    expect(resolveNaturalSlot(new Date(timestamp))).toMatchObject({
      slot,
      date: '2026-08-28',
      requestIdentity: `2026-08-28|${slot}|campinas-sp|daily6-v1`,
    });
  });

  it('accepts bounded delay and rejects outside the slot deadline', () => {
    expect(resolveNaturalSlot(new Date('2026-08-28T15:59:59Z'))?.slot).toBe('09');
    expect(resolveNaturalSlot(new Date('2026-08-28T16:00:01Z'))).toBeNull();
    expect(resolveNaturalSlot(new Date('2026-08-28T23:00:01Z'))).toBeNull();
  });

  it('compares the dedicated secret without exposing it', async () => {
    await expect(secureSecretEquals('a'.repeat(32), 'a'.repeat(32))).resolves.toBe(true);
    await expect(secureSecretEquals('a'.repeat(32), 'b'.repeat(32))).resolves.toBe(false);
  });

  it('only accepts an explicit PKCS8 private key envelope', () => {
    const encoded = btoa('private-key');
    expect(
      pemToPkcs8Bytes(`-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----`),
    ).toEqual(new TextEncoder().encode('private-key'));
    expect(() =>
      pemToPkcs8Bytes('-----BEGIN RSA PRIVATE KEY-----\nAA==\n-----END RSA PRIVATE KEY-----'),
    ).toThrow('GITHUB_APP_PRIVATE_KEY_PKCS8_INVALID');
  });

  it('uses unpadded URL-safe base64', () => {
    expect(base64Url('test?')).not.toMatch(/[+/=]/u);
  });

  it.each([
    [204, 'DISPATCH_ACCEPTED', null],
    [401, 'DISPATCH_REJECTED', 'GITHUB_AUTH_REJECTED'],
    [422, 'DISPATCH_REJECTED', 'GITHUB_REQUEST_REJECTED'],
    [500, 'DISPATCH_AMBIGUOUS', 'GITHUB_UNAVAILABLE'],
    [429, 'DISPATCH_AMBIGUOUS', 'GITHUB_AMBIGUOUS'],
  ])('classifies GitHub status %s without retrying ambiguity', (httpStatus, status, errorClass) => {
    expect(classifyGithubDispatch(httpStatus)).toEqual({ status, errorClass });
  });
});
