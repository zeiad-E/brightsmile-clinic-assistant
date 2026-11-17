import { locales } from '@/i18n/config';

/**
 * Search-engine helpers shared by the public pages: the site's own address, the <head> tags every
 * page needs (canonical, hreflang, Open Graph, Twitter), and the JSON-LD that describes the clinic.
 */

/** The live address. Search engines and share previews need full URLs, not "/en/about". */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://brightsmile-sooty.vercel.app').replace(/\/$/, '');

/** Open Graph wants locales as language_TERRITORY. */
const OG_LOCALE = { en: 'en_US', ar: 'ar_EG' };

/**
 * The picture shown when a link is shared (made from assets-src/icons/share-image.html).
 * Named here, not as an app/opengraph-image file: a page that sets its own openGraph replaces the
 * whole openGraph object, and the file's picture would be dropped with it.
 */
const SHARE_IMAGE = { url: '/og-image.png', width: 1200, height: 630, type: 'image/png' };
const SHARE_ALT = {
  en: 'BrightSmile Dental Clinic in Heliopolis, Cairo: the mint tooth logo and the clinic name',
  ar: 'عيادة برايت سمايل لطب الأسنان في مصر الجديدة، القاهرة: شعار السن واسم العيادة',
};
export const SHARE_IMAGE_URL = `${SITE_URL}${SHARE_IMAGE.url}`;

/**
 * One path in every language, for hreflang: { en: '/en/about', ar: '/ar/about', 'x-default': '/en/about' }.
 * x-default is the page for people whose language is neither (English here).
 */
export function languageLinks(path = '', base = '') {
  const links = Object.fromEntries(locales.map((locale) => [locale, `${base}/${locale}${path}`]));
  links['x-default'] = `${base}/en${path}`;
  return links;
}

/**
 * The metadata of one public page. `path` is the part after the language ('' for home, '/about').
 * `title` goes through the layout's "%s · BrightSmile" template unless `absolute` is set.
 */
export function pageMetadata({ locale, path = '', title, description, siteName, brand, absolute = false, noindex = false }) {
  const shareTitle = absolute ? title : `${title} · ${brand}`;
  const images = [{ ...SHARE_IMAGE, alt: SHARE_ALT[locale] }];
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: `/${locale}${path}`, languages: languageLinks(path) },
    openGraph: {
      type: 'website',
      url: `/${locale}${path}`,
      siteName,
      title: shareTitle,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: locales.filter((other) => other !== locale).map((other) => OG_LOCALE[other]),
      images,
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description, images },
    ...(noindex && { robots: { index: false, follow: true } }),
  };
}

/** Puts structured data in the page. "<" is escaped so text from the API can never close the tag. */
export function JsonLd({ data }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

/** The same id on every page, so Google knows all the pages talk about one clinic. */
export const CLINIC_ID = `${SITE_URL}/#clinic`;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The clinic as a schema.org Dentist (a kind of LocalBusiness): name, address, phone, opening hours
 * and price list, all from the live clinic API, so it always matches what the page shows.
 */
export function clinicSchema({ clinic, services, locale, point }) {
  if (!clinic) return null;
  const other = locale === 'ar' ? 'en' : 'ar';
  // "21 Al Horreya Avenue, 3rd floor, Heliopolis, Cairo" → street, area, city (Arabic uses "،")
  const parts = clinic[`address_${locale}`].split(/[,،]/).map((part) => part.trim());
  const prices = services.map((service) => service.price_egp);

  // Days with the same hours share one entry: { dayOfWeek: ['Sunday', 'Monday'], opens, closes }
  const hours = new Map();
  for (const day of clinic.opening_hours ?? []) {
    const key = `${day.opens}-${day.closes}`;
    if (!hours.has(key)) hours.set(key, { '@type': 'OpeningHoursSpecification', dayOfWeek: [], opens: day.opens, closes: day.closes });
    hours.get(key).dayOfWeek.push(DAY_NAMES[day.weekday]);
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Dentist',
    '@id': CLINIC_ID,
    name: clinic[`name_${locale}`],
    alternateName: clinic[`name_${other}`],
    url: `${SITE_URL}/${locale}`,
    logo: `${SITE_URL}/apple-icon.png`,
    image: SHARE_IMAGE_URL,
    telephone: clinic.phone.replace(/\s/g, ''),
    email: clinic.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: parts.slice(0, -2).join(locale === 'ar' ? '، ' : ', '),
      addressLocality: parts.at(-2),
      addressRegion: parts.at(-1),
      addressCountry: 'EG',
    },
    ...(point && {
      geo: { '@type': 'GeoCoordinates', latitude: point.lat, longitude: point.lon },
      hasMap: `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=17/${point.lat}/${point.lon}`,
    }),
    openingHoursSpecification: [...hours.values()],
    medicalSpecialty: 'https://schema.org/Dentistry',
    availableLanguage: ['English', 'Arabic'],
    currenciesAccepted: clinic.currency ?? 'EGP',
    ...(prices.length && { priceRange: `${Math.min(...prices)}–${Math.max(...prices)} EGP` }),
    ...(services.length && {
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: locale === 'ar' ? 'الخدمات والأسعار' : 'Services & prices',
        itemListElement: services.map((service) => ({
          '@type': 'Offer',
          price: service.price_egp,
          priceCurrency: 'EGP',
          itemOffered: { '@type': 'Service', name: service[`name_${locale}`], url: `${SITE_URL}/${locale}/services/${service.slug}` },
        })),
      },
    }),
  };
}

/** "Home › Services › Teeth cleaning" for search results. `trail` = [{ name, path }, …]. */
export function breadcrumbSchema(locale, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: `${SITE_URL}/${locale}${step.path}`,
    })),
  };
}
