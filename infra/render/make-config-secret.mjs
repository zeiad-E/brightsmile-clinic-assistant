/**
 * Builds the FREEAPI_CONFIG_JSON value for the deployed container from the local
 * engine config (infra/llm-engine/freellmapi.config.json).
 *
 * - drops provider entries with an empty key
 * - adds a random engine admin account (used only by the backend, inside the container)
 *
 * Output: infra/render/freellmapi.config.secret.local (gitignored). Paste its content
 * into the hosting provider's secret env var FREEAPI_CONFIG_JSON. Nothing secret is printed.
 *
 * Usage: node infra/render/make-config-secret.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, '..', 'llm-engine', 'freellmapi.config.json');
const target = path.join(here, 'freellmapi.config.secret.local');

const local = JSON.parse(fs.readFileSync(source, 'utf8'));
const keys = (local.keys ?? []).filter((k) => k.key && k.key.trim());
if (keys.length === 0) throw new Error(`no provider keys found in ${source}`);

const config = {
  admin: {
    email: `engine-admin-${crypto.randomBytes(4).toString('hex')}@brightsmile.app`,
    password: crypto.randomBytes(24).toString('base64url'),
  },
  keys,
  routing: local.routing ?? { strategy: 'balanced' },
};

fs.writeFileSync(target, JSON.stringify(config));
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
console.log(`Providers included: ${keys.map((k) => k.platform).join(', ')}`);
console.log('Admin account: generated (random; used only by the backend inside the container).');
