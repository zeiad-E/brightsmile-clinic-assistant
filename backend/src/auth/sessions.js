import crypto from 'node:crypto';
import { requireAdmin } from '../db/supabase.js';
import * as sessionModel from '../models/sessionModel.js';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { randomToken, safeEqual, sha256Hex } from './secrets.js';

/**
 * Sessions: one row per signed-in device, so we can end any of them at once.
 *
 * The refresh token is "<session id>.<random secret>". The database keeps only a fingerprint of
 * the secret, so reading the table gives nobody a usable token. Each refresh swaps the secret for
 * a new one (rotation). If an OLD secret turns up later, someone is replaying a stolen token, so
 * the session is ended for everyone holding it.
 *
 * Two tabs refreshing together look like that too: the loser shows the secret that was replaced
 * a moment ago. So for 30 seconds an old secret just gets `refresh_superseded`, and that tab asks
 * again.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const REUSE_GRACE_MS = 30_000;
const TICKET_MS = 2 * MINUTE;

const LIFETIMES = Object.freeze({
  patient: { idle: 7 * DAY, absolute: 30 * DAY },
  staff: { idle: 12 * HOUR, absolute: 7 * DAY },
  owner: { idle: 12 * HOUR, absolute: 7 * DAY },
  viewer: { idle: 2 * HOUR, absolute: DAY },
});

/**
 * Which accounts each way of signing in may open. This is where the rule lives that nothing
 * without a password can reach a team account, whatever path led here.
 */
const METHOD_ROLES = Object.freeze({
  password: ['owner', 'staff', 'viewer'],
  email_code: ['patient'],
  phone: ['patient'],
  personal_code: ['patient'],
  sign_up: ['patient'],
  booking: ['patient'],
  demo: ['viewer'],
});

const ended = () => AppError.unauthorized('invalid_refresh_token', 'Your session has ended. Please sign in again.');
const superseded = () => AppError.unauthorized('refresh_superseded', 'Please try again.');
const outdated = () => AppError.unauthorized('invalid_token', 'Your session has expired. Please sign in again.');

/**
 * Starts a session for someone already proven. `ticket: true` is for the chat, which can't set a
 * cookie: the token must then be swapped within 2 minutes (see POST /api/auth/ticket).
 * Returns the refresh token, once, and how long its cookie should last.
 */
export async function issue({ profile, method, ticket = false, client = {} }) {
  if (!METHOD_ROLES[method]?.includes(profile.role)) {
    logger.warn(`Refused a ${method} session for a ${profile.role} account.`);
    throw AppError.forbidden('login_unavailable', 'Online sign-in is not available for this record. Please call the clinic.');
  }

  const id = crypto.randomUUID();
  const secret = randomToken();
  const now = Date.now();
  const lifetime = LIFETIMES[profile.role];
  await sessionModel.insert(requireAdmin(), {
    id,
    profile_id: profile.id,
    refresh_hash: sha256Hex(secret),
    method,
    expires_at: new Date(now + lifetime.absolute).toISOString(),
    redeem_by: ticket ? new Date(now + TICKET_MS).toISOString() : null,
    user_agent: client.userAgent?.slice(0, 300) ?? null,
    ip: client.ip ?? null,
  });
  return { sessionId: id, refreshToken: `${id}.${secret}`, maxAgeMs: lifetime.absolute };
}

function parse(token) {
  const dot = String(token ?? '').indexOf('.');
  const id = String(token ?? '').slice(0, dot);
  const secret = String(token ?? '').slice(dot + 1);
  return dot > 0 && secret && /^[0-9a-f-]{36}$/i.test(id) ? { id, secret } : null;
}

/** Trades a refresh token for a new one. Returns { sessionId, profile, refreshToken, maxAgeMs }. */
export async function rotate(token) {
  const parsed = parse(token);
  if (!parsed) throw ended();

  const db = requireAdmin();
  const session = await sessionModel.findById(db, parsed.id);
  if (!session || session.revoked_at) throw ended();

  const now = Date.now();
  const fingerprint = sha256Hex(parsed.secret);

  if (session.previous_hash && safeEqual(fingerprint, session.previous_hash)) {
    if (now - new Date(session.rotated_at).getTime() <= REUSE_GRACE_MS) throw superseded();
    await sessionModel.revoke(db, session.id, 'refresh_reuse');
    logger.warn(`A replaced refresh token was used again; session ${session.id} ended.`);
    throw ended();
  }
  // An unknown secret ends nothing: knowing a session id alone must not let anyone sign someone out.
  if (!safeEqual(fingerprint, session.refresh_hash)) throw ended();

  const endsAt = new Date(session.expires_at).getTime();
  const expired = now > endsAt || (session.redeem_by && now > new Date(session.redeem_by).getTime());
  if (expired || now - new Date(session.last_used_at).getTime() > LIFETIMES[session.profile.role].idle) {
    await sessionModel.revoke(db, session.id, 'expired');
    throw ended();
  }

  const secret = randomToken();
  const swapped = await sessionModel.rotate(db, session, sha256Hex(secret), new Date(now).toISOString());
  if (!swapped) throw superseded();

  return { sessionId: session.id, profile: session.profile, refreshToken: `${session.id}.${secret}`, maxAgeMs: endsAt - now };
}

/** Ends the session a refresh token belongs to (sign-out with only the cookie). */
export async function revokeByToken(token) {
  const parsed = parse(token);
  if (!parsed) return;
  const db = requireAdmin();
  const session = await sessionModel.findById(db, parsed.id);
  const fingerprint = sha256Hex(parsed.secret);
  if (session && [session.refresh_hash, session.previous_hash].some((hash) => hash && safeEqual(fingerprint, hash))) {
    await sessionModel.revoke(db, session.id, 'sign_out');
  }
}

export const revoke = (sessionId, reason) => sessionModel.revoke(requireAdmin(), sessionId, reason);

export const revokeAllFor = (profileId, reason, options) => sessionModel.revokeAllFor(requireAdmin(), profileId, reason, options);

const first = (value) => (Array.isArray(value) ? value[0] : value) ?? null;

/**
 * The per-request check. The signature proves we issued the token; this proves the session still
 * stands, so signing out, disabling an account or changing a role works from the very next
 * request instead of when the token runs out. The role always comes from the database.
 */
export async function identityFor({ sub, sid, role }) {
  const session = await sessionModel.findWithIdentity(requireAdmin(), sid);
  const profile = session?.profile;
  if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) throw outdated();
  if (!profile || profile.id !== sub || profile.role !== role) throw outdated();
  if (profile.disabled_at) throw AppError.forbidden('account_disabled', 'This account has been disabled.');

  const patient = first(profile.patients);
  return {
    id: profile.id,
    role: profile.role,
    sessionId: session.id,
    email: patient?.email ?? profile.email,
    fullName: patient?.full_name ?? profile.full_name,
    preferredLanguage: patient?.preferred_language ?? profile.preferred_language,
    patientId: patient?.id ?? null,
    staffId: first(profile.staff)?.id ?? null,
    mustChangePassword: profile.must_change_password,
  };
}
