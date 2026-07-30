export type MigrationRegistrySource = 'LOCAL' | 'IMPORTED' | 'PENDING';

export function parseMigrationOnlyVersion(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.trim();
  if (!normalized) throw new Error('MIGRATION_ONLY_VERSION_BLANK');
  return normalized;
}

export function buildMigrationRunPlan(
  versions: readonly string[],
  sourceFor: (version: string) => MigrationRegistrySource,
  onlyVersion?: string,
): string[] {
  if (!onlyVersion) return [...versions];

  const targetIndex = versions.indexOf(onlyVersion);
  if (targetIndex < 0) {
    throw new Error(`MIGRATION_ONLY_VERSION_UNKNOWN:${onlyVersion}`);
  }

  for (const predecessor of versions.slice(0, targetIndex)) {
    if (sourceFor(predecessor) === 'PENDING') {
      throw new Error(`MIGRATION_ONLY_PREDECESSOR_PENDING:${predecessor}`);
    }
  }

  return versions.slice(0, targetIndex + 1);
}
