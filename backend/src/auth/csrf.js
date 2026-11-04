import { config } from '../config/index.js';
import { AppError } from '../utils/AppError.js';

/**
 * Guards the routes that act on the refresh cookie.
 *
 * Browsers attach cookies by themselves, so without a guard another website could quietly make a
 * visitor's browser call us (cross-site request forgery). Normal API routes are safe because they
 * need the access token, which a browser never attaches on its own. For the cookie routes:
 *
 *  - our own header is required: a plain cross-site form can't send it, and a cross-site script
 *    needs the server's permission first, which it never gets;
 *  - if the browser says where the request came from (Origin), it must be our own site.
 *
 * SameSite=Strict on the cookie is the third lock.
 */
const CLIENT_HEADER = 'x-brightsmile-client';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function isOurSite(origin, req) {
  const host = hostOf(origin);
  if (!host) return false;
  // Through the site's /api rewrite the forwarded host is the address the browser is on, which
  // also covers temporary addresses such as a tunnel.
  return [hostOf(config.appUrl), hostOf(config.corsOrigin), req.get('x-forwarded-host')].includes(host);
}

export function csrfGuard() {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (req.get(CLIENT_HEADER) !== 'web' || (origin && !isOurSite(origin, req))) {
      throw AppError.forbidden('request_blocked', 'This request was blocked. Please reload the page and try again.');
    }
    return next();
  };
}
