import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/api/src/api-contracts.test.ts',
      'packages/database/src/safe-projections.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'apps/api/src/api-contracts.ts',
        'packages/database/src/safe-projections.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
