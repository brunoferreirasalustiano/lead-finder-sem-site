import { describe, expect, it } from 'vitest';
import { prepareMigrationSqlForRunner } from './migration-sql.js';

describe('migration SQL transaction ownership', () => {
  it('removes only an external BEGIN/COMMIT wrapper', () => {
    const sql = `BEGIN;

DO $$
BEGIN
  PERFORM 1;
END
$$;

COMMIT;`;

    expect(prepareMigrationSqlForRunner(sql)).toBe(`DO $$
BEGIN
  PERFORM 1;
END
$$;`);
  });

  it('preserves migration SQL that has no external wrapper', () => {
    const sql = `CREATE TABLE example(id integer);
DO $$
BEGIN
  PERFORM 1;
END
$$;`;
    expect(prepareMigrationSqlForRunner(sql)).toBe(sql);
  });

  it.each([
    'BEGIN;\nSELECT 1;',
    'SELECT 1;\nCOMMIT;',
  ])('rejects an incomplete external transaction wrapper', (sql) => {
    expect(() => prepareMigrationSqlForRunner(sql))
      .toThrow('MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE');
  });

  it('rejects an empty wrapped migration', () => {
    expect(() => prepareMigrationSqlForRunner('BEGIN; COMMIT;'))
      .toThrow('MIGRATION_SQL_EMPTY_AFTER_TRANSACTION_NORMALIZATION');
  });
});
