import { describe, expect, it, vi } from 'vitest';
import {
  createOperatorRecipientProof,
  digestOperatorTestMessage,
  verifyOperatorRecipientProof,
  OPERATOR_RECIPIENT_BINDING_VERSION,
} from '@lead-finder/shared';
import { approvedTemplates } from '@lead-finder/messaging';
import {
  EXPECTED_WORKING_DIRECTORY,
  inspectOperatorEnvironment,
  runOperatorTestPreflight,
  sanitizedFingerprint,
  sanitizedFingerprintIfPresent,
  expectedOperatorMessageDigestFingerprint,
  expectedOperatorTemplateFingerprint,
} from './operator-test-whatsapp-preflight.js';

const bindingKey = 'operator-test-recipient-binding-key-0001';
const apiToken = 'operator-test-api-token-000000000001';
const phone = '+5511999994982';
const bindingFingerprint = sanitizedFingerprint('OPERATOR_TEST_RECIPIENT_BINDING_KEY', bindingKey);

const baseEnvironment: NodeJS.ProcessEnv = {
  LEAD_FINDER_API_URL: 'https://api.example.com',
  API_AUTH_TOKEN: apiToken,
  OPERATOR_TEST_AUTHORIZED: 'true',
  OPERATOR_TEST_WHATSAPP_E164: phone,
  OPERATOR_TEST_RECIPIENT_BINDING_KEY: bindingKey,
  OPERATOR_TEST_FINGERPRINT_KEY: 'operator-test-fingerprint-key-0001',
  OPERATOR_TEST_EXPECTED_PHONE_SUFFIX: '4982',
  OPERATOR_TEST_HML_PHONE_SUFFIX: '4982',
  OPERATOR_TEST_HML_BINDING_FINGERPRINT: bindingFingerprint,
  OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT: expectedOperatorMessageDigestFingerprint(),
  OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT: expectedOperatorTemplateFingerprint(),
  OPERATOR_TEST_HML_BINDING_VERSION: 'operator-recipient-binding-v1',
};

const fakeDependencies = {
  cwd: EXPECTED_WORKING_DIRECTORY,
  gitSnapshot: async () => ({
    root: EXPECTED_WORKING_DIRECTORY,
    branch: 'fix/hml-operator-binding-diagnostics',
    commit: '2f7203e4f2b0f73f34bb9730ece69c2d41820953',
    clean: true,
  }),
  artifactExists: () => true,
  checkPort: async () => true,
  fetchImpl: vi.fn(async () => new Response(null, { status: 200 })),
};

