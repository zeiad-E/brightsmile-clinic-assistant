import Link from 'next/link';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import { ViewTransition } from 'react';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import { getDoctors, getFreeTimes, getServices } from '@/lib/api/public';
import { describeSlot, formatPrice, shortName } from '@/lib/format';
import { FallbackServiceIcon, SERVICE_ICONS } from '@/components/home/icons';
import StepsTimeline from '@/components/services/StepsTimeline';
import styles from '@/components/services/ServiceDetail.module.css';

/**
 * /en/services/teeth-cleaning · /ar/services/teeth-cleaning — one treatment in detail.
 * The [slug] folder is a "dynamic segment": one page file serves every service; Next.js hands us
 * the slug from the URL in `params`. The data comes from the same cached service list as /services.
 */

// Build every service's page ahead of time (in both languages, because [lang] does the same).
// With Cache Components the list may not be empty, so if the API is down at build time we fall
// back to one known slug; the other pages are then built on their first visit.
export async function generateStaticParams() {
  const slugs = (await getServices()).map((service) => ({ slug: service.slug }));
  return slugs.length ? slugs : [{ slug: 'check-up' }];
}

async function findService(params) {
  const { slug } = await params;
  return (await getServices()).find((service) => service.slug === slug);
}

export async function generateMetadata({ params }) {
  const [service, locale] = await Promise.all([findService(params), getLocale()]);
  if (!service) return {};
  return { title: service[`name_${locale}`], description: service[`description_${locale}`] };
}

export default async function ServicePage({ params }) {
  const locale = await getLocale();
  const service = await findService(params);
  if (!service) notFound(); // a wrong slug shows the 404 page

  const { servicePage: t, servicesPage, home } = await getDictionary();
  const [services, doctors] = await Promise.all([getServices(), getDoctors()]);
  const name = (record, field) => record[`${field}_${locale}`];
  const digits = locale === 'ar' ? 'ar-EG' : 'en-US';

  const Icon = SERVICE_ICONS[service.slug] ?? FallbackServiceIcon;
  const steps = (name(service, 'details') ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text, i) => ({ number: (i + 1).toLocaleString(digits), text }));
  const team = doctors.filter((d) => d.service_ids.includes(service.id));

  const bookBase = `${localePath(locale, '/book')}?service=${service.slug}`;
  const times = await freeTimeLinks(locale, service, doctors, bookBase, home.bookSlot);
  const askHref = `${localePath(locale, '/assistant')}?q=${encodeURIComponent(servicesPage.askPrompt.replace('{service}', name(service, 'name')))}`;

  // three other treatments, continuing from this one in the clinic's order
  const at = services.indexOf(service);
  const others = [1, 2, 3].map((step) => services[(at + step) % services.length]).filter((s) => s !== service);

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div className={styles.blobs} aria-hidden="true">
          <i />
          <i />
        </div>
        <div className={`wrap ${styles.introInner}`}>
          <Link href={localePath(locale, '/services')} className={`${styles.back} fade-up`}>
            <span className="flip-rtl" aria-hidden="true">←</span> {t.back}
          </Link>
          <div className={`${styles.icon} fade-up [animation-delay:80ms]`}>
            <Icon />
          </div>
          <p className="eyebrow fade-up [animation-delay:120ms]">{t.eyebrow}</p>
          {/* Same name as the card title on /services: the browser morphs one into the other. */}
          <ViewTransition name={`service-${service.slug}`} share="morph" default="none">
            <h1>{name(service, 'name')}</h1>
          </ViewTransition>
          <p className={`${styles.lead} fade-up [animation-delay:260ms]`}>{name(service, 'description')}</p>
          <div className={`${styles.facts} fade-up [animation-delay:340ms]`}>
            <span>{t.minutes.replace('{n}', service.duration_minutes.toLocaleString(digits))}</span>
            <span className={styles.factPrice}>{formatPrice(service.price_egp, locale)}</span>
          </div>
        </div>
      </section>

      <div className={`wrap ${styles.layout}`}>
        <div className={styles.main}>
          {steps.length > 0 && (
            <section>
              <h2>{t.expectTitle}</h2>
              <StepsTimeline steps={steps} />
            </section>
          )}

          {team.length > 0 && (
            <section>
              <h2>{t.teamTitle}</h2>
              <div className={styles.team}>
                {team.map((doctor) => (
                  <article key={doctor.id} className={styles.doctor}>
                    <span className={styles.avatar} aria-hidden="true">
                      {initials(name(doctor, 'full_name'))}
                    </span>
                    <div>
                      <h3>{name(doctor, 'full_name')}</h3>
                      <p className={styles.role}>{t[doctor.title] ?? doctor.title}</p>
                      {name(doctor, 'bio') && <p className={styles.bio}>{name(doctor, 'bio')}</p>}
                      <Link className={styles.bookWith} href={`${bookBase}&doctor=${doctor.id}`}>
                        {t.bookWith.replace('{name}', shortName(name(doctor, 'full_name')))}{' '}
                        <span className="flip-rtl" aria-hidden="true">→</span>
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className={styles.card}>
          <h2>{t.timesTitle}</h2>
          {times.length > 0 ? (
            <>
              <p className={styles.note}>{t.timesNote}</p>
              <ul className={styles.times}>
                {times.map((time) => (
                  <li key={time.href}>
                    <Link href={time.href} className={styles.time}>
                      <span>{time.when}</span>
                      <small>{time.doctor}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.note}>{t.noTimes}</p>
          )}
          <div className={styles.cardActions}>
            <Link href={bookBase} className={styles.book}>
              {t.book}
            </Link>
            <Link href={askHref} className={styles.ask}>
              {t.ask}
            </Link>
          </div>
        </aside>
      </div>

      {others.length > 0 && (
        <section className={`wrap ${styles.more}`}>
          <h2>{t.moreTitle}</h2>
          <div className={styles.moreGrid}>
            {others.map((other) => {
              const OtherIcon = SERVICE_ICONS[other.slug] ?? FallbackServiceIcon;
              return (
                <Link key={other.slug} href={localePath(locale, `/services/${other.slug}`)} className={styles.moreCard}>
                  <span className={styles.moreIcon}>
                    <OtherIcon />
                  </span>
                  <span className={styles.moreName}>{name(other, 'name')}</span>
                  <span className={styles.morePrice}>{formatPrice(other.price_egp, locale)}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The next free times as ready-to-show links. Like the home page's booking card, this reads the clock
 * (describeSlot knows "today"), so Next.js must not freeze it into the page forever:
 * 'use cache' + cacheLife('minutes') lets it be rebuilt about once a minute.
 */
async function freeTimeLinks(locale, service, doctors, bookBase, words) {
  'use cache';
  cacheLife('minutes');
  const times = await getFreeTimes(service.id);
  return times.map((slot) => {
    const doctor = doctors.find((d) => d.id === slot.staff_id);
    return {
      when: describeSlot(slot.starts_at, locale, words).long,
      doctor: doctor ? shortName(doctor[`full_name_${locale}`]) : '',
      href: `${bookBase}&doctor=${slot.staff_id}&start=${encodeURIComponent(slot.starts_at)}`,
    };
  });
}

/** "Dr. Sarah Mansour" → "SM", "نادية فوزي" → "نف" (the title "Dr." / "د." is skipped). */
function initials(fullName) {
  const words = fullName.split(' ').filter((word) => !/^(Dr\.|د\.)$/.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}
