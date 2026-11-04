import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, defaultLocale, hasLocale } from './i18n/config.js';

/**
 * Runs before every request. It does two jobs:
 *
 * 1. Pages: if the URL has no language yet (/ or /services), it sends the visitor to the same page
 *    in their language (/en, /ar/services). Language choice, in order: the cookie set by the
 *    language switch → the browser's language list (Accept-Language header) → English.
 * 2. /api calls: these travel on to the backend (see the rewrite in next.config.mjs), which would
 *    only see this server's address. So we tell it the visitor's, proved by a shared secret.
 */
export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/api/')) return forwardVisitorAddress(request);
  if (hasLocale(pathname.split('/')[1])) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${pickLocale(request)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

/** Sign-in limits count per visitor, so the backend needs to know who is really calling. */
function forwardVisitorAddress(request) {
  const headers = new Headers(request.headers);
  // Whatever the browser sent under these names is dropped: only this code may set them.
  headers.delete('x-bs-client-ip');
  headers.delete('x-bs-proxy-key');

  const secret = process.env.PROXY_SHARED_SECRET;
  const ip = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  if (secret && ip) {
    headers.set('x-bs-client-ip', ip);
    headers.set('x-bs-proxy-key', secret);
  }
  return NextResponse.next({ request: { headers } });
}

function pickLocale(request) {
  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  if (hasLocale(saved)) return saved;

  // "ar-EG,ar;q=0.9,en;q=0.8" → [{ code: 'ar', q: 1 }, { code: 'ar', q: 0.9 }, { code: 'en', q: 0.8 }]
  const ranked = (request.headers.get('accept-language') ?? '')
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { code: tag.slice(0, 2).toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return ranked.find((entry) => hasLocale(entry.code))?.code ?? defaultLocale;
}

export const config = {
  // Pages (skips Next's own files in /_next and anything with a file extension, like favicon.ico), plus /api.
  matcher: ['/api/:path*', '/((?!_next|api|.*\\..*).*)'],
};
