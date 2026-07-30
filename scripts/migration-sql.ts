type Statement = {
  start: number;
  end: number;
  code: string;
  codeStart: number | null;
};

type TransactionKind = 'BEGIN' | 'COMMIT' | 'ROLLBACK' | 'OTHER';

function dollarQuoteTagAt(source: string, index: number): string | null {
  const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  return match?.[0] ?? null;
}

function scanTopLevelStatements(source: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let code = '';
  let codeStart: number | null = null;
  let state: 'NORMAL' | 'SINGLE' | 'DOUBLE' | 'LINE_COMMENT' | 'BLOCK_COMMENT' | 'DOLLAR' = 'NORMAL';
  let blockDepth = 0;
  let dollarTag = '';

  const appendCode = (value: string, sourceIndex: number) => {
    code += value;
    if (codeStart === null && /\S/.test(value)) codeStart = sourceIndex;
  };
  const appendMasked = (value: string) => {
    code += value.replace(/[^\r\n]/g, ' ');
  };
  const finish = (end: number) => {
    statements.push({ start, end, code, codeStart });
    start = end;
    code = '';
    codeStart = null;
  };

  for (let index = 0; index < source.length;) {
    const current = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (state === 'NORMAL') {
      if (current === '-' && next === '-') {
        appendMasked('--');
        state = 'LINE_COMMENT';
        index += 2;
        continue;
      }
      if (current === '/' && next === '*') {
        appendMasked('/*');
        state = 'BLOCK_COMMENT';
        blockDepth = 1;
        index += 2;
        continue;
      }
      if (current === "'") {
        appendMasked(current);
        state = 'SINGLE';
        index += 1;
        continue;
      }
      if (current === '"') {
        appendMasked(current);
        state = 'DOUBLE';
        index += 1;
        continue;
      }
      if (current === '$') {
        const tag = dollarQuoteTagAt(source, index);
        if (tag) {
          appendMasked(tag);
          state = 'DOLLAR';
          dollarTag = tag;
          index += tag.length;
          continue;
        }
      }
      if (current === ';') {
        appendCode(current, index);
        finish(index + 1);
        index += 1;
        continue;
      }
      appendCode(current, index);
      index += 1;
      continue;
    }

    if (state === 'SINGLE') {
      if (current === "'" && next === "'") {
        appendMasked("''");
        index += 2;
        continue;
      }
      appendMasked(current);
      if (current === "'") state = 'NORMAL';
      index += 1;
      continue;
    }

    if (state === 'DOUBLE') {
      if (current === '"' && next === '"') {
        appendMasked('""');
        index += 2;
        continue;
      }
      appendMasked(current);
      if (current === '"') state = 'NORMAL';
      index += 1;
      continue;
    }

    if (state === 'LINE_COMMENT') {
      appendMasked(current);
      if (current === '\n') state = 'NORMAL';
      index += 1;
      continue;
    }

    if (state === 'BLOCK_COMMENT') {
      if (current === '/' && next === '*') {
        appendMasked('/*');
        blockDepth += 1;
        index += 2;
        continue;
      }
      if (current === '*' && next === '/') {
        appendMasked('*/');
        blockDepth -= 1;
        index += 2;
        if (blockDepth === 0) state = 'NORMAL';
        continue;
      }
      appendMasked(current);
      index += 1;
      continue;
    }

    if (state === 'DOLLAR') {
      if (source.startsWith(dollarTag, index)) {
        appendMasked(dollarTag);
        index += dollarTag.length;
        state = 'NORMAL';
        dollarTag = '';
        continue;
      }
      appendMasked(current);
      index += 1;
    }
  }

  if (state !== 'NORMAL' && state !== 'LINE_COMMENT') {
    throw new Error('MIGRATION_SQL_UNTERMINATED_LITERAL_OR_COMMENT');
  }
  if (start < source.length || code.trim()) finish(source.length);
  return statements;
}

function classifyTransaction(statement: Statement): TransactionKind {
  const code = statement.code.replace(/;\s*$/, '').trim();
  if (/^(?:BEGIN|START\s+TRANSACTION)\b/i.test(code)) return 'BEGIN';
  if (/^COMMIT\b/i.test(code)) return 'COMMIT';
  if (/^ROLLBACK\b/i.test(code)) return 'ROLLBACK';
  return 'OTHER';
}

export function prepareMigrationSqlForRunner(source: string): string {
  const statements = scanTopLevelStatements(source);
  const meaningful = statements.filter((statement) => statement.code.replace(/;\s*$/, '').trim());
  const transactionStatements = meaningful
    .map((statement) => ({ statement, kind: classifyTransaction(statement) }))
    .filter(({ kind }) => kind !== 'OTHER');

  if (transactionStatements.length === 0) return source.trim();

  const first = meaningful[0];
  const last = meaningful.at(-1);
  const validWrapper = transactionStatements.length === 2
    && first !== undefined
    && last !== undefined
    && transactionStatements[0]?.statement === first
    && transactionStatements[0]?.kind === 'BEGIN'
    && transactionStatements[1]?.statement === last
    && transactionStatements[1]?.kind === 'COMMIT';

  if (!validWrapper) {
    throw new Error('MIGRATION_TOP_LEVEL_TRANSACTION_CONTROL_UNSUPPORTED');
  }

  const begin = transactionStatements[0]!.statement;
  const commit = transactionStatements[1]!.statement;
  if (begin.codeStart === null || commit.codeStart === null) {
    throw new Error('MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE');
  }

  const withoutCommit = source.slice(0, commit.codeStart) + source.slice(commit.end);
  const removedBeforeCommit = commit.end - commit.codeStart;
  const adjustedBeginEnd = begin.end;
  const withoutWrapper = withoutCommit.slice(0, begin.codeStart)
    + withoutCommit.slice(adjustedBeginEnd);

  if (!withoutWrapper.trim()) {
    throw new Error('MIGRATION_SQL_EMPTY_AFTER_TRANSACTION_NORMALIZATION');
  }
  if (removedBeforeCommit <= 0) {
    throw new Error('MIGRATION_TRANSACTION_WRAPPER_INCOMPLETE');
  }
  return withoutWrapper.trim();
}
