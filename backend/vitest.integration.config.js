import { defineConfig } from 'vitest/config';

/**
 * Integration tests: real HTTP requests into the app, real Supabase behind it.
 *
 *   npm run test:int        → the database in .env.test (local Supabase in Docker)
 *   npm run test:int:live   → the database in .env (the LIVE project). Every test record
 *                             is marked with @integration.test and deleted afterwards.
 *
 * Runs one file at a time, in order: the tests build on each other (book → reschedule → cancel).
 */
export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { NODE_ENV: 'test', ENV_FILE: mode === 'live' ? '.env' : '.env.test' },
  },
}));
