import { parse } from 'cookie';
import { config } from '../config/index.js';
import { randomToken, sha256Hex } from './secrets.js';

/**
 * The guest's chat cookie: a random secret that lets a visitor who hasn't signed in come back
 * to their chat, like a cloakroom ticket. The database keeps only its fingerprint
 * (conversations.visitor_hash), so reading the table gives nobody a usable ticket.
 *
 *  - HttpOnly: page scripts can't read it, so an injected script can't steal it.
 *  - SameSite=Strict: the browser won't attach it to requests started by another website.
 *  - Path=/api: it travels to the chat (/api/chat) and to sign-in (/api/auth), where a guest's
 *    chats move to their account.
 *  - 30 days, renewed with every chat message.
 *
 * It is created only when a guest sends a chat message, and cleared when someone signs in
 * (their chats are then in their account) or out, so the next person on a shared computer
 * starts clean.
 */
const NAME = 'bs_vid';
export const VISITOR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VALID = /^[A-Za-z0-9_-]{40,64}$/; // randomToken(32) is 43 base64url characters

const attributes = () => ({ httpOnly: true, sameSite: 'strict', secure: config.auth.cookieSecure, path: '/api' });

/** The secret in the request's cookie, or null (a missing or malformed cookie counts as none). */
export function readVisitor(req) {
  const header = req.get('cookie');
  const value = header ? parse(header)[NAME] : null;
  return value && VALID.test(value) ? value : null;
}

/** This visitor's secret, starting one if they have none; sets (or renews) the cookie. */
export function ensureVisitor(req, res) {
  const secret = readVisitor(req) ?? randomToken();
  res.cookie(NAME, secret, { ...attributes(), maxAge: VISITOR_MAX_AGE_MS });
  return secret;
}

export function clearVisitor(res) {
  res.clearCookie(NAME, attributes());
}

/** What the database stores and compares. */
export const visitorHash = (secret) => (secret ? sha256Hex(secret) : null);
