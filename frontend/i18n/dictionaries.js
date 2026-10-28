import { lang } from 'next/root-params';
import { notFound } from 'next/navigation';
import { hasLocale } from './config.js';

/**
 * Loads the words for the current language. Server-only: `next/root-params` refuses to load in
 * the browser, so the dictionaries never end up in the JavaScript sent to visitors.
 *
 * `lang()` reads the [lang] part of the URL, so callers don't have to pass it around.
 */
const dictionaries = {
  en: () => import('./en.json').then((module) => module.default),
  ar: () => import('./ar.json').then((module) => module.default),
};

export async function getLocale() {
  const locale = await lang();
  if (!hasLocale(locale)) notFound();
  return locale;
}

export async function getDictionary() {
  return dictionaries[await getLocale()]();
}
