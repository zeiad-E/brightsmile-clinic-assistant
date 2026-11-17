import { SITE_URL } from '@/lib/seo';

/**
 * /robots.txt — the note search-engine crawlers read before anything else: crawl the website, but
 * stay out of the API and the private areas (staff dashboards, owner pages, patient accounts), in
 * both languages ("*" stands for /en or /ar). Also says where the sitemap is.
 */
export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/owner', '/account', '/*/dashboard', '/*/owner', '/*/account'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
