import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * App configuration, read once from environment variables and validated with zod.
 *
 * Why validate: a typo or a missing secret should stop the server at boot with a
 * clear message, not surface later as a confusing error in the middle of a request.
 *
 * Tests load `.env.test` instead of `.env`, so a test run can never reach the live
 * database by accident.
 */
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: fileURLToPath(new URL(`../../${envFile}`, import.meta.url)) });

const text = (fallback = '') => z.string().trim().default(fallback);
const positiveInt = (fallback) => z.coerce.number().int().positive().default(fallback);

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    CORS_ORIGIN: text('http://localhost:3000'),

    LLM_ENGINE_BASE_URL: text('http://localhost:3001/v1'),
    LLM_ENGINE_API_KEY: text(),
    ENGINE_ADMIN_EMAIL: text(),
    ENGINE_ADMIN_PASSWORD: text(),
    FREEAPI_CONFIG_JSON: text(),
    LLM_DEFAULT_MODEL: text('auto'),
    // Ordered chat model chain (tried in order on error/timeout); chosen by benchmark.
    LLM_CHAT_MODELS: text('gpt-oss-120b,qwen3.8-27b,command-a-2,gemini-3.5-flash-lite,auto'),
    LLM_CHAT_TIMEOUT_MS: positiveInt(20000),
    LLM_EMBEDDING_MODEL: text('gemini-embedding-001'),
    LLM_EMBEDDING_DIMENSIONS: positiveInt(768),
    FALLBACK_PROVIDER_BASE_URL: text(),
    FALLBACK_PROVIDER_API_KEY: text(),
    FALLBACK_MODEL: text(),

    // Secret entry key for the LLM engine dashboard proxy; empty disables the door.
    LLM_ADMIN_DOOR_KEY: text(),

    SUPABASE_URL: text(),
    SUPABASE_SERVICE_ROLE_KEY: text(),
    SUPABASE_ANON_KEY: text(),

    N8N_BOOKING_WEBHOOK_URL: text(),
    N8N_ESCALATION_WEBHOOK_URL: text(),

    AGENT_MAX_TOOL_ITERATIONS: positiveInt(5),
    AGENT_TURN_TIMEOUT_MS: positiveInt(30000),

    // Fingerprints personal sign-in codes (HMAC). Changing it invalidates every issued code.
    PERSONAL_CODE_SECRET: text(),
    // Where the frontend lives; used for links in emails.
    APP_URL: text('http://localhost:3000'),

    // log = print only (dev/tests) · smtp = Gmail via nodemailer · brevo = Brevo HTTPS API
    EMAIL_PROVIDER: z.enum(['log', 'smtp', 'brevo']).default('log'),
    MAIL_FROM: text(), // e.g. "BrightSmile Dental <clinic@gmail.com>"
    SMTP_HOST: text('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    SMTP_USER: text(),
    SMTP_PASS: text(),
    BREVO_API_KEY: text(),
  })
  .superRefine((env, ctx) => {
    const requireKeys = (keys, why) => {
      for (const key of keys) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `is required ${why}` });
      }
    };

    if (env.EMAIL_PROVIDER === 'smtp') requireKeys(['SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'], 'when EMAIL_PROVIDER=smtp');
    if (env.EMAIL_PROVIDER === 'brevo') requireKeys(['BREVO_API_KEY', 'MAIL_FROM'], 'when EMAIL_PROVIDER=brevo');

    if (env.NODE_ENV !== 'production') return;
    requireKeys(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'PERSONAL_CODE_SECRET'], 'in production');
    if (env.PERSONAL_CODE_SECRET && env.PERSONAL_CODE_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['PERSONAL_CODE_SECRET'], message: 'must be at least 32 characters' });
    }
  });

// Local development and tests may run without a real secret; production never does (checked above).
const DEV_PERSONAL_CODE_SECRET = 'dev-only-personal-code-secret-never-use-in-production';

// When the LLM engine runs in the same container, its admin account comes from the
// engine's own startup config (FREEAPI_CONFIG_JSON); reuse it instead of duplicating secrets.
function engineAdminFromConfig(json) {
  try {
    return JSON.parse(json || '{}').admin ?? {};
  } catch {
    return {};
  }
}

/** Validates an env object and builds the config. Exported so tests can feed their own env. */
export function loadConfig(rawEnv = process.env) {
  // `KEY=` in a .env file means "not set", so empty strings fall back to the defaults.
  const present = Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(present);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }

  const env = parsed.data;
  const engineAdmin = engineAdminFromConfig(env.FREEAPI_CONFIG_JSON);

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    corsOrigin: env.CORS_ORIGIN,

    llm: {
      engineBaseUrl: env.LLM_ENGINE_BASE_URL,
      engineApiKey: env.LLM_ENGINE_API_KEY,
      adminEmail: env.ENGINE_ADMIN_EMAIL || (engineAdmin.email ?? ''),
      adminPassword: env.ENGINE_ADMIN_PASSWORD || (engineAdmin.password ?? ''),
      defaultModel: env.LLM_DEFAULT_MODEL,
      chatModels: env.LLM_CHAT_MODELS.split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      chatTimeoutMs: env.LLM_CHAT_TIMEOUT_MS,
      embeddingModel: env.LLM_EMBEDDING_MODEL,
      embeddingDimensions: env.LLM_EMBEDDING_DIMENSIONS,
      fallbackBaseUrl: env.FALLBACK_PROVIDER_BASE_URL,
      fallbackApiKey: env.FALLBACK_PROVIDER_API_KEY,
      fallbackModel: env.FALLBACK_MODEL,
    },

    adminDoor: {
      key: env.LLM_ADMIN_DOOR_KEY,
    },

    supabase: {
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      anonKey: env.SUPABASE_ANON_KEY,
    },

    automation: {
      bookingWebhook: env.N8N_BOOKING_WEBHOOK_URL,
      escalationWebhook: env.N8N_ESCALATION_WEBHOOK_URL,
    },

    agent: {
      maxToolIterations: env.AGENT_MAX_TOOL_ITERATIONS,
      turnTimeoutMs: env.AGENT_TURN_TIMEOUT_MS,
    },

    appUrl: env.APP_URL,

    auth: {
      personalCodeSecret: env.PERSONAL_CODE_SECRET || DEV_PERSONAL_CODE_SECRET,
    },

    email: {
      provider: env.EMAIL_PROVIDER,
      from: env.MAIL_FROM || 'BrightSmile Dental <no-reply@localhost>',
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS },
      brevoApiKey: env.BREVO_API_KEY,
    },
  };
}

export const config = loadConfig();
