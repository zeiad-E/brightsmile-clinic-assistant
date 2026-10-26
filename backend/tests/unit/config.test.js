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
    expect(config.agent.turnTimeoutMs).toBe(45000);
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

  const productionEnv = {
    NODE_ENV: 'production',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SUPABASE_ANON_KEY: 'anon-key',
    PERSONAL_CODE_SECRET: 'x'.repeat(32),
  };

  it('starts in production once the required secrets are present', () => {
    const config = loadConfig(productionEnv);

    expect(config.supabase.url).toBe('https://example.supabase.co');
    expect(config.auth.personalCodeSecret).toBe('x'.repeat(32));
  });

  it('refuses a short personal-code secret in production', () => {
    expect(() => loadConfig({ ...productionEnv, PERSONAL_CODE_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('uses a development-only code secret outside production', () => {
    expect(loadConfig({}).auth.personalCodeSecret).toMatch(/^dev-only/);
  });

  it('requires the matching credentials for the chosen email provider', () => {
    expect(() => loadConfig({ EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_USER/);
    expect(() => loadConfig({ EMAIL_PROVIDER: 'brevo' })).toThrow(/BREVO_API_KEY/);
    expect(loadConfig({}).email.provider).toBe('log');
  });

  it('reuses the engine admin account from FREEAPI_CONFIG_JSON', () => {
    const config = loadConfig({ FREEAPI_CONFIG_JSON: JSON.stringify({ admin: { email: 'a@b.c', password: 'pw' } }) });

    expect(config.llm.adminEmail).toBe('a@b.c');
    expect(config.llm.adminPassword).toBe('pw');
  });
});
