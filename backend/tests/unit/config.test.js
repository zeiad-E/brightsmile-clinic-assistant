import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/index.js';

describe('loadConfig', () => {
  it('fills in safe defaults for local development', () => {
    const config = loadConfig({});

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.llm.chatModels[0]).toBe('gpt-oss-120b');
    expect(config.llm.embeddingDimensions).toBe(768);
  });

  it('treats an empty value (`KEY=`) as not set', () => {
    const config = loadConfig({ PORT: '', AGENT_MAX_TOOL_ITERATIONS: '' });

    expect(config.port).toBe(4000);
    expect(config.agent.maxToolIterations).toBe(5);
  });

  it('turns numeric strings into numbers', () => {
    expect(loadConfig({ PORT: '10000' }).port).toBe(10000);
  });

  it('refuses a value of the wrong type', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('refuses to start in production without the database secrets', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/SUPABASE_URL: is required in production/);
  });

  it('starts in production once the database secrets are present', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    });

    expect(config.supabase.url).toBe('https://example.supabase.co');
  });

  it('reuses the engine admin account from FREEAPI_CONFIG_JSON', () => {
    const config = loadConfig({ FREEAPI_CONFIG_JSON: JSON.stringify({ admin: { email: 'a@b.c', password: 'pw' } }) });

    expect(config.llm.adminEmail).toBe('a@b.c');
    expect(config.llm.adminPassword).toBe('pw');
  });
});
