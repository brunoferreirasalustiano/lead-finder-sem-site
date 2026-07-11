import { describe, expect, it } from 'vitest';
import { csvCell } from './app.js';

describe('csvCell', () => {
  it.each(['=SUM(1,1)', '+cmd', '-2+3', '@formula'])('neutralizes CSV formula %s', (value) =>
    expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`),
  );
  it('escapes commas, quotes and line breaks', () =>
    expect(csvCell('A,"B"\nC')).toBe('"A,""B""\nC"'));
  it('documents the export cell behavior without changing the 100-row API cap', () =>
    expect(csvCell(null)).toBe('""'));
});
