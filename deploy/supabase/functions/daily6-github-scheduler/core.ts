export const SLOT_SPECS = {
  '09': { utcHour: '12', localStart: '09:07:00', localDeadline: '13:00:00' },
  '13': { utcHour: '16', localStart: '13:07:00', localDeadline: '15:00:00' },
  '16': { utcHour: '19', localStart: '16:07:00', localDeadline: '20:00:00' },
} as const;

export type Daily6Slot = keyof typeof SLOT_SPECS;

export interface NaturalSlot {
  date: string;
  slot: Daily6Slot;
  scheduledAt: string;
  requestIdentity: string;
}

export type GithubDispatchClassification = {
  status: 'DISPATCH_ACCEPTED' | 'DISPATCH_REJECTED' | 'DISPATCH_AMBIGUOUS';
  errorClass:
    | null
    | 'GITHUB_AUTH_REJECTED'
    | 'GITHUB_REQUEST_REJECTED'
    | 'GITHUB_UNAVAILABLE'
    | 'GITHUB_AMBIGUOUS';
};

export function classifyGithubDispatch(httpStatus: number): GithubDispatchClassification {
  if (httpStatus === 204) return { status: 'DISPATCH_ACCEPTED', errorClass: null };
  if ([401, 403].includes(httpStatus)) {
    return { status: 'DISPATCH_REJECTED', errorClass: 'GITHUB_AUTH_REJECTED' };
  }
  if ([404, 422].includes(httpStatus)) {
    return { status: 'DISPATCH_REJECTED', errorClass: 'GITHUB_REQUEST_REJECTED' };
  }
  return {
    status: 'DISPATCH_AMBIGUOUS',
    errorClass: httpStatus >= 500 ? 'GITHUB_UNAVAILABLE' : 'GITHUB_AMBIGUOUS',
  };
}

const saoPauloFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function localParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    saoPauloFormatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

export function resolveNaturalSlot(now: Date): NaturalSlot | null {
  if (!Number.isFinite(now.getTime())) return null;
  const parts = localParts(now);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  const slot = (Object.entries(SLOT_SPECS) as [Daily6Slot, (typeof SLOT_SPECS)[Daily6Slot]][]).find(
    ([, spec]) => localTime >= spec.localStart && localTime <= spec.localDeadline,
  )?.[0];
  if (!slot) return null;

  const spec = SLOT_SPECS[slot];
  const scheduledAt = `${date}T${spec.utcHour}:07:00Z`;
  const scheduledLocal = localParts(new Date(scheduledAt));
  if (`${scheduledLocal.hour}:${scheduledLocal.minute}` !== `${slot}:07`) return null;

  return {
    date,
    slot,
    scheduledAt,
    requestIdentity: `${date}|${slot}|campinas-sp|daily6-v1`,
  };
}

export function pemToPkcs8Bytes(pem: string): Uint8Array {
  const normalized = pem.replaceAll('\\n', '\n').trim();
  const match = normalized.match(
    /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----$/,
  );
  if (!match?.[1]) throw new Error('GITHUB_APP_PRIVATE_KEY_PKCS8_INVALID');
  const binary = atob(match[1].replace(/\s/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export async function secureSecretEquals(actual: string, expected: string): Promise<boolean> {
  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [actualDigest, expectedDigest] = await Promise.all([digest(actual), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < actualDigest.length; index += 1) {
    difference |= actualDigest[index]! ^ expectedDigest[index]!;
  }
  return difference === 0 && actual.length === expected.length;
}

export async function createGithubAppJwt(
  appId: string,
  privateKeyPem: string,
  now: Date,
): Promise<string> {
  if (!/^[0-9]+$/u.test(appId)) throw new Error('GITHUB_APP_ID_INVALID');
  const issuedAt = Math.floor(now.getTime() / 1000) - 30;
  const expiresAt = issuedAt + 540;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const keyBytes = pemToPkcs8Bytes(privateKeyPem);
  const keyData = Uint8Array.from(keyBytes).buffer;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}
