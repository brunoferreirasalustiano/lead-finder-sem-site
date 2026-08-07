import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../database/migrations/0045_restricted_manual_email_review_followups.sql', import.meta.url),
  'utf8',
);
const openOrderMigration = readFileSync(
  new URL('../../../database/migrations/0046_restricted_manual_email_open_order.sql', import.meta.url),
  'utf8',
);

describe('restricted manual email replay hardening migration', () => {
  it('recognizes only the historical V1 fingerprint shape', () => {
    expect(migration).toContain("preparation.template_version = 'v1'");
    expect(migration).toContain('legacy_contact_fingerprint');
    expect(migration).toContain("preparation.result_snapshot->>'contactFingerprint'");
    expect(migration).toContain("'manual email contact fingerprint changed'");
    expect(migration).toMatch(/resolved\.contact_fingerprint::text\r?\n\s+IS DISTINCT FROM preparation\.result_snapshot->>'contactFingerprint'/);
  });

  it('checks the persisted OPENED event before resolving live state', () => {
    const existingEventLookup = migration.indexOf(
      "WHERE event.preparation_id=p_preparation_id AND event.event_type='OPENED'",
    );
    const liveResolution = migration.indexOf(
      'PERFORM 1 FROM public.resolve_manual_email_preparation_context(',
    );
    expect(existingEventLookup).toBeGreaterThan(-1);
    expect(liveResolution).toBeGreaterThan(existingEventLookup);
  });

  it('inserts a first OPENED before live validation and validates it with require_open', () => {
    const firstInsert = openOrderMigration.indexOf(
      'INSERT INTO public.pilot_manual_message_events(',
    );
    const liveResolution = openOrderMigration.indexOf(
      'PERFORM 1 FROM public.resolve_manual_email_preparation_context(',
    );
    expect(firstInsert).toBeGreaterThanOrEqual(0);
    expect(liveResolution).toBeGreaterThan(firstInsert);
    expect(openOrderMigration.slice(liveResolution, liveResolution + 220)).toContain(
      'p_preparation_id,p_operator_principal_id,true',
    );
  });
});
