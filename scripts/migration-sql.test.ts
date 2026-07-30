import { describe, expect, it } from 'vitest';
import { prepareMigrationSqlForRunner } from './migration-sql.js';

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

describe('migration SQL transaction ownership', () => {
  it('removes an external wrapper while preserving header and footer comments', () => {
    const sql = `-- migration header
BEGIN TRANSACTION;

DO $body$
BEGIN
  PERFORM 'COMMIT;';
END
$body$;

COMMIT WORK;
-- migration footer`;

    const prepared = prepareMigrationSqlForRunner(sql);
    expect(compact(prepared)).toBe(compact(`-- migration header
DO $body$
BEGIN
  PERFORM 'COMMIT;';
END
$body$;
-- migration footer`));
    expect(prepared).not.toMatch(/BEGIN\s+TRANSACTION/i);
    expect(prepared).not.toMatch(/COMMIT\s+WORK/i);
  });

  it('supports START TRANSACTION as the external opener', () => {
    expect(compact(prepareMigrationSqlForRunner(
      '/* header */ START TRANSACTION; SELECT 1; COMMIT TRANSACTION;',
    ))).toBe(compact('/* header */ SELECT 1;'));
  });

  it('preserves migration SQL that has no top-level transaction control', () => {
    const sql = `CREATE TABLE example(id integer);
DO $$
BEGIN
  PERFORM 'BEGIN; COMMIT;';
END
$$;
SELECT 'ROLLBACK;' AS value;`;
    expect(prepareMigrationSqlForRunner(sql)).toBe(sql);
  });

  it('ignores transaction words inside nested comments and quoted identifiers', () => {
    const sql = `/* outer /* BEGIN; */ COMMIT; */
CREATE TABLE "COMMIT"("BEGIN" text);`;
    expect(prepareMigrationSqlForRunner(sql)).toBe(sql);
  });

  it.each([
    'BEGIN;\nSELECT 1;',
    'SELECT 1;\nCOMMIT;',
    'BEGIN;\nCOMMIT;\nSELECT 1;',
    'SELECT 1;\nBEGIN;\nCOMMIT;',
    'BEGIN;\nROLLBACK;',
    'ROLLBACK;',
  ])('rejects unsupported top-level transaction control: %s', (sql) => {
    expect(() => prepareMigrationSqlForRunner(sql))
      .toThrow('MIGRATION_TOP_LEVEL_TRANSACTION_CONTROL_UNSUPPORTED');
  });

  it('rejects an empty wrapped migration', () => {
    expect(() => prepareMigrationSqlForRunner('BEGIN; COMMIT;'))
      .toThrow('MIGRATION_SQL_EMPTY_AFTER_TRANSACTION_NORMALIZATION');
  });

  it.each([
    "SELECT 'unterminated;",
    'DO $tag$ BEGIN PERFORM 1; END;',
    '/* unterminated',
  ])('rejects unterminated SQL lexical regions: %s', (sql) => {
    expect(() => prepareMigrationSqlForRunner(sql))
      .toThrow('MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT');
  });
});
