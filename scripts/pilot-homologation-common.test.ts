import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const commonHelper = join(repositoryRoot, 'scripts', 'lib', 'pilot-homologation-common.sh');
const backupRestoreScript = join(repositoryRoot, 'scripts', 'pilot-homologation-backup-restore.sh');
const killSwitchScript = join(repositoryRoot, 'scripts', 'pilot-homologation-kill-switch.sh');
const rollbackScript = join(repositoryRoot, 'scripts', 'pilot-homologation-rollback.sh');
const bashAvailable = process.platform !== 'win32' && spawnSync('bash', ['-c', 'exit 0']).status === 0;
const temporaryDirectories: string[] = [];

type ProcessResult = Readonly<{ code: number; stdout: string; stderr: string }>;

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pilot-compose-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function runBash(
  command: string,
  arguments_: readonly string[],
  environment: Record<string, string>,
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command, '--', ...arguments_], {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readCalls(path: string): Promise<string[][]> {
  const values = (await readFile(path)).toString('utf8').split('\0').filter(Boolean);
  const calls: string[][] = [];
  let current: string[] = [];
  for (const value of values) {
    if (value === '__CALL__') {
      if (current.length > 0) calls.push(current);
      current = [];
    } else current.push(value);
  }
  if (current.length > 0) calls.push(current);
  return calls;
}

async function writeFakeDocker(directory: string): Promise<{ capture: string; path: string }> {
  const path = join(directory, 'docker');
  const capture = join(directory, 'docker-arguments.bin');
  await writeFile(path, `#!/usr/bin/env bash
set -eu
printf '__CALL__\\0' >> "$ARG_CAPTURE"
printf '%s\\0' "$@" >> "$ARG_CAPTURE"
printf '1\\n'
`, 'utf8');
  await chmod(path, 0o700);
  return { capture, path };
}

async function writeHomologationEnvironment(directory: string): Promise<string> {
  const path = join(directory, 'pilot configuration.env');
  const backup = join(directory, 'backups').replaceAll('\\', '/');
  const evidence = join(directory, 'evidence').replaceAll('\\', '/');
  await writeFile(path, [
    'PILOT_HOMOLOGATION=true',
    'POSTGRES_DB=leadfinder_homologation',
    'PILOT_RESTORE_DB=leadfinder_homologation_restore',
    'PILOT_DATABASE_GUARD=leadfinder_homologation',
    'SHADOW_MODE_ENABLED=true',
    'COLLECTION_EGRESS_ENABLED=false',
    'REAL_PROVIDER_CONFIGURED=false',
    'PILOT_KILL_SWITCH_ENABLED=false',
    'POSTGRES_USER=pilot',
    'POSTGRES_PASSWORD=synthetic-password-not-printed',
    `PILOT_BACKUP_DIR=${backup}`,
    `PILOT_EVIDENCE_DIR=${evidence}`,
  ].join('\n').concat('\n'), 'utf8');
  return path;
}

function composePrefix(environmentFile: string): string[] {
  return ['compose', '--env-file', environmentFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.homologation.yml'];
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(!bashAvailable)('pilot homologation Compose helper', () => {
  it('removes the env file from Compose arguments while preserving stop order and paths with spaces', async () => {
    const directory = await makeTemporaryDirectory();
    const environmentFile = await writeHomologationEnvironment(directory);
    const { capture } = await writeFakeDocker(directory);
    const result = await runBash('source "$1"; pilot_compose "$2" stop api worker', [commonHelper, environmentFile], {
      ARG_CAPTURE: capture,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
    });

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('synthetic-password-not-printed');
    expect(await readCalls(capture)).toEqual([[...composePrefix(environmentFile), 'stop', 'api', 'worker']]);
  });

  it('passes exec postgres commands without treating the env file as a Compose subcommand', async () => {
    const directory = await makeTemporaryDirectory();
    const environmentFile = await writeHomologationEnvironment(directory);
    const { capture } = await writeFakeDocker(directory);
    const result = await runBash('source "$1"; pilot_compose "$2" exec -T postgres psql -U pilot -d leadfinder_homologation -Atc "select 1"', [commonHelper, environmentFile], {
      ARG_CAPTURE: capture,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
    });

    expect(result.code).toBe(0);
    expect(await readCalls(capture)).toEqual([[...composePrefix(environmentFile), 'exec', '-T', 'postgres', 'psql', '-U', 'pilot', '-d', 'leadfinder_homologation', '-Atc', 'select 1']]);
  });

  it('fails closed for missing or invalid env files without exposing their paths or contents', async () => {
    const directory = await makeTemporaryDirectory();
    const missing = join(directory, 'unpublished-secret.env');
    const environment = {
      PATH: `${directory}:${process.env.PATH ?? ''}`,
    };
    const missingResult = await runBash('source "$1"; pilot_compose "$2" stop api worker', [commonHelper, missing], environment);
    const invalidResult = await runBash('source "$1"; pilot_compose "$2" stop api worker', [commonHelper, directory], environment);

    for (const result of [missingResult, invalidResult]) {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('Arquivo de homologacao inexistente ou ilegivel.');
      expect(result.stderr).not.toContain('unpublished-secret');
    }
  });

  it('uses the corrected helper from the kill switch before recording success', async () => {
    const directory = await makeTemporaryDirectory();
    const environmentFile = await writeHomologationEnvironment(directory);
    const { capture } = await writeFakeDocker(directory);
    const result = await runBash('"$1" engage', [killSwitchScript], {
      ARG_CAPTURE: capture,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      PILOT_HOMOLOGATION_ENV_FILE: environmentFile,
      PILOT_KILL_SWITCH_CONFIRMATION: 'ENGAGE_HOMOLOGATION_PILOT',
    });

    expect(result.code).toBe(0);
    expect(await readCalls(capture)).toEqual([[...composePrefix(environmentFile), 'stop', 'api', 'worker']]);
    expect(await readFile(join(directory, 'evidence', 'kill-switch.json'), 'utf8')).toContain('"status": "PASS"');
  });

  it('uses the corrected helper for backup/restore and rollback stop commands', async () => {
    const directory = await makeTemporaryDirectory();
    const environmentFile = await writeHomologationEnvironment(directory);
    const { capture } = await writeFakeDocker(directory);
    const environment = {
      ARG_CAPTURE: capture,
      PATH: `${directory}:${process.env.PATH ?? ''}`,
      PILOT_HOMOLOGATION_ENV_FILE: environmentFile,
      PILOT_BACKUP_RESTORE_CONFIRMATION: 'RESTORE_SYNTHETIC_HOMOLOGATION',
      PILOT_ROLLBACK_CONFIRMATION: 'PREPARE_HOMOLOGATION_ROLLBACK',
    };

    expect((await runBash('"$1" --execute', [backupRestoreScript], environment)).code).toBe(0);
    expect((await runBash('"$1" --prepare', [rollbackScript], environment)).code).toBe(0);
    const calls = await readCalls(capture);
    expect(calls.length).toBeGreaterThan(8);
    expect(calls.every((call) => call.slice(0, 7).every((value, index) => value === composePrefix(environmentFile)[index]))).toBe(true);
    expect(calls.some((call) => call.slice(7).join(' ') === 'stop api worker')).toBe(true);
    expect(calls.some((call) => call.slice(7, 10).join(' ') === 'exec -T postgres')).toBe(true);
    expect(calls.every((call) => !call.slice(7).includes(environmentFile))).toBe(true);
    expect((await readdir(join(directory, 'backups'))).some((entry) => entry.endsWith('.dump'))).toBe(true);
  });
});
