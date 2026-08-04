import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approvedTemplates } from '@lead-finder/messaging';
import { digestOperatorTestMessage, OPERATOR_RECIPIENT_BINDING_VERSION } from '@lead-finder/shared';

const execFile = promisify(execFileCallback);

export const EXPECTED_WORKING_DIRECTORY =
  'C:\\Users\\corey\\AppData\\Local\\Temp\\lead-finder-whatsapp-final-test';
export const EXPECTED_OPERATOR_PHONE_SUFFIX = '4982';
export const DEFAULT_OPERATOR_CONSOLE_PORT = 4174;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const SECRET_PATTERN = /^[\x21-\x7e]{32,512}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/i;
const SUFFIX_PATTERN = /^\d{4}$/;
const POWERSHELL_COMMAND_PATTERN =
  /(?:\$env:|(?:^|[\s;|&])(?:Set|Get|Invoke|Start|Stop|New|Remove|Write|Read|Test)-[A-Za-z]+|(?:^|[\s;|&])(?:Where-Object|ForEach-Object)\b)/i;
const INVISIBLE_CODE_POINTS = new Set([
  0x00a0, 0x00ad, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c,
  0x202d, 0x202e, 0x2060, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
]);

type PreflightStatus = 'PASS' | 'FAIL';
type MatchStatus = boolean | 'UNKNOWN';

export type GitSnapshot = Readonly<{
  root: string;
  branch: string;
  commit: string;
  clean: boolean;
}>;

export type OperatorPreflightReport = Readonly<{
  status: PreflightStatus;
  workingDirectory: string;
  workingDirectoryAllowed: boolean;
  dDriveAccessed: boolean;
  dDriveReferenced: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  localBindingFormatValid: boolean;
  localBindingFingerprint: string;
  hmlBindingFingerprint: string;
  fingerprintsMatch: MatchStatus;
  recipientSuffix: string;
  hmlRecipientSuffix: string;
  recipientMatch: boolean;
  messageDigestFingerprint: string;
  messageDigestMatch: MatchStatus;
  templateFingerprint: string;
  templateMatch: MatchStatus;
  bindingVersion: string;
  bindingVersionMatch: MatchStatus;
  apiHealth: number | 'NOT_RUN';
  apiReadiness: number | 'NOT_RUN';
  portAvailable: boolean;
  git: GitSnapshot;
  buildArtifactsPresent: boolean;
}>;

type PreflightDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  checkPort?: (port: number) => Promise<boolean>;
  gitSnapshot?: () => Promise<GitSnapshot>;
  artifactExists?: (path: string) => boolean;
}>;

const fingerprint = (context: string, value: string): string => {
  const digest = createHash('sha256').update(`${context}\u0000${value}`, 'utf8').digest('hex');
  return digest.slice(0, 12);
};

export function sanitizedFingerprint(context: string, value: string): string {
  return fingerprint(context, value);
}

const hasInvisibleCodePoint = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && INVISIBLE_CODE_POINTS.has(codePoint)) return true;
  }
  return false;
};

const looksLikePowerShellCommand = (value: string): boolean =>
  POWERSHELL_COMMAND_PATTERN.test(value);

const isDDrivePath = (value: string): boolean => /^D:(?:[\\/]|$)/i.test(value);
const samePath = (left: string, right: string): boolean =>
  resolve(left).toLowerCase() === resolve(right).toLowerCase();

const secretIssues = (name: string, value: string | undefined): string[] => {
  const issues: string[] = [];
  if (!value) return [`${name}_MISSING`];
  if (looksLikePowerShellCommand(value)) issues.push(`${name}_POWERSHELL_COMMAND`);
  if (value.includes('\r') || value.includes('\n')) issues.push(`${name}_LINE_BREAK`);
  if (hasInvisibleCodePoint(value)) issues.push(`${name}_INVISIBLE_CHARACTER`);
  if (!SECRET_PATTERN.test(value)) issues.push(`${name}_FORMAT_INVALID`);
  return issues;
};

const parseApiUrl = (value: string | undefined): URL | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
    const secure = url.protocol === 'https:';
    const localHttp = url.protocol === 'http:' && loopback.has(url.hostname);
    if ((!secure && !localHttp) || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
};

