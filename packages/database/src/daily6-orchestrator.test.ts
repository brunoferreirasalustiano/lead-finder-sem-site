import { describe, expect, it } from 'vitest';
import {
  DAILY6_PROGRESSIVE_LIMITS,
  selectProgressiveDaily6Candidates,
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
