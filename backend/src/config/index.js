import dotenv from 'dotenv';

dotenv.config();

const required = (key, fallback = undefined) => {
  const val = process.env[key] ?? fallback;
  return val;
};

// When the LLM engine runs in the same container, its admin account comes from the
// engine's own startup config (FREEAPI_CONFIG_JSON); reuse it instead of duplicating secrets.
function engineAdminFromConfig() {
  try {
    return JSON.parse(process.env.FREEAPI_CONFIG_JSON || '{}').admin ?? {};
  } catch {
    return {};
  }
}
const engineAdmin = engineAdminFromConfig();

export const config = {
  port: Number(required('PORT', 4000)),
  nodeEnv: required('NODE_ENV', 'development'),
  corsOrigin: required('CORS_ORIGIN', 'http://localhost:3000'),

  llm: {
    engineBaseUrl: required('LLM_ENGINE_BASE_URL', 'http://localhost:3001/v1'),
    engineApiKey: required('LLM_ENGINE_API_KEY', ''),
    adminEmail: required('ENGINE_ADMIN_EMAIL', engineAdmin.email ?? ''),
    adminPassword: required('ENGINE_ADMIN_PASSWORD', engineAdmin.password ?? ''),
    defaultModel: required('LLM_DEFAULT_MODEL', 'auto'),
    // Ordered chat model chain (tried in order on error/timeout); chosen by benchmark.
    chatModels: required('LLM_CHAT_MODELS', 'gpt-oss-120b,qwen3.8-27b,command-a-2,gemini-3.5-flash-lite,auto')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    chatTimeoutMs: Number(required('LLM_CHAT_TIMEOUT_MS', 20000)),
    embeddingModel: required('LLM_EMBEDDING_MODEL', 'gemini-embedding-001'),
    embeddingDimensions: Number(required('LLM_EMBEDDING_DIMENSIONS', 768)),
    fallbackBaseUrl: required('FALLBACK_PROVIDER_BASE_URL', ''),
    fallbackApiKey: required('FALLBACK_PROVIDER_API_KEY', ''),
    fallbackModel: required('FALLBACK_MODEL', ''),
  },

  supabase: {
    url: required('SUPABASE_URL', ''),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', ''),
    anonKey: required('SUPABASE_ANON_KEY', ''),
  },

  automation: {
    bookingWebhook: required('N8N_BOOKING_WEBHOOK_URL', ''),
    escalationWebhook: required('N8N_ESCALATION_WEBHOOK_URL', ''),
  },

  agent: {
    maxToolIterations: Number(required('AGENT_MAX_TOOL_ITERATIONS', 5)),
    turnTimeoutMs: Number(required('AGENT_TURN_TIMEOUT_MS', 30000)),
  },
};
