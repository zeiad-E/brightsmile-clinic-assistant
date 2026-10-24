import { defineConfig } from 'vitest/config';

/**
 * Unit tests live in tests/unit (fast, no database).
 * Integration tests (tests/integration, added later) run against local Supabase in Docker.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Makes config/index.js load `.env.test`, never the real `.env`.
    env: { NODE_ENV: 'test' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      reporter: ['text', 'html'],
    },
  },
});
