export type MigrationRegistrySource = 'LOCAL' | 'IMPORTED' | 'PENDING';

export function parseMigrationOnlyVersion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim();
  if (!normalized) throw new Error('MIGRATION_ONLY_VERSION_BLANK');
  return normalized;
}

export function assertKnownMigrationOnlyVersion(
  versions: readonly string[],
  onlyVersion: string | undefined,
): void {
  if (onlyVersion !== undefined && !versions.includes(onlyVersion)) {
    throw new Error(`MIGRATION_ONLY_VERSION_UNKNOWN:${onlyVersion}`);
  }
}

export function buildMigrationRunPlan(
  versions: readonly string[],
  sourceFor: (version: string) => MigrationRegistrySource,
  onlyVersion?: string,
): string[] {
  if (!onlyVersion) return [...versions];

  assertKnownMigrationOnlyVersion(versions, onlyVersion);
  const targetIndex = versions.indexOf(onlyVersion);

  for (const predecessor of versions.slice(0, targetIndex)) {
    if (sourceFor(predecessor) === 'PENDING') {
      throw new Error(`MIGRATION_ONLY_PREDECESSOR_PENDING:${predecessor}`);
    }
  }

  return versions.slice(0, targetIndex + 1);
}
