import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/shared/src/**/*.ts',
        'packages/lead-scoring/src/**/*.ts',
        'packages/overpass-client/src/**/*.ts',
        'packages/prospecting-orchestrator/src/**/*.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
