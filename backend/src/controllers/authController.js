import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../auth/cookies.js';
import * as sessions from '../auth/sessions.js';
import { clearVisitor, readVisitor, visitorHash } from '../auth/visitorCookie.js';
import * as chatService from '../services/chatService.js';
import { logger } from '../utils/logger.js';
import { signAccessToken } from '../auth/tokens.js';
import * as authService from '../services/authService.js';
import * as registrationService from '../services/registrationService.js';
import { sessionView } from '../views/sessionView.js';
import { ctxOf } from './context.js';

/** Sign-in and account endpoints (/api/auth). Each handler: read req.valid → one service call → JSON. */

/** Who is making this attempt, for the failed-try limits. The agent evals skip those limits. */
export const visitorOf = (req) => (req.evalCase ? null : req.clientIp);

async function accessSession(sessionId, profile) {
  return sessionView(await signAccessToken({ sub: profile.id, sid: sessionId, role: profile.role }), profile);
}

/**
 * A patient just signed in on this browser: the chats it had as a guest (visitor cookie) move
 * into their account, and the cookie is cleared, so whoever uses this browser after they sign
 * out starts a fresh chat. A failure here never blocks the sign-in; the cookie then stays and the
 * next sign-in tries again.
 */
async function takeGuestChats(req, res, profile) {
  const secret = readVisitor(req);
  if (!secret || profile?.role !== 'patient') return;
  try {
    await chatService.claimVisitorChats({ visitorHash: visitorHash(secret), profileId: profile.id });
    clearVisitor(res);
  } catch (err) {
    logger.warn(`Guest chats not moved to the account: ${err.message}`);
  }
}

/** Someone was proven: start their session, put the refresh token in its cookie, answer with access. */
export async function startSession(req, res, { profile, method }) {
  const session = await sessions.issue({ profile, method, client: { ip: req.clientIp, userAgent: req.get('user-agent') } });
  setRefreshCookie(res, session.refreshToken, session.maxAgeMs);
  await takeGuestChats(req, res, profile);
  return accessSession(session.sessionId, profile);
}

async function signedIn(req, res, verified) {
  res.json(await startSession(req, res, await verified));
}

export const staffLogin = (req, res) => signedIn(req, res, authService.staffLogin(req.valid.body));
export const demo = (req, res) => signedIn(req, res, authService.demoLogin());
export const emailVerify = (req, res) => signedIn(req, res, authService.verifyEmailCode(req.valid.body));
export const phone = (req, res) => signedIn(req, res, authService.phoneLogin(req.valid.body, { visitor: visitorOf(req) }));
export const code = (req, res) => signedIn(req, res, authService.codeLogin(req.valid.body, { visitor: visitorOf(req) }));

export async function registerStart(req, res) {
  res.json(await registrationService.startRegistration(req.valid.body));
}

/** A new account's personal code is shown once here, and it stays in their profile. */
export async function registerVerify(req, res) {
  const { personalCode, ...verified } = await registrationService.finishRegistration(req.valid.body, { visitor: visitorOf(req) });
  res.json({ ...(await startSession(req, res, verified)), personal_code: personalCode });
}

export async function emailStart(req, res) {
  res.json(await authService.startEmailCode(req.valid.body));
}

export async function codeResend(req, res) {
  res.json(await authService.resendCode(req.valid.body));
}

async function rotated(res, token, onSession) {
  try {
    const session = await sessions.rotate(token);
    setRefreshCookie(res, session.refreshToken, session.maxAgeMs);
    await onSession?.(session.profile);
    res.json(await accessSession(session.sessionId, session.profile));
  } catch (err) {
    // Lost a race with another tab: that tab's new cookie is the good one, so leave it alone.
    if (err.code !== 'refresh_superseded') clearRefreshCookie(res);
    throw err;
  }
}

export const refresh = (req, res) => rotated(res, readRefreshCookie(req));

/**
 * The chat signed someone in: swap its one-time ticket for the cookie it couldn't set itself.
 * The chat they were in is already theirs; any other guest chats from this browser follow.
 */
export const ticket = (req, res) => rotated(res, req.valid.body.ticket, (profile) => takeGuestChats(req, res, profile));

export async function logout(req, res) {
  await sessions.revokeByToken(readRefreshCookie(req));
  if (req.user) await sessions.revoke(req.user.sessionId, 'sign_out');
  clearRefreshCookie(res);
  clearVisitor(res);
  res.status(204).end();
}

export async function me(req, res) {
  res.json(await authService.me(ctxOf(req)));
}

export async function changePassword(req, res) {
  res.json(await authService.changePassword(ctxOf(req), req.valid.body));
}

export async function profile(req, res) {
  res.json(await authService.teamProfile(ctxOf(req)));
}

export async function updateProfile(req, res) {
  res.json(await authService.updateTeamProfile(ctxOf(req), req.valid.body));
}
