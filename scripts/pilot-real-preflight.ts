import { access, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  initialPilotGateResults,
  pilotReadinessDecision,
  type PilotGateName,
  type PilotGateResults,
  type PilotGateStatus,
  validateExternalSurface,
  validatePilotHomologationEnvironment,
  validatePilotPermissions,
  validateShadowModeIsolation,
} from '@lead-finder/shared';
import { evaluateSyntheticBatch, loadSyntheticBatch } from './pilot-real-synthetic-batch.js';
import postgres from 'postgres';

type Evidence = Readonly<{ gate: PilotGateName; status: PilotGateStatus }>;
type ManualApproval = Readonly<{
  segment?: string;
  region?: string;
  channel?: string;
  responsible?: string;
  version?: string;
  approvedAt?: string;
  approvedText?: string;
  suspensionCriteria?: string;
  status?: string;
}>;

export function parseEnvironmentFile(content: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = separator < 0 ? '' : line.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || Object.hasOwn(environment, key)) throw new Error('INVALID_HOMOLOGATION_ENV_FILE');
    let value = line.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    environment[key] = value;
  }
  return environment;
}

const exists = async (path: string) => access(path).then(() => true).catch(() => false);

async function readEnvironment(path: string | undefined) {
  return path && await exists(path) ? parseEnvironmentFile(await readFile(path, 'utf8')) : undefined;
}