const checkPortAvailability = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });

const readGitSnapshot = async (cwd: string): Promise<GitSnapshot> => {
  const run = async (args: string[]) =>
    (await execFile('git', args, { cwd, encoding: 'utf8' })).stdout.trim();
  const [root, branch, commit, status] = await Promise.all([
    run(['rev-parse', '--show-toplevel']),
    run(['branch', '--show-current']),
    run(['rev-parse', 'HEAD']),
    run(['status', '--short']),
  ]);
  return { root, branch, commit, clean: status.length === 0 };
};

const defaultArtifacts = [
  'node_modules',
  'packages/shared/dist/index.js',
  'packages/messaging/dist/index.js',
  'packages/whatsapp/dist/index.js',
  'packages/database/dist/index.js',
] as const;

const healthCheck = async (
  apiUrl: URL,
  fetchImpl: typeof fetch,
): Promise<{ health: number; readiness: number }> => {
  const request = async (path: string) => {
    const response = await fetchImpl(new URL(path, apiUrl), {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  };
  return {
    health: await request('/health'),
    readiness: await request('/health/ready'),
  };
};

export function expectedOperatorMessageDigestFingerprint(): string {
  return fingerprint(
    'OPERATOR_TEST_MESSAGE_DIGEST',
    digestOperatorTestMessage(approvedTemplates.operatorWhatsappTestV1.body),
  );
}

export function expectedOperatorTemplateFingerprint(): string {
  return fingerprint(
    'OPERATOR_TEST_TEMPLATE',
    `${approvedTemplates.operatorWhatsappTestV1.id}\u0000${approvedTemplates.operatorWhatsappTestV1.version}`,
  );
}

export function inspectOperatorEnvironment(
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Pick<
  OperatorPreflightReport,
  | 'errors'
  | 'warnings'
  | 'localBindingFormatValid'
  | 'localBindingFingerprint'
  | 'hmlBindingFingerprint'
  | 'fingerprintsMatch'
  | 'recipientSuffix'
  | 'hmlRecipientSuffix'
  | 'recipientMatch'
  | 'messageDigestFingerprint'
  | 'messageDigestMatch'
  | 'templateFingerprint'
  | 'templateMatch'
  | 'bindingVersion'
  | 'bindingVersionMatch'
> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const apiToken = environment.API_AUTH_TOKEN;
  const bindingKey = environment.OPERATOR_TEST_RECIPIENT_BINDING_KEY;
  const fingerprintKey = environment.OPERATOR_TEST_FINGERPRINT_KEY;
  const phone = environment.OPERATOR_TEST_WHATSAPP_E164?.trim();
  const expectedSuffix =
    environment.OPERATOR_TEST_EXPECTED_PHONE_SUFFIX || EXPECTED_OPERATOR_PHONE_SUFFIX;
  const hmlSuffix = environment.OPERATOR_TEST_HML_PHONE_SUFFIX || 'UNAVAILABLE';
  const expectedHmlFingerprint = environment.OPERATOR_TEST_HML_BINDING_FINGERPRINT || '';
  const expectedHmlMessageFingerprint =
    environment.OPERATOR_TEST_HML_MESSAGE_DIGEST_FINGERPRINT || '';
  const expectedHmlTemplateFingerprint = environment.OPERATOR_TEST_HML_TEMPLATE_FINGERPRINT || '';
  const expectedHmlBindingVersion = environment.OPERATOR_TEST_HML_BINDING_VERSION || '';

  for (const issue of secretIssues('API_AUTH_TOKEN', apiToken)) errors.push(issue);
  for (const issue of secretIssues('OPERATOR_TEST_RECIPIENT_BINDING_KEY', bindingKey))
    errors.push(issue);
  for (const issue of secretIssues('OPERATOR_TEST_FINGERPRINT_KEY', fingerprintKey))
    errors.push(issue);
  if (bindingKey && apiToken && bindingKey === apiToken)
    errors.push('BINDING_KEY_EQUALS_API_TOKEN');
  if (fingerprintKey && apiToken && fingerprintKey === apiToken)
    errors.push('FINGERPRINT_KEY_EQUALS_API_TOKEN');
  if (bindingKey && fingerprintKey && bindingKey === fingerprintKey)
    errors.push('BINDING_KEY_EQUALS_FINGERPRINT_KEY');

  if (environment.OPERATOR_TEST_AUTHORIZED !== 'true')
    errors.push('OPERATOR_TEST_AUTHORIZED_REQUIRED');
  if (!parseApiUrl(environment.LEAD_FINDER_API_URL)) errors.push('LEAD_FINDER_API_URL_INVALID');

  const phoneValid = Boolean(phone && E164_PATTERN.test(phone));
  if (!phoneValid) errors.push('OPERATOR_TEST_WHATSAPP_E164_INVALID');
  if (!SUFFIX_PATTERN.test(expectedSuffix)) errors.push('EXPECTED_PHONE_SUFFIX_INVALID');
  if (!SUFFIX_PATTERN.test(hmlSuffix) || hmlSuffix === 'UNAVAILABLE') {
    errors.push('HML_PHONE_SUFFIX_REQUIRED');
  }
  if (!FINGERPRINT_PATTERN.test(expectedHmlFingerprint)) {
    errors.push('HML_BINDING_FINGERPRINT_REQUIRED');
  }
  if (!FINGERPRINT_PATTERN.test(expectedHmlMessageFingerprint)) {
    errors.push('HML_MESSAGE_DIGEST_FINGERPRINT_REQUIRED');
  }
  if (!FINGERPRINT_PATTERN.test(expectedHmlTemplateFingerprint)) {
    errors.push('HML_TEMPLATE_FINGERPRINT_REQUIRED');
  }
  if (!expectedHmlBindingVersion) {
    errors.push('HML_BINDING_VERSION_REQUIRED');
  }
  if (expectedHmlBindingVersion !== OPERATOR_RECIPIENT_BINDING_VERSION) {
    errors.push('BINDING_VERSION_MISMATCH');
  }

  const recipientSuffix = phoneValid ? phone!.slice(-4) : 'UNAVAILABLE';
  const recipientMatch =
    phoneValid && recipientSuffix === expectedSuffix && recipientSuffix === hmlSuffix;
  if (phoneValid && recipientSuffix !== expectedSuffix)
    errors.push('AUTHORIZED_RECIPIENT_SUFFIX_MISMATCH');
  if (phoneValid && SUFFIX_PATTERN.test(hmlSuffix) && recipientSuffix !== hmlSuffix) {
    errors.push('HML_RECIPIENT_SUFFIX_MISMATCH');
  }

  const localBindingFormatValid =
    secretIssues('OPERATOR_TEST_RECIPIENT_BINDING_KEY', bindingKey).length === 0;
  const localBindingFingerprint = localBindingFormatValid
    ? fingerprint('OPERATOR_TEST_RECIPIENT_BINDING_KEY', bindingKey!)
    : 'UNAVAILABLE';
  const fingerprintsMatch: MatchStatus =
    localBindingFormatValid && FINGERPRINT_PATTERN.test(expectedHmlFingerprint)
      ? localBindingFingerprint.toLowerCase() === expectedHmlFingerprint.toLowerCase()
      : 'UNKNOWN';
  if (fingerprintsMatch === false) errors.push('BINDING_FINGERPRINT_MISMATCH');

  const messageDigestFingerprint = expectedOperatorMessageDigestFingerprint();
  const messageDigestMatch: MatchStatus = expectedHmlMessageFingerprint
    ? messageDigestFingerprint === expectedHmlMessageFingerprint.toLowerCase()
    : 'UNKNOWN';
  if (messageDigestMatch === false) errors.push('MESSAGE_DIGEST_MISMATCH');
  const templateFingerprint = expectedOperatorTemplateFingerprint();
  const templateMatch: MatchStatus = expectedHmlTemplateFingerprint
    ? templateFingerprint === expectedHmlTemplateFingerprint.toLowerCase()
    : 'UNKNOWN';
  if (templateMatch === false) errors.push('TEMPLATE_MISMATCH');
  const bindingVersionMatch: MatchStatus =
    expectedHmlBindingVersion === OPERATOR_RECIPIENT_BINDING_VERSION;

  if (!FINGERPRINT_PATTERN.test(expectedHmlFingerprint)) {
    warnings.push('HML_BINDING_FINGERPRINT_NOT_AVAILABLE_FROM_PUBLIC_CONSOLE');
  }
  return {
    errors: [...new Set(errors)].sort(),
    warnings: [...new Set(warnings)].sort(),
    localBindingFormatValid,
    localBindingFingerprint,
    hmlBindingFingerprint: FINGERPRINT_PATTERN.test(expectedHmlFingerprint)
      ? expectedHmlFingerprint.toLowerCase()
      : 'UNAVAILABLE',
    fingerprintsMatch,
    recipientSuffix,
    hmlRecipientSuffix: SUFFIX_PATTERN.test(hmlSuffix) ? hmlSuffix : 'UNAVAILABLE',
    recipientMatch,
    messageDigestFingerprint,
    messageDigestMatch,
    templateFingerprint,
    templateMatch,
    bindingVersion: OPERATOR_RECIPIENT_BINDING_VERSION,
    bindingVersionMatch,
  };
}

export async function runOperatorTestPreflight(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: PreflightDependencies = {},
): Promise<OperatorPreflightReport> {
  const cwd = process.cwd();
  const workingDirectoryAllowed = samePath(cwd, EXPECTED_WORKING_DIRECTORY);
  const dDriveAccessed = isDDrivePath(cwd);
  const dDriveReferenced = dDriveAccessed;
  const errors: string[] = [];
  if (!workingDirectoryAllowed) errors.push('WORKING_DIRECTORY_MISMATCH');
  if (dDriveAccessed) errors.push('FORBIDDEN_DRIVE');

  const envDiagnostics = inspectOperatorEnvironment(environment, cwd);
  errors.push(...envDiagnostics.errors);
  const git = dependencies.gitSnapshot
    ? await dependencies.gitSnapshot()
    : await readGitSnapshot(cwd);
  if (!samePath(git.root, EXPECTED_WORKING_DIRECTORY)) errors.push('GIT_ROOT_MISMATCH');
  if (!git.branch) errors.push('DETACHED_HEAD');
  if (!git.clean) errors.push('WORKTREE_NOT_CLEAN');

  const artifactExists =
    dependencies.artifactExists ??
    ((path: string) => {
      return existsSync(path);
    });
  const buildArtifactsPresent = defaultArtifacts.every((relativePath) =>
    artifactExists(`${cwd}/${relativePath}`),
  );
  if (!buildArtifactsPresent) errors.push('BUILD_ARTIFACTS_MISSING');

  const port = Number(environment.OPERATOR_TEST_CONSOLE_PORT || DEFAULT_OPERATOR_CONSOLE_PORT);
  const portAvailable =
    Number.isInteger(port) && port >= 1_024 && port <= 65_535
      ? await (dependencies.checkPort ?? checkPortAvailability)(port)
      : false;
  if (!portAvailable) errors.push('OPERATOR_CONSOLE_PORT_UNAVAILABLE');

  let apiHealth: number | 'NOT_RUN' = 'NOT_RUN';
  let apiReadiness: number | 'NOT_RUN' = 'NOT_RUN';
  const apiUrl = parseApiUrl(environment.LEAD_FINDER_API_URL);
  if (apiUrl && envDiagnostics.errors.length === 0) {
    try {
      const health = await healthCheck(apiUrl, dependencies.fetchImpl ?? fetch);
      apiHealth = health.health;
      apiReadiness = health.readiness;
      if (apiHealth !== 200) errors.push('API_HEALTH_NOT_200');
      if (apiReadiness !== 200) errors.push('API_READINESS_NOT_200');
    } catch {
      errors.push('API_HEALTH_CHECK_FAILED');
    }
  }

  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    workingDirectory: cwd,
    workingDirectoryAllowed,
    dDriveAccessed,
    dDriveReferenced,
    ...envDiagnostics,
    errors: [...new Set(errors)].sort(),
    warnings: envDiagnostics.warnings,
    apiHealth,
    apiReadiness,
    portAvailable,
    git,
    buildArtifactsPresent,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  void (async () => {
    const report = await runOperatorTestPreflight();
    console.log(JSON.stringify(report));
    if (report.status !== 'PASS') process.exitCode = 1;
  })();
}
