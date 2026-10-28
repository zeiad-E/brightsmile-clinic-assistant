import { cacheLife } from 'next/cache';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import { getClinic, getDoctors, getNextFreeSlot, getServices } from '@/lib/api/public';
import { describeSlot, formatPrice, shortName, summarizeOpeningHours } from '@/lib/format';
import HomeEffects from '@/components/home/HomeEffects';
import Hero from '@/components/home/Hero';
import Story from '@/components/home/Story';
import Portal from '@/components/home/Portal';
import Services from '@/components/home/Services';
import XRay from '@/components/home/XRay';
import Journey from '@/components/home/Journey';
import AssistantDemo from '@/components/home/AssistantDemo';
import UnderTheHood from '@/components/home/UnderTheHood';
import BookSlot from '@/components/home/BookSlot';
import styles from '@/components/home/Home.module.css';

/**
 * The home page (trial 003, rebuilt in Next.js). A server component: it gathers the words and the
 * live clinic data on the server, shapes them, and hands each animated section only what it needs.
 */

// The booking card shows the next free teeth-whitening slot, as in the trial's design.
const FEATURED_SERVICE = 'whitening';

export default async function HomePage() {
  const locale = await getLocale();
  const { home: t } = await getDictionary();
  const [clinic, services, doctors] = await Promise.all([getClinic(), getServices(), getDoctors()]);
  const name = (record, field) => record[`${field}_${locale}`];

  // "Dental clinic · Sat–Thu, 10 AM – 6 PM", from the live opening hours
  const hours = clinic?.opening_hours?.length ? summarizeOpeningHours(clinic.opening_hours, locale)[0].replace(' · ', locale === 'ar' ? '، ' : ', ') : null;
  const eyebrow = hours ? `${t.eyebrow} · ${hours}` : t.eyebrow;

  // Service cards: who does each one ("Dr. Sarah · Dr. Karim", or the full name if only one person does it)
  const cards = services.map((service) => {
    const team = doctors.filter((d) => d.service_ids.includes(service.id)).map((d) => name(d, 'full_name'));
    return {
      slug: service.slug,
      name: name(service, 'name'),
      minutes: service.duration_minutes.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US'),
      who: team.length === 1 ? team[0] : team.map(shortName).join(' · '),
      price: formatPrice(service.price_egp, locale),
    };
  });

  // The next free slot (live), for the hero chip and the booking card
  const featured = services.find((s) => s.slug === FEATURED_SERVICE);
  const slot = await nextSlotCard(locale, featured, doctors, t);

  return (
    <div className={styles.home}>
      <HomeEffects />
      <Hero
        t={t}
        arabic={locale === 'ar'}
        eyebrow={eyebrow}
        nextSlot={slot?.chip}
        bookHref={localePath(locale, '/book')}
        askHref={localePath(locale, '/assistant')}
      />
      <Story beats={t.story} />
      <Portal t={t.portal} />
      <Services t={t.services} services={cards} />
      <XRay t={t.xray} />
      <Journey t={t.journey} />
      <AssistantDemo t={t.assistant} />
      <UnderTheHood t={t.stack} />
      <BookSlot t={t.bookSlot} slot={slot} assistantHref={localePath(locale, '/assistant')} />
    </div>
  );
}

/**
 * The next free slot, ready to display ({ chip, when, dayWord, … } or null).
 * Cached for about a minute: it says "today" or "tomorrow", which depend on the current time, so
 * Next.js must not freeze it into the page forever ('use cache' + cacheLife sets how long it lives).
 */
async function nextSlotCard(locale, service, doctors, t) {
  'use cache';
  cacheLife('minutes');
  const next = await getNextFreeSlot(service?.id);
  const doctor = next && doctors.find((d) => d.id === next.staff_id);
  if (!next || !service || !doctor) return null;

  const when = describeSlot(next.starts_at, locale, t.bookSlot);
  const query = new URLSearchParams({ service: service.slug, doctor: doctor.id, start: next.starts_at });
  const digits = locale === 'ar' ? 'ar-EG' : 'en-US';
  return {
    chip: when.short,
    when: when.long,
    dayWord: when.dayWord,
    service: service[`name_${locale}`],
    doctor: doctor[`full_name_${locale}`],
    duration: `${service.duration_minutes.toLocaleString(digits)} ${t.services.min}`,
    price: formatPrice(service.price_egp, locale),
    href: `${localePath(locale, '/book')}?${query}`,
  };
}
