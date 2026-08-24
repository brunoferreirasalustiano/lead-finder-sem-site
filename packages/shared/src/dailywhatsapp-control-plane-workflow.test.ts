import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflow = await readFile(
  new URL('../../../.github/workflows/dailywhatsapp-readonly-control-plane.yml', import.meta.url),
  'utf8',
);

describe('DailyWhatsApp control-plane workflow', () => {
  it('runs once daily and pins the exact HML source', () => {
    expect(workflow).toContain("cron: '0 12 * * *'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('EXPECTED_HML_SHA: d22891b213bc889d6fe639af916b79eb6493a0c2');
    expect(workflow).toContain('git fetch --no-tags --depth=1 origin hml/render-supabase-plan-b');
    expect(workflow).toContain('test "$actual_hml_sha" = "$EXPECTED_HML_SHA"');
  });

  it('runs build and focused policy tests before reporting success', () => {
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('run: npm run build');
    expect(workflow).toContain('npx vitest run');
    expect(workflow).toContain('daily6-whatsapp-opportunities-route.test.ts');
    expect(workflow).toContain('daily6-readonly-workflow.contract.test.ts');
  });

  it('has no credentials or commercial side-effect commands', () => {
    expect(workflow).not.toMatch(/secrets\./u);
    expect(workflow).not.toMatch(/HML_.*TOKEN/u);
    expect(workflow).not.toMatch(/curl\s/u);
    expect(workflow).not.toMatch(/workflow_run|repository_dispatch/u);
    expect(workflow).not.toMatch(/\bPOST\s|curl\s+-X\s+POST|Gmail\/WhatsApp send=1|database mutations=1/iu);
    expect(workflow).toContain('discovery=0');
    expect(workflow).toContain('database mutations=0');
  });
});
