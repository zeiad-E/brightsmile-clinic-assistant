import crypto from 'node:crypto';
import http from 'node:http';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * "Admin door" for the private LLM engine dashboard.
 *
 * The engine listens only on localhost inside the container. Visiting
 * `/__llm-admin?key=<LLM_ADMIN_DOOR_KEY>` gives that browser an HttpOnly cookie;
 * requests carrying the cookie are proxied to the engine (its dashboard still
 * requires its own login). Everyone else gets the normal API — the door is
 * invisible (wrong keys get a plain 404). Disabled when no key is configured.
 */
const COOKIE = 'llm_admin';
const ENTRY_PATH = '/__llm-admin';
const LOGOUT_PATH = '/__llm-admin/logout';
const MAX_AGE_SECONDS = 8 * 60 * 60;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function withoutDoorCookie(header = '') {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${COOKIE}=`))
    .join('; ');
}

function cookieAttributes(maxAge) {
  return `Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function proxyToEngine(req, res, target) {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https' };
  const cookie = withoutDoorCookie(req.headers.cookie);
  if (cookie) headers.cookie = cookie;
  else delete headers.cookie;

  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path: req.originalUrl, headers },
    (engineRes) => {
      res.writeHead(engineRes.statusCode ?? 502, engineRes.headers);
      engineRes.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    logger.error(`LLM admin door: engine unreachable (${err.message})`);
    if (!res.headersSent) res.status(502).json({ error: 'llm_engine_unreachable' });
    else res.end();
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

export function llmAdminDoor() {
  const secret = config.adminDoor.key;
  if (!secret) return (_req, _res, next) => next();
  if (secret.length < 24) throw new Error('LLM_ADMIN_DOOR_KEY must be at least 24 characters');

  const target = new URL(config.llm.engineBaseUrl);
  const expected = crypto.createHmac('sha256', secret).update('llm-admin-door').digest('hex');

  return (req, res, next) => {
    const { pathname, searchParams } = new URL(req.originalUrl, 'http://internal');

    if (pathname === ENTRY_PATH) {
      if (!safeEqual(searchParams.get('key') ?? '', secret)) {
        logger.warn('LLM admin door: rejected key');
        return res.status(404).end();
      }
      res.setHeader('Set-Cookie', `${COOKIE}=${expected}; ${cookieAttributes(MAX_AGE_SECONDS)}`);
      return res.redirect(302, '/');
    }

    if (pathname === LOGOUT_PATH) {
      res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(0)}`);
      return res.redirect(302, '/health');
    }

    const cookie = parseCookies(req.headers.cookie)[COOKIE];
    if (!cookie || !safeEqual(cookie, expected)) return next();

    return proxyToEngine(req, res, target);
  };
}
