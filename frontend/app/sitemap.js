import { locales } from '@/i18n/config';
import { getServices } from '@/lib/api/public';
import { SITE_URL, languageLinks } from '@/lib/seo';

/**
 * /sitemap.xml — the list of public pages we want in search results, in both languages, each with
 * its other-language twin (hreflang), so Google pairs /en/about with /ar/about.
 * Sign-in, account and team pages are left out on purpose. Service pages come from the live
 * (cached) service list, so a new treatment appears here without touching this file.
 */

const PAGES = ['', '/services', '/about', '/assistant', '/book', '/privacy'];

export default async function sitemap() {
  const services = await getServices();
  const paths = [...PAGES, ...services.map((service) => `/services/${service.slug}`)];

  return paths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${SITE_URL}/${locale}${path}`,
      changeFrequency: path === '' || path.startsWith('/services') ? 'weekly' : 'monthly',
      priority: path === '' ? 1 : path.startsWith('/services') ? 0.8 : 0.6,
      alternates: { languages: languageLinks(path, SITE_URL) },
    })),
  );
}
