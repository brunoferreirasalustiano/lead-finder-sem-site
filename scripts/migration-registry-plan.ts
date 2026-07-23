export type MigrationSource = 'LOCAL' | 'SUPABASE' | 'BOTH' | 'PENDING';

export type SupabaseMigrationRow = Readonly<{
  version: string;
  name: string;
}>;

export type MigrationRegistry = {
  local: Set<string>;
  supabase: Map<string, string>;
};

function normalizeMigrationName(value: string, field: string): string {
  const normalized = value.trim().replace(/\.sql$/, '');
  if (!normalized) throw new Error(`${field} migration name is empty`);
  return normalized;
}

export function buildMigrationRegistry(
  localVersions: readonly string[],
  supabaseRows: readonly SupabaseMigrationRow[],
): MigrationRegistry {
  const local = new Set(localVersions.map((value) => normalizeMigrationName(value, 'local')));
  const supabase = new Map<string, string>();
  const namesByVersion = new Map<string, string>();

  for (const row of supabaseRows) {
    const name = normalizeMigrationName(row.name, 'supabase');
    const version = row.version.trim();
    if (!version) throw new Error(`supabase migration ${name} has an empty version`);

    const existingVersion = supabase.get(name);
    if (existingVersion && existingVersion !== version) {
      throw new Error(`supabase migration ${name} has conflicting versions ${existingVersion} and ${version}`);
    }

    const existingName = namesByVersion.get(version);
    if (existingName && existingName !== name) {
      throw new Error(`supabase migration version ${version} has conflicting names ${existingName} and ${name}`);
    }

    supabase.set(name, version);
    namesByVersion.set(version, name);
  }

  return { local, supabase };
}

export function getMigrationSource(registry: MigrationRegistry, migrationName: string): MigrationSource {
  const normalized = normalizeMigrationName(migrationName, 'requested');
  const local = registry.local.has(normalized);
  const supabase = registry.supabase.has(normalized);
  if (local && supabase) return 'BOTH';
  if (local) return 'LOCAL';
  if (supabase) return 'SUPABASE';
  return 'PENDING';
}

export function listMigrationSources(
  registry: MigrationRegistry,
  migrationNames: readonly string[],
): Record<string, MigrationSource> {
  return Object.fromEntries(
    migrationNames.map((migrationName) => [migrationName, getMigrationSource(registry, migrationName)]),
  );
}
