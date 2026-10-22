/**
 * Generates the secrets for the deployed container (Render) from the local engine
 * config (infra/llm-engine/freellmapi.config.json).
 *
 * Outputs (both gitignored):
 *   infra/render/freellmapi.config.secret.local  → value of FREEAPI_CONFIG_JSON
 *   infra/render/render-env.local                → other env vars + dashboard login
 *
 * Re-running is safe: the engine admin account, ENCRYPTION_KEY and admin-door key
 * are reused. They must stay stable once encrypted backups exist — a restored
 * database keeps the old admin account and can only be decrypted with the old key.
 * Nothing secret is printed.
 *
 * Usage: node infra/render/make-config-secret.mjs
 *        HF_BACKUP_DATASET=<user>/<dataset> SERVICE_URL=https://... node infra/render/make-config-secret.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'llm-engine', 'freellmapi.config.json');
const configOut = path.join(here, 'freellmapi.config.secret.local');
const envOut = path.join(here, 'render-env.local');

const dataset = process.env.HF_BACKUP_DATASET || 'zeiadE/brightsmile-llm-backup';
const serviceUrl = (process.env.SERVICE_URL || 'https://brightsmile-api-3si7.onrender.com').replace(/\/+$/, '');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const local = readJson(source);
if (!local) throw new Error(`cannot read ${source}`);
const keys = (local.keys ?? []).filter((k) => k.key && k.key.trim());
if (keys.length === 0) throw new Error(`no provider keys found in ${source}`);

const previous = readJson(configOut);
const previousEnv = readEnvFile(envOut);

const admin = previous?.admin ?? {
  email: `engine-admin-${crypto.randomBytes(4).toString('hex')}@brightsmile.app`,
  password: crypto.randomBytes(24).toString('base64url'),
};

const env = {
  ENCRYPTION_KEY: previousEnv.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
  LLM_ADMIN_DOOR_KEY: previousEnv.LLM_ADMIN_DOOR_KEY || crypto.randomBytes(24).toString('base64url'),
  FREEAPI_DB_BACKUP_TARGET: `https://huggingface.co/datasets/${dataset}/resolve/main/freellmapi.db.backup`,
  FREEAPI_DB_BACKUP_INTERVAL_MS: '1800000',
};

fs.writeFileSync(configOut, JSON.stringify({ admin, keys, routing: local.routing ?? { strategy: 'balanced' } }));

fs.writeFileSync(
  envOut,
  [
    '# Render → brightsmile-api → Environment. Add each KEY=VALUE below as an env var.',
    '# Also add FREEAPI_DB_BACKUP_TOKEN = a fine-grained Hugging Face token with write',
    '# access to the backup dataset only (create it yourself; never commit or share it).',
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    '',
    '# --- Not env vars: how to open the live engine dashboard ---',
    `# 1. Open: ${serviceUrl}/__llm-admin?key=${env.LLM_ADMIN_DOOR_KEY}`,
    `# 2. Sign in: ${admin.email} / ${admin.password}`,
    `# Leave: ${serviceUrl}/__llm-admin/logout`,
    '',
  ].join('\n'),
);

console.log(`Wrote ${path.relative(process.cwd(), configOut)} (FREEAPI_CONFIG_JSON)`);
console.log(`Wrote ${path.relative(process.cwd(), envOut)} (env vars + dashboard login)`);
console.log(`Providers included: ${keys.map((k) => k.platform).join(', ')}`);
console.log(`Admin account: ${previous?.admin ? 'reused' : 'generated'} · ENCRYPTION_KEY: ${previousEnv.ENCRYPTION_KEY ? 'reused' : 'generated'} · door key: ${previousEnv.LLM_ADMIN_DOOR_KEY ? 'reused' : 'generated'}`);
console.log(`Backup dataset: ${dataset}`);
