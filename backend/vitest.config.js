import { defineConfig } from 'vitest/config';

/**
 * Unit tests live in tests/unit (fast, no database).
 * Integration tests (tests/integration) have their own config: vitest.integration.config.js.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    // Makes config/index.js load `.env.test`, never the real `.env`.
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
