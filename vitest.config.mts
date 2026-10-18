import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          env: {
            ANALYTICS_URL: 'http://analytics.test',
            ANALYTICS_API_KEY: 'unit-test-key',
            RELEVANCE_THRESHOLD: '0.5',
          },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Comparten una base de datos: en serie y con más tiempo
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['lib/**/*.d.ts'],
      reporter: ['text', 'html', 'lcov'],
      // Umbral de los tests unitarios. El código que solo habla con SQL Server
      // (retrieval.ts, logQuery/saveAnswer/saveFeedback, GET de documentos) lo cubren los de integración.
      thresholds: { lines: 70, statements: 70, branches: 70, functions: 65 },
    },
  },
});
