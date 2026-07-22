import { describe, expect, it } from 'vitest';
import { FakeAiProvider } from './index.js';
describe('fake AI', () => {
  it('is local and deterministic', () => {
    const p = new FakeAiProvider();
    expect(p.draft('x')).toEqual(p.draft('x'));
    expect(p.draft('x').networkCalls).toBe(0);
    expect(p.classify()).toBe('HUMAN_REVIEW');
  });
});
