import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * Resolve the LLM engine's unified API key.
 *
 * - Local development: taken from LLM_ENGINE_API_KEY.
 * - Deployed (engine runs privately in the same container on an ephemeral disk):
 *   the key is regenerated on every boot, so we log into the engine's admin API
 *   and read the current key instead of hard-coding it.
 */
export async function resolveEngineApiKey() {
  if (config.llm.engineApiKey) return config.llm.engineApiKey;

  const { adminEmail, adminPassword } = config.llm;
  if (!adminEmail || !adminPassword) {
    throw new Error('LLM engine key unavailable: set LLM_ENGINE_API_KEY or engine admin credentials');
  }

  const origin = new URL(config.llm.engineBaseUrl).origin;

  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!login.ok) throw new Error(`engine admin login failed: HTTP ${login.status}`);
  const { token } = await login.json();

  try {
    const res = await fetch(`${origin}/api/settings/api-key`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`engine key fetch failed: HTTP ${res.status}`);
    const { apiKey } = await res.json();
    logger.info('LLM engine key resolved from engine admin API');
    return apiKey;
  } finally {
    // Session is only needed for this lookup.
    fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}