async function readJson<T>(path: string | undefined): Promise<T | undefined> {
  if (!path || !await exists(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function evidenceStatus(evidence: Evidence | undefined, gate: PilotGateName): PilotGateStatus {
  if (!evidence) return 'NOT RUN';
  if (evidence.gate !== gate) return 'FAIL';
  return evidence.status;
}

function manualApprovalStatus(approval: ManualApproval | undefined): PilotGateStatus {
  if (!approval) return 'NOT RUN';
  const required = [
    approval.segment, approval.region, approval.channel, approval.responsible, approval.version,
    approval.approvedAt, approval.approvedText, approval.suspensionCriteria,
  ];
  return approval.status === 'APPROVED' && required.every((value) => typeof value === 'string' && value.trim().length > 0)
    ? 'PASS'
    : 'FAIL';
}

const statusFromChecks = (...checks: readonly { status: PilotGateStatus }[]): PilotGateStatus => {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAIL';
  if (checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.some((check) => check.status === 'NOT RUN')) return 'NOT RUN';
  return 'PASS';
};

export type PilotRealPreflightReport = Readonly<{
  schemaVersion: '1.0';
  gates: PilotGateResults;
  decision: 'PILOT_REAL_READY' | 'PILOT_REAL_NOT_READY';
  blockingGates: readonly Readonly<{ gate: PilotGateName; status: Exclude<PilotGateStatus, 'PASS'> }>[],
  nextActions: readonly string[];
  effectivePermissions?: readonly string[];
}>;

export function buildPilotRealPreflightReport(input: {
  environment?: Record<string, string | undefined>;
  shadowIsolation: { status: PilotGateStatus };
  backupRestore?: Evidence;
  restoreSuppressionStatus?: PilotGateStatus;
  rollback?: Evidence;
  killSwitch?: Evidence;
  logPrivacy?: { status: 'PASS' | 'FAIL' };
  manualApproval?: ManualApproval;
  syntheticBatchStatus: PilotGateStatus;
}): PilotRealPreflightReport {
  const gates = initialPilotGateResults();
  const environment = input.environment;
  const homologation = environment ? validatePilotHomologationEnvironment(environment) : { status: 'NOT RUN' as const };
  const permissions = environment ? validatePilotPermissions(environment.API_AUTH_PERMISSIONS) : { status: 'NOT RUN' as const };
  const external = environment ? validateExternalSurface(environment) : { status: 'NOT RUN' as const };
  gates.GATE_HOMOLOGATION_ENV = homologation.status;
  gates.GATE_SHADOW_MODE = statusFromChecks(homologation, input.shadowIsolation);
  gates.GATE_EXTERNAL_SURFACE_DISABLED = statusFromChecks(homologation, external);
  gates.GATE_MINIMUM_PERMISSIONS = statusFromChecks(homologation, permissions);
  const operationsReady = homologation.status === 'PASS';
  gates.GATE_BACKUP_RESTORE = operationsReady ? evidenceStatus(input.backupRestore, 'GATE_BACKUP_RESTORE') : 'NOT RUN';
  gates.GATE_RESTORE_SUPPRESSION = operationsReady ? input.restoreSuppressionStatus ?? 'NOT RUN' : 'NOT RUN';
  gates.GATE_ROLLBACK = operationsReady ? evidenceStatus(input.rollback, 'GATE_ROLLBACK') : 'NOT RUN';
  gates.GATE_KILL_SWITCH = operationsReady ? evidenceStatus(input.killSwitch, 'GATE_KILL_SWITCH') : 'NOT RUN';
  gates.GATE_LOG_PRIVACY = operationsReady ? input.logPrivacy?.status ?? 'NOT RUN' : 'NOT RUN';
  gates.GATE_SYNTHETIC_BATCH_20 = input.syntheticBatchStatus;
  gates.GATE_MANUAL_MESSAGE_APPROVED = operationsReady ? manualApprovalStatus(input.manualApproval) : 'NOT RUN';
  const decision = pilotReadinessDecision(gates);
  const blockingGates = (Object.entries(gates) as [PilotGateName, PilotGateStatus][])
    .filter(([, status]) => status !== 'PASS')
    .map(([gate, status]) => ({ gate, status: status as Exclude<PilotGateStatus, 'PASS'> }));
  const nextActions = blockingGates.map(({ gate, status }) => `${gate}:${status}`);
  return {
    schemaVersion: '1.0', gates, decision, blockingGates, nextActions,
    ...(permissions.effectivePermissions ? { effectivePermissions: permissions.effectivePermissions } : {}),
  };
}

async function databaseRestoreSuppressionStatus(databaseUrl: string | undefined): Promise<PilotGateStatus> {
  if (!databaseUrl) return 'NOT RUN';
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    const rows = await sql<{ safe: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM restore_suppression_runs r
        WHERE r.state='RESTORE_SUPPRESSION_SAFE' AND r.verified_at IS NOT NULL
          AND r.applied_at >= COALESCE((SELECT max(updated_at) FROM leads WHERE is_blocked OR do_not_contact OR crm_stage='NAO_CONTATAR'), '-infinity'::timestamptz)
          AND r.applied_at >= COALESCE((SELECT max(created_at) FROM campaign_opt_outs), '-infinity'::timestamptz)) safe`;
    return rows[0]?.safe ? 'PASS' : 'BLOCKED';
  } catch { return 'BLOCKED'; } finally { await sql.end(); }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function run() {
  const envFile = option('--env-file') ?? (await exists('.env.homologation') ? '.env.homologation' : undefined);
  const environment = await readEnvironment(envFile);
  if (process.argv.includes('--restore-suppression-only')) {
    const status = await databaseRestoreSuppressionStatus(environment?.DATABASE_URL ?? process.env['DATABASE_URL']);
    process.stdout.write(`${JSON.stringify({ gate: 'GATE_RESTORE_SUPPRESSION', status })}\n`);
    if (status !== 'PASS') process.exitCode = 2;
    return;
  }
  const evidenceDirectory = option('--evidence-dir') ?? environment?.PILOT_EVIDENCE_DIR ?? '.pilot-evidence';
  const [development, production, homologation, backupRestore, rollback, killSwitch, logPrivacy, manualApproval] = await Promise.all([
    readEnvironment('.env.example'),
    readEnvironment('.env.production.example'),
    readEnvironment('.env.homologation.example'),
    readJson<Evidence>(resolve(evidenceDirectory, 'backup-restore.json')),
    readJson<Evidence>(resolve(evidenceDirectory, 'rollback.json')),
    readJson<Evidence>(resolve(evidenceDirectory, 'kill-switch.json')),
    readJson<{ status: 'PASS' | 'FAIL' }>(option('--log-report') ?? resolve(evidenceDirectory, 'log-privacy.json')),
    readJson<ManualApproval>(option('--manual-approval') ?? resolve(evidenceDirectory, 'manual-message-approval.json')),
  ]);
  if (!development || !production || !homologation) throw new Error('PILOT_PREFLIGHT_CONFIGURATION_TEMPLATES_MISSING');
  let syntheticBatchStatus: PilotGateStatus = 'PASS';
  try { evaluateSyntheticBatch(await loadSyntheticBatch()); } catch { syntheticBatchStatus = 'FAIL'; }
  const report = buildPilotRealPreflightReport({
    environment,
    shadowIsolation: validateShadowModeIsolation({ development, production, homologation }),
    backupRestore, restoreSuppressionStatus: await databaseRestoreSuppressionStatus(environment?.DATABASE_URL), rollback, killSwitch, logPrivacy, manualApproval, syntheticBatchStatus,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = option('--output');
  if (output) {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(dirname(output), { recursive: true }));
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (report.decision !== 'PILOT_REAL_READY') process.exitCode = 2;
}

if (process.argv[1]?.endsWith('pilot-real-preflight.ts')) await run();
