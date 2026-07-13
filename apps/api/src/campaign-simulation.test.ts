import { describe, expect, it } from 'vitest';
import { simulateCampaignMessage } from './campaign-simulation.js';

describe('campaign simulation adapter', () => {
  it('renders deterministic plain text and explicitly never dispatches', () => {
    const input = { channel: 'EMAIL' as const, content: 'Olá {{name}}', allowedVariables: ['name'], values: { name: 'Ana' } };
    expect(simulateCampaignMessage(input)).toEqual({ mode: 'SIMULATION', channel: 'EMAIL', content: 'Olá Ana', dispatched: false });
    expect(simulateCampaignMessage(input)).toEqual(simulateCampaignMessage(input));
  });
  it('preserves active-content template blocking', () => {
    expect(() => simulateCampaignMessage({ channel: 'EMAIL', content: '<{{tag}}>', allowedVariables: ['tag'], values: { tag: 'script' } })).toThrow();
  });
});
