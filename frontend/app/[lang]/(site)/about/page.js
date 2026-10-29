import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import { getClinic, getDoctors, getMapPoint, getServices } from '@/lib/api/public';
import { shortName } from '@/lib/format';
import Scribble from '@/components/fx/Scribble';
import Marquee from '@/components/fx/Marquee';
import Magnetic from '@/components/fx/Magnetic';
import GlassCard from '@/components/fx/GlassCard';
import VisitHours from '@/components/about/VisitHours';
import styles from '@/components/about/About.module.css';

/**
 * /en/about · /ar/about — the clinic's story, promises, team and how to find it.
 * A server component; the moving parts (scribble, marquee, magnetic button, glass card, live
 * "Open now" badge) are small client components from components/fx and components/about.
 */

export async function generateMetadata() {
  const { aboutPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
}

export default async function AboutPage() {
  const locale = await getLocale();
  const { aboutPage: t } = await getDictionary();
  const [clinic, doctors, services] = await Promise.all([getClinic(), getDoctors(), getServices()]);
  const name = (record, field) => record[`${field}_${locale}`];
  const digits = (n) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US');
  const point = await getMapPoint(clinic?.address_en);

  const team = doctors.filter((d) => d.service_ids.length > 0);
  const stats = [
    { value: digits(team.length), label: t.statDoctors },
    { value: digits(services.length), label: t.statServices },
    { value: digits(2), label: t.statLanguages },
    { value: '24/7', label: t.statAssistant },
  ];
  const mapLink = point
    ? `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=17/${point.lat}/${point.lon}`
    : `https://www.openstreetmap.org/search?query=${encodeURIComponent(clinic?.address_en ?? '')}`;

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
            {t.headA} <Scribble delay={0.9}>{t.headMark}</Scribble>
          </h1>
          <p className={`${styles.lead} fade-up [animation-delay:260ms]`}>{t.lead}</p>
        </div>
      </section>

      <section className={`wrap ${styles.story}`}>
        <div>
          <h2>{t.storyTitle}</h2>
          {t.story.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <dl className={styles.stats}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Marquee lines={t.marquee} />

      <section className={`wrap ${styles.section}`}>
        <h2>{t.valuesTitle}</h2>
        <ol className={styles.values}>
          {t.values.map((value, i) => (
            <li key={value.title}>
              <span className={styles.valueNumber}>{digits(i + 1).padStart(2, digits(0))}</span>
              <h3>{value.title}</h3>
              <p>{value.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {team.length > 0 && (
        <section className={`wrap ${styles.section}`}>
          <h2>{t.teamTitle}</h2>
          <p className={styles.sectionLead}>{t.teamLead}</p>
          <div className={styles.team}>
            {team.map((doctor) => (
              <article key={doctor.id} className={styles.member}>
                <span className={styles.avatar} aria-hidden="true">
                  {initials(name(doctor, 'full_name'))}
                </span>
                <h3>{name(doctor, 'full_name')}</h3>
                <p className={styles.role}>{t[doctor.title] ?? doctor.title}</p>
                {name(doctor, 'bio') && <p className={styles.bio}>{name(doctor, 'bio')}</p>}
                <p className={styles.visitLabel}>{t.does}</p>
                <ul className={styles.chips}>
                  {services
                    .filter((service) => doctor.service_ids.includes(service.id))
                    .map((service) => (
                      <li key={service.id}>
                        <Link href={localePath(locale, `/services/${service.slug}`)}>{name(service, 'name')}</Link>
                      </li>
                    ))}
                </ul>
                <Link className={styles.bookWith} href={`${localePath(locale, '/book')}?doctor=${doctor.id}`}>
                  {t.bookWith.replace('{name}', shortName(name(doctor, 'full_name')))} <span className="flip-rtl" aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}

      <section id="visit" className={`wrap ${styles.section}`}>
        <h2>{t.visitTitle}</h2>
        <div className={styles.visit}>
          <GlassCard className={styles.visitCard}>
            {clinic && (
              <>
                <VisitHours openingHours={clinic.opening_hours} locale={locale} t={t} />
                <dl className={styles.contact}>
                  <div>
                    <dt>{t.address}</dt>
                    <dd>{name(clinic, 'address')}</dd>
                  </div>
                  <div>
                    <dt>{t.phone}</dt>
                    <dd>
                      <a href={`tel:${clinic.phone.replace(/\s/g, '')}`} dir="ltr">
                        {clinic.phone}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt>{t.email}</dt>
                    <dd>
                      <a href={`mailto:${clinic.email}`}>{clinic.email}</a>
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </GlassCard>
          <div className={styles.map}>
            {point && (
              <iframe
                title={t.mapTitle}
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${point.lon - 0.006},${point.lat - 0.004},${point.lon + 0.006},${point.lat + 0.004}&layer=mapnik&marker=${point.lat},${point.lon}`}
              />
            )}
            <a className={styles.mapLink} href={mapLink} target="_blank" rel="noopener noreferrer">
              {t.mapLink} <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </section>

      <section className={`wrap ${styles.cta}`}>
        <div>
          <h2>{t.ctaTitle}</h2>
          <p>{t.ctaText}</p>
        </div>
        <div className={styles.ctaActions}>
          <Magnetic href={localePath(locale, '/book')}>
            {t.ctaBook} <span className="flip-rtl" aria-hidden="true">→</span>
          </Magnetic>
          <Link href={localePath(locale, '/assistant')} className={styles.ctaAsk}>
            {t.ctaAsk}
          </Link>
        </div>
      </section>
    </div>
  );
}

/** "Dr. Sarah Mansour" → "SM" (the title "Dr." / "د." is skipped). */
function initials(fullName) {
  return fullName
    .split(' ')
    .filter((word) => !/^(Dr\.|د\.)$/.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
}
