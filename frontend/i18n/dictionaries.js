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

/**
 * The assistant's words in BOTH languages, for the chat's cards: a card follows the language of the
 * chat, not of the page (an Arabic chat on the English page still gets Arabic free times and forms).
 */
export async function getChatWords() {
  const [en, ar] = await Promise.all([dictionaries.en(), dictionaries.ar()]);
  return { en: en.assistantPage, ar: ar.assistantPage };
}

// The team dashboards have their own (long) word lists, so the public pages never carry them.
const dashDictionaries = {
  en: () => import('./dash/en.json').then((module) => module.default),
  ar: () => import('./dash/ar.json').then((module) => module.default),
};

export async function getDashDictionary() {
  return dashDictionaries[await getLocale()]();
}
