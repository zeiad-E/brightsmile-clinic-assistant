import { parse } from 'cookie';
import { config } from '../config/index.js';

/**
 * The refresh token's cookie.
 *
 *  - HttpOnly: JavaScript can't read it, so a script injected into a page can't steal it.
 *  - SameSite=Strict: the browser won't attach it to requests started by another website.
 *  - Path=/api/auth: it only travels to the sign-in routes, not with every request.
 *  - No Domain: it stays on the exact site that set it.
 *  - Secure (in production): sent over HTTPS only.
 */
const NAME = 'bs_rt';

const attributes = () => ({ httpOnly: true, sameSite: 'strict', secure: config.auth.cookieSecure, path: '/api/auth' });

export function setRefreshCookie(res, token, maxAgeMs) {
  res.cookie(NAME, token, { ...attributes(), maxAge: maxAgeMs });
}

export function clearRefreshCookie(res) {
  res.clearCookie(NAME, attributes());
}

export function readRefreshCookie(req) {
  const header = req.get('cookie');
  return header ? (parse(header)[NAME] ?? null) : null;
}
