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

  it('refuses short sign-in secrets', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' })).toThrow(/JWT_SECRET: must be at least 32/);
    expect(() => loadConfig({ PROXY_SHARED_SECRET: 'short' })).toThrow(/PROXY_SHARED_SECRET: must be at least 32/);
  });

  const codeKey = (id, fill) => `${id}:${Buffer.alloc(32, fill).toString('base64')}`;

  it('reads the personal-code keys, old ones included', () => {
    const { codeKeys } = loadConfig({
      PERSONAL_CODE_ENCRYPTION_KEY: codeKey('k2', 2),
      PERSONAL_CODE_ENCRYPTION_KEYS_OLD: codeKey('k1', 1),
    }).auth;

    expect(codeKeys.current.id).toBe('k2');
    expect([...codeKeys.byId.keys()].sort()).toEqual(['k1', 'k2']);
  });

  it('refuses a personal-code key in the wrong shape', () => {
    const shortKey = `k1:${Buffer.alloc(16).toString('base64')}`;
    expect(() => loadConfig({ PERSONAL_CODE_ENCRYPTION_KEY: shortKey })).toThrow(/PERSONAL_CODE_ENCRYPTION_KEY/);
    expect(() => loadConfig({ PERSONAL_CODE_ENCRYPTION_KEY: 'no-colon' })).toThrow(/PERSONAL_CODE_ENCRYPTION_KEY/);
  });

  it('sends the sign-in cookie over HTTPS only in production, unless told otherwise', () => {
    expect(loadConfig({}).auth.cookieSecure).toBe(false);
    expect(loadConfig(productionEnv).auth.cookieSecure).toBe(true);
    expect(loadConfig({ ...productionEnv, COOKIE_SECURE: 'false' }).auth.cookieSecure).toBe(false);
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
