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

// Longer text for each treatment page ("About this treatment" + common questions), by slug.
// Kept in its own files (i18n/services/) so other pages never load it.
const serviceContent = {
  en: () => import('./services/en.json').then((module) => module.default),
  ar: () => import('./services/ar.json').then((module) => module.default),
};

/** { intro: [paragraph, …], faq: [{ q, a }, …] } for one service, or null if none is written yet. */
export async function getServiceContent(slug) {
  const all = await serviceContent[await getLocale()]();
  return all[slug] ?? null;
}

// The team dashboards have their own (long) word lists, so the public pages never carry them.
const dashDictionaries = {
  en: () => import('./dash/en.json').then((module) => module.default),
  ar: () => import('./dash/ar.json').then((module) => module.default),
};

export async function getDashDictionary() {
  return dashDictionaries[await getLocale()]();
}
