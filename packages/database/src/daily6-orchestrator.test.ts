import { describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '@lead-finder/shared';
import {
  DAILY6_PROGRESSIVE_LIMITS,
  emptyDaily6ProviderTelemetry,
  recordDaily6ProviderTelemetry,
  runDaily6Slot,
  selectProgressiveDaily6Candidates,
  shouldCountDaily6ProviderCall,
  shouldStopDaily6SlotAfterDelivery,
  type Daily6CandidateForSelection,
} from './daily6-orchestrator.js';

const candidate = (id: string, overrides: Partial<Daily6CandidateForSelection> = {}): Daily6CandidateForSelection => ({
  lead_id: `${id}-0000-0000-0000-000000000000`,
  contact_id: `${id}-0000-0000-0000-000000000001`,
  lead_name: `Synthetic ${id}`,
  city: 'Campinas',
  category: 'oficinas',
  business_identity_confirmed: true,
  business_active_pass: true,
  public_business_email_present: true,
  email_business_association_pass: true,
  email_inferred: false,
  official_site_found: false,
  site_search_high: true,
  prior_contact: false,
  duplicate: false,
  pending_or_ambiguous_send: false,
  suppressed: false,
  hard_bounce: false,
  opt_out: false,
  do_not_contact: false,
  nao_contatar: false,
  email_channel_allowed: true,
  current_verified_evidence_required: true,
  legacy_status_only: false,
  evidence_ids: ['synthetic-evidence'],
  ...overrides,
});

describe('progressive Daily-6 candidate selection', () => {
  it('does not count a Gmail SENT reconciliation as a provider send', () => {
    expect(shouldCountDaily6ProviderCall({
      state: 'DELIVERED',
      replayed: false,
      providerCalled: false,
    })).toBe(false);
    expect(shouldCountDaily6ProviderCall({
      state: 'DELIVERED',
      replayed: false,
      providerCalled: true,
    })).toBe(true);
  });

  it('aggregates typed provider outcomes and reasons without message data', () => {
    const telemetry = emptyDaily6ProviderTelemetry();
    recordDaily6ProviderTelemetry(telemetry, 'PROVIDER_SUCCESS');
    recordDaily6ProviderTelemetry(telemetry, 'RATE_LIMITED', 'HTTP_429');
    recordDaily6ProviderTelemetry(telemetry, 'TIMEOUT', 'TIMEOUT');
    recordDaily6ProviderTelemetry(telemetry, 'UNAVAILABLE', 'OAUTH_UNAVAILABLE');
    recordDaily6ProviderTelemetry(telemetry, 'AMBIGUOUS', 'PROVIDER_OUTCOME_UNKNOWN');

    expect(telemetry.outcomes).toMatchObject({
      PROVIDER_SUCCESS: 1,
      RATE_LIMITED: 1,
      TIMEOUT: 1,
      UNAVAILABLE: 1,
      AMBIGUOUS: 1,
    });
    expect(telemetry.reasons).toMatchObject({
      HTTP_429: 1,
      TIMEOUT: 1,
      OAUTH_UNAVAILABLE: 1,
      PROVIDER_OUTCOME_UNKNOWN: 1,
    });
    expect(JSON.stringify(telemetry)).not.toMatch(/@|messageId|recipient|subject/i);
  });

  it('stops the slot after the first ambiguous delivery without processing the next approval', () => {
    const approved = ['approved-1', 'approved-2'];
    const processed: string[] = [];
    let providerCalls = 0;

    for (const candidateId of approved) {
      processed.push(candidateId);
      providerCalls += 1;
      const delivery = candidateId === 'approved-1' ? 'AMBIGUOUS' as const : 'DELIVERED' as const;
      if (shouldStopDaily6SlotAfterDelivery(delivery)) break;
    }

    expect(processed).toEqual(['approved-1']);
    expect(providerCalls).toBe(1);
  });

  it('continues after rejects and stops immediately at the second approval', async () => {
    const calls: string[] = [];
    const result = await selectProgressiveDaily6Candidates(
      ['a', 'b', 'c', 'd', 'e'].map((id) => candidate(id)),
      'Campinas',
      (item) => {
        calls.push(item.lead_id[0]!);
        return { status: item.lead_id.startsWith('c') || item.lead_id.startsWith('d') ? 'APPROVED' : 'REJECTED' };
      },
    );
    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(result.approved).toBe(2);
    expect(result.targetReached).toBe(true);
    expect(result.stopReason).toBe('TARGET_APPROVED_REACHED');
    expect(result.finalistsEvaluated).toBe(4);
  });

  it('does not call the evaluator for cheap-filtered candidates', async () => {
    const calls: string[] = [];
    const result = await selectProgressiveDaily6Candidates(
      [candidate('blocked', { suppressed: true }), candidate('valid')],
      'Campinas',
      (item) => { calls.push(item.lead_id.slice(0, 5)); return { status: 'APPROVED' }; },
    );
    expect(calls).toEqual(['valid']);
    expect(result.cheapFilterRejected).toBe(1);
    expect(result.rejectionReasons.SUPPRESSED).toBe(1);
    expect(result.approved).toBe(1);
  });

  it('keeps UNKNOWN out of approved and can continue to another candidate', async () => {
    const result = await selectProgressiveDaily6Candidates(
      [candidate('unknown'), candidate('approved')],
      'Campinas',
      (item) => item.lead_id.startsWith('unknown')
        ? { status: 'UNKNOWN', reason: 'SOURCE_UNAVAILABLE' }
        : { status: 'APPROVED' },
    );
    expect(result.approved).toBe(1);
    expect(result.unknown).toBe(1);
    expect(result.rejectionReasons.SOURCE_UNAVAILABLE).toBe(1);
  });

  it('stops fail-closed on a terminal provider condition', async () => {
    const calls: string[] = [];
    const result = await selectProgressiveDaily6Candidates(
      [candidate('first'), candidate('second')],
      'Campinas',
      (item) => { calls.push(item.lead_id); return { status: 'BLOCKED', reason: 'CNPJ_WS_RATE_LIMITED', terminal: true }; },
    );
    expect(calls).toHaveLength(1);
    expect(result.approved).toBe(0);
    expect(result.stopReason).toBe('FAIL_CLOSED');
  });

  it('never evaluates more than the bounded finalist budget', async () => {
    let evaluated = 0;
    const result = await selectProgressiveDaily6Candidates(
      Array.from({ length: 40 }, (_, index) => candidate(`c${String(index).padStart(2, '0')}`)),
      'Campinas',
      () => { evaluated += 1; return { status: 'REJECTED', reason: 'NOT_ELIGIBLE' }; },
    );
    expect(evaluated).toBe(DAILY6_PROGRESSIVE_LIMITS.maxFinalistsEvaluated);
    expect(result.finalistsEvaluated).toBe(DAILY6_PROGRESSIVE_LIMITS.maxFinalistsEvaluated);
    expect(result.approved).toBe(0);
    expect(result.stopReason).toBe('MAX_FINALISTS_REACHED');
  });

  it('returns one or zero approved without lowering eligibility', async () => {
    const one = await selectProgressiveDaily6Candidates([candidate('one')], 'Campinas', () => ({ status: 'APPROVED' }));
    const zero = await selectProgressiveDaily6Candidates([candidate('none')], 'Campinas', () => ({ status: 'REJECTED', reason: 'QUALITY_GATE' }));
    expect(one.approved).toBe(1);
    expect(zero.approved).toBe(0);
    expect(zero.stopReason).toBe('NO_ELIGIBLE_CANDIDATES');
  });
});

describe('Daily-6 city contract', () => {
  const authorization = createAuthorizationContext({
    principalId: 'synthetic-scheduler',
    permissions: new Set(['daily6:execute']),
    authenticationMethod: 'HML_DAILY6_BEARER_TOKEN',
  });
  const runtime = {
    enabled: true,
    realSendEnabled: true,
    manualEmailSendEnabled: true,
    killSwitchEnabled: false,
    sender: 'leadfinderbrasil@gmail.com',
    fingerprintKey: 'synthetic-fingerprint-key',
    operationalSha: 'a'.repeat(40),
    deliver: vi.fn(),
    searchSent: vi.fn().mockResolvedValue({ state: 'NOT_FOUND' }),
  };

  it('accepts the scheduler alias Campinas and canonicalizes its batch identity', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ job_exists: true, status: 'COMPLETED', error: null, attempt_count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'COMPLETED', terminal_reason: 'NO_ELIGIBLE_CANDIDATES' }]);
    const report = await runDaily6Slot(
      { execute } as never,
      {
        date: '2026-08-13',
        slot: '09',
        city: 'Campinas',
        policyVersion: 'daily6-v1',
        expectedOperationalSha: 'a'.repeat(40),
      },
      authorization,
      runtime,
    );

    expect(report.batchId).toBe('2026-08-13|09|campinas-sp|daily6-v1');
    expect(report.discoveryExecuted).toBe(true);
    expect(report.batchStatus).toBe('COMPLETED');
    expect(report.batchTerminalReason).toBe('NO_ELIGIBLE_CANDIDATES');
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('rejects a slot whose fresh collection identity is missing', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ job_exists: false, status: 'MISSING', error: null, attempt_count: 0 }]);
    await expect(runDaily6Slot(
      { execute } as never,
      {
        date: '2026-08-13',
        slot: '13',
        city: 'Campinas',
        policyVersion: 'daily6-v1',
        expectedOperationalSha: 'a'.repeat(40),
      },
      authorization,
      runtime,
    )).rejects.toThrow('DAILY6_DISCOVERY_NOT_TERMINAL');
  });

  it('rejects a non-Campinas city before touching persistence', async () => {
    const execute = vi.fn();
    await expect(runDaily6Slot(
      { execute } as never,
      {
        date: '2026-08-13',
        slot: '09',
        city: 'Sao Paulo',
        policyVersion: 'daily6-v1',
        expectedOperationalSha: 'a'.repeat(40),
      },
      authorization,
      runtime,
    )).rejects.toThrow('DAILY6_CITY_NOT_ALLOWED');
    expect(execute).not.toHaveBeenCalled();
  });
});
