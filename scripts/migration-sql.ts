export function prepareMigrationSqlForRunner(source: string): string {
  const normalized = source.trim();
  const leadingTransaction = /^BEGIN\s*;/i.test(normalized);
  const trailingTransaction = /COMMIT\s*;$/i.test(normalized);

  if (leadingTransaction !== trailingTransaction) {
    throw new Error('MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE');
  }

  if (!leadingTransaction) return normalized;

  const withoutLeading = normalized.replace(/^BEGIN\s*;\s*/i, '');
  const withoutWrapper = withoutLeading.replace(/\s*COMMIT\s*;$/i, '');
  if (!withoutWrapper.trim()) {
    throw new Error('MIGRATION_SQL_EMPTY_AFTER_TRANSACTION_NORMALIZATION');
  }
  return withoutWrapper.trim();
}