describe('operator WhatsApp preflight', () => {
  it('accepts the configured binding key and matching HML fingerprint', () => {
    const result = inspectOperatorEnvironment(baseEnvironment, EXPECTED_WORKING_DIRECTORY);
    expect(result.errors).toEqual([]);
    expect(result.localBindingFormatValid).toBe(true);
    expect(result.fingerprintsMatch).toBe(true);
    expect(result.recipientMatch).toBe(true);
  });

  it('reports unavailable fingerprints without hashing absent or empty values', () => {
    expect(sanitizedFingerprintIfPresent('OPERATOR_TEST_RECIPIENT_BINDING_KEY', undefined)).toBe(
      'UNAVAILABLE',
    );
    expect(sanitizedFingerprintIfPresent('OPERATOR_TEST_RECIPIENT_BINDING_KEY', '')).toBe(
      'UNAVAILABLE',
    );
    expect(sanitizedFingerprintIfPresent('OPERATOR_TEST_RECIPIENT_BINDING_KEY', bindingKey)).toBe(
      bindingFingerprint,
    );

    const result = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: undefined,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(result.localBindingFingerprint).toBe('UNAVAILABLE');
    expect(result.localBindingFingerprint).not.toBe(
      sanitizedFingerprint('OPERATOR_TEST_RECIPIENT_BINDING_KEY', ''),
    );
  });

  it('rejects empty secrets as missing before any health check', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await runOperatorTestPreflight(
      {
        ...baseEnvironment,
        API_AUTH_TOKEN: '',
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: '',
        OPERATOR_TEST_FINGERPRINT_KEY: '',
      },
      { ...fakeDependencies, fetchImpl },
    );
    expect(result.status).toBe('FAIL');
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'API_AUTH_TOKEN_MISSING',
        'OPERATOR_TEST_RECIPIENT_BINDING_KEY_MISSING',
        'OPERATOR_TEST_FINGERPRINT_KEY_MISSING',
      ]),
    );
    expect(result.localBindingFingerprint).toBe('UNAVAILABLE');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a binding key equal to the API token', () => {
    const result = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: apiToken,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(result.errors).toContain('BINDING_KEY_EQUALS_API_TOKEN');
  });

  it('rejects short and long binding keys', () => {
    expect(
      inspectOperatorEnvironment(
        {
          ...baseEnvironment,
          OPERATOR_TEST_RECIPIENT_BINDING_KEY: 'short',
        },
        EXPECTED_WORKING_DIRECTORY,
      ).errors,
    ).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_FORMAT_INVALID');
    expect(
      inspectOperatorEnvironment(
        {
          ...baseEnvironment,
          OPERATOR_TEST_RECIPIENT_BINDING_KEY: 'x'.repeat(513),
        },
        EXPECTED_WORKING_DIRECTORY,
      ).errors,
    ).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_FORMAT_INVALID');
  });

  it('rejects spaces and line breaks in the binding key', () => {
    const spaced = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: `${bindingKey} `,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    const lineBreak = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: `${bindingKey}\n`,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(spaced.errors).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_FORMAT_INVALID');
    expect(lineBreak.errors).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_LINE_BREAK');
  });

  it('rejects Unicode invisible characters and PowerShell command blocks', () => {
    const invisible = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: `${bindingKey}\u200b`,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    const command = '$env:OPERATOR_TEST_RECIPIENT_BINDING_KEY = ' + 'x'.repeat(48);
    const powershell = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: command,
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(invisible.errors).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_INVISIBLE_CHARACTER');
    expect(powershell.errors).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_POWERSHELL_COMMAND');
  });

  it('rejects a recipient that differs from the authorized and HML suffixes', () => {
    const result = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_WHATSAPP_E164: '+5511999999337',
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(result.recipientMatch).toBe(false);
    expect(result.errors).toContain('AUTHORIZED_RECIPIENT_SUFFIX_MISMATCH');
    expect(result.errors).toContain('HML_RECIPIENT_SUFFIX_MISMATCH');
  });

  it('proves that a recipient mismatch invalidates the HMAC proof', () => {
    const bindingNonce = Buffer.alloc(32, 1).toString('base64url');
    const idempotencyKey = 'operator-test-idempotency-0001';
    const messageDigest = digestOperatorTestMessage(approvedTemplates.operatorWhatsappTestV1.body);
    const proof = createOperatorRecipientProof(bindingKey, {
      bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
      bindingNonce,
      idempotencyKey,
      recipientE164: '+5511999994982',
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      messageDigest,
    });
    const common = {
      bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
      bindingNonce,
      idempotencyKey,
      templateId: 'operator-whatsapp-channel-test',
      templateVersion: 'v1',
      messageDigest,
    };
    expect(
      verifyOperatorRecipientProof(
        bindingKey,
        {
          ...common,
          recipientE164: '+5511999994982',
        },
        proof,
      ),
    ).toBe(true);
    expect(
      verifyOperatorRecipientProof(
        bindingKey,
        {
          ...common,
          recipientE164: '+5511999999337',
        },
        proof,
      ),
    ).toBe(false);
  });

  it('detects message digest and template mismatches without exposing values', () => {
    const result = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT: '0'.repeat(12),
        OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT: '1'.repeat(12),
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(result.errors).toContain('MESSAGE_DIGEST_MISMATCH');
    expect(result.errors).toContain('TEMPLATE_MISMATCH');
    expect(JSON.stringify(result)).not.toContain('operator-test-recipient-binding-key-0001');
  });

  it('detects binding version mismatches', () => {
    const result = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_HML_BINDING_VERSION: 'operator-recipient-binding-v0',
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(result.errors).toContain('BINDING_VERSION_MISMATCH');
  });

  it('restarts with the current key while an old config remains immutable', () => {
    const oldConfig = inspectOperatorEnvironment(baseEnvironment, EXPECTED_WORKING_DIRECTORY);
    const newKey = 'operator-test-recipient-binding-key-0002';
    const newConfig = inspectOperatorEnvironment(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: newKey,
        OPERATOR_TEST_HML_BINDING_FINGERPRINT: sanitizedFingerprint(
          'OPERATOR_TEST_RECIPIENT_BINDING_KEY',
          newKey,
        ),
      },
      EXPECTED_WORKING_DIRECTORY,
    );
    expect(oldConfig.localBindingFingerprint).toBe(bindingFingerprint);
    expect(newConfig.localBindingFingerprint).not.toBe(oldConfig.localBindingFingerprint);
  });

  it('fails before any preparation-capable network call when proof inputs are invalid', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await runOperatorTestPreflight(
      {
        ...baseEnvironment,
        OPERATOR_TEST_RECIPIENT_BINDING_KEY: 'short',
      },
      { ...fakeDependencies, fetchImpl },
    );
    expect(result.status).toBe('FAIL');
    expect(result.errors).toContain('OPERATOR_TEST_RECIPIENT_BINDING_KEY_FORMAT_INVALID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('performs only health/readiness checks and never WhatsApp or Meta calls', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).not.toContain('wa.me');
      expect(String(input)).not.toContain('graph.facebook');
      return new Response(null, { status: 200 });
    });
    const result = await runOperatorTestPreflight(baseEnvironment, {
      ...fakeDependencies,
      fetchImpl,
    });
    expect(result.status).toBe('PASS');
    expect(result.workingDirectoryAllowed).toBe(true);
    expect(result.workingDirectory).toBe(EXPECTED_WORKING_DIRECTORY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails closed for the real process cwd outside the authorized directory', async () => {
    const { cwd: _injectedCwd, ...dependenciesWithoutCwd } = fakeDependencies;
    const cwdSpy = vi
      .spyOn(process, 'cwd')
      .mockReturnValue('C:\\Users\\corey\\AppData\\Local\\Temp\\other-worktree');
    try {
      const result = await runOperatorTestPreflight(baseEnvironment, dependenciesWithoutCwd);
      expect(result.status).toBe('FAIL');
      expect(result.errors).toContain('WORKING_DIRECTORY_MISMATCH');
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it('uses injected cwd only from dependencies, never from environment', async () => {
    const result = await runOperatorTestPreflight(
      {
        ...baseEnvironment,
        OPERATOR_TEST_CWD: 'C:\\Users\\corey\\AppData\\Local\\Temp\\other-worktree',
      },
      fakeDependencies,
    );
    expect(result.status).toBe('PASS');
    expect(result.workingDirectory).toBe(EXPECTED_WORKING_DIRECTORY);
    expect(result.workingDirectoryAllowed).toBe(true);
  });

  it('reports unavailable HML proof metadata and occupied console port', async () => {
    const result = await runOperatorTestPreflight(
      {
        ...baseEnvironment,
        OPERATOR_TEST_HML_BINDING_FINGERPRINT: undefined,
        OPERATOR_TEST_HML_PHONE_SUFFIX: undefined,
        OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT: undefined,
        OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT: undefined,
        OPERATOR_TEST_HML_BINDING_VERSION: undefined,
      },
      { ...fakeDependencies, checkPort: async () => false },
    );
    expect(result.status).toBe('FAIL');
    expect(result.errors).toContain('HML_BINDING_FINGERPRINT_REQUIRED');
    expect(result.errors).toContain('HML_PHONE_SUFFIX_REQUIRED');
    expect(result.errors).toContain('HML_MESSAGE_DIGEST_FINGERPRINT_REQUIRED');
    expect(result.errors).toContain('HML_TEMPLATE_FINGERPRINT_REQUIRED');
    expect(result.errors).toContain('HML_BINDING_VERSION_REQUIRED');
    expect(result.errors).toContain('OPERATOR_CONSOLE_PORT_UNAVAILABLE');
  });

  it('keeps drive and secret diagnostics sanitized', async () => {
    const result = await runOperatorTestPreflight(baseEnvironment, fakeDependencies);
    expect(result.dDriveAccessed).toBe(false);
    expect(result.dDriveReferenced).toBe(false);
    expect(JSON.stringify(result)).not.toContain(apiToken);
    expect(JSON.stringify(result)).not.toContain(bindingKey);
    expect(result.localBindingFingerprint).toHaveLength(12);
  });
});
