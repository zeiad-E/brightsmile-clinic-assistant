import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import { getDoctors, getServices } from '@/lib/api/public';
import { formatPrice, shortName } from '@/lib/format';
import ServiceGrid from '@/components/services/ServiceGrid';
import styles from '@/components/services/Services.module.css';

/**
 * /en/services · /ar/services — every treatment with its price, duration and who does it.
 * A server component: the live services and doctors are loaded (and cached) on the server; only the
 * filter + card animations run in the browser (ServiceGrid).
 */

export async function generateMetadata() {
  const { servicesPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
}

export default async function ServicesPage() {
  const locale = await getLocale();
  const { servicesPage: t } = await getDictionary();
  const [services, doctors] = await Promise.all([getServices(), getDoctors()]);
  const digits = locale === 'ar' ? 'ar-EG' : 'en-US';

  const cards = services.map((service) => {
    const team = doctors.filter((d) => d.service_ids.includes(service.id));
    const names = team.map((d) => d[`full_name_${locale}`]);
    return {
      slug: service.slug,
      name: service[`name_${locale}`],
      description: service[`description_${locale}`],
      minutes: service.duration_minutes.toLocaleString(digits),
      price: formatPrice(service.price_egp, locale),
      people: team.map((d) => d.id),
      who: names.length === 1 ? names[0] : names.map(shortName).join(' · '),
    };
  });
  // the filter chips: only people who actually do at least one service
  const people = doctors
    .filter((d) => d.service_ids.length > 0)
    .map((d) => ({ id: d.id, name: shortName(d[`full_name_${locale}`]) }));

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div className={styles.blobs} aria-hidden="true">
          <i />
          <i />
        </div>
        <div className={`wrap ${styles.introInner}`}>
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">
            {t.headline}
            <span>{t.headlineAccent}</span>
          </h1>
          <p className={`${styles.lead} fade-up [animation-delay:260ms]`}>{t.lead}</p>
        </div>
      </section>

      <div className="wrap">
        <ServiceGrid
          cards={cards}
          people={people}
          t={t}
          servicesBase={localePath(locale, '/services')}
          bookBase={localePath(locale, '/book')}
          assistantBase={localePath(locale, '/assistant')}
        />

        <section className={styles.cta}>
          <div>
            <h2>{t.ctaTitle}</h2>
            <p>{t.ctaText}</p>
          </div>
          <Link className={styles.ctaButton} href={localePath(locale, '/assistant')}>
            {t.ctaButton} <span className="flip-rtl" aria-hidden="true">→</span>
          </Link>
        </section>
      </div>
    </div>
  );
}
