import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const url = new URL(process.env['DATABASE_URL'] ?? '');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
const sql = postgres(url.toString(), { max: 1 });
const query = await readFile('database/security/check_discovery_worker_capabilities.sql', 'utf8');
try {
  // Run against a local database provisioned from HML, including migration
  // 0071. Main intentionally does not own the HML migration lineage.
  await sql.begin(async tx => {
    await tx.unsafe('SET LOCAL ROLE lead_finder_discovery_runtime');
    await tx.unsafe('SET LOCAL transaction_read_only = on');
    assert.equal((await tx.unsafe(query))[0]?.capabilities_ready, true);
  });
  for (const revoke of [
    'REVOKE UPDATE(city) ON public.leads FROM lead_finder_discovery_runtime',
    'REVOKE EXECUTE ON FUNCTION lead_finder_internal.sync_daily6_batch_from_collection(text) FROM lead_finder_discovery_runtime',
  ]) {
    const marker = new Error('ROLLBACK_SYNTHETIC_PRIVILEGE_CHANGE');
    await assert.rejects(sql.begin(async tx => {
      await tx.unsafe(revoke);
      await tx.unsafe('SET LOCAL ROLE lead_finder_discovery_runtime');
      assert.equal((await tx.unsafe(query))[0]?.capabilities_ready, false);
      throw marker;
    }), e => e === marker);
  }
  assert.equal((await sql.unsafe(query))[0]?.capabilities_ready, false, 'administrator must not pass as runtime');
  console.log('DISCOVERY_CAPABILITY_PREFLIGHT=PASS; MISSING_PRIVILEGES_REJECTED=true');
} finally { await sql.end(); }
