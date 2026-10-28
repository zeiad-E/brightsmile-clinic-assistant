/**
 * The languages the site speaks. Safe to import anywhere (server, browser, proxy).
 *
 * Every URL starts with one of these: /en/services, /ar/services.
 */
export const locales = ['en', 'ar'];
export const defaultLocale = 'en';

/** Name of the cookie that remembers the visitor's last language choice. */
export const LOCALE_COOKIE = 'lang';

export const hasLocale = (value) => locales.includes(value);

/** Arabic is written right-to-left; the whole layout flips with it. */
export const dirOf = (locale) => (locale === 'ar' ? 'rtl' : 'ltr');

/** The other language, for the language switch. */
export const otherLocale = (locale) => (locale === 'ar' ? 'en' : 'ar');

/** Builds a link inside the current language: localePath('ar', '/services') → '/ar/services'. */
export const localePath = (locale, path = '/') => `/${locale}${path === '/' ? '' : path}`;

/** Locale tag for dates, times and numbers (ar-EG writes Arabic digits, as Egyptian patients expect). */
export const intlLocale = (locale) => (locale === 'ar' ? 'ar-EG' : 'en-GB');
