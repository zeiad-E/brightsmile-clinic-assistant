import { NextResponse } from 'next/server';
import { LOCALE_COOKIE, defaultLocale, hasLocale } from './i18n/config.js';

/**
 * Runs before every page request. If the URL has no language yet (/ or /services), it sends the
 * visitor to the same page in their language (/en, /ar/services).
 *
 * Language choice, in order: the cookie set by the language switch → the browser's language
 * list (Accept-Language header) → English.
 */
export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (hasLocale(pathname.split('/')[1])) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${pickLocale(request)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
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
  // Skip Next's own files (/_next), API routes and anything with a file extension (favicon.ico, images).
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
