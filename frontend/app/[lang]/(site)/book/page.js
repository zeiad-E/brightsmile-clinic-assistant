import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { getDoctors, getServices } from '@/lib/api/public';
import { formatPrice } from '@/lib/format';
import BookWizard from '@/components/book/BookWizard';
import styles from '@/components/book/Book.module.css';

/**
 * /en/book · /ar/book — the booking wizard. The page prepares the treatments and doctors on the
 * server (cached); the steps, free times and booking happen in the browser (BookWizard).
 */

export async function generateMetadata() {
  const { bookPage: t } = await getDictionary();
  return { title: t.title };
}

export default async function BookPage() {
  const locale = await getLocale();
  const { bookPage: t, aboutPage } = await getDictionary();
  const [services, doctors] = await Promise.all([getServices(), getDoctors()]);
  const name = (record, field) => record[`${field}_${locale}`];
  const digits = locale === 'ar' ? 'ar-EG' : 'en-US';

  const serviceCards = services.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: name(s, 'name'),
    minutes: s.duration_minutes.toLocaleString(digits),
    price: formatPrice(s.price_egp, locale),
  }));
  const doctorCards = doctors.map((d) => {
    const fullName = name(d, 'full_name');
    return {
      id: d.id,
      name: fullName,
      role: aboutPage[d.title] ?? d.title,
      service_ids: d.service_ids,
      initials: fullName
        .split(' ')
        .filter((w) => !/^(Dr\.|د\.)$/.test(w))
        .slice(0, 2)
        .map((w) => w[0])
        .join(''),
    };
  });

  return (
    <div className={styles.page}>
      <div className={`wrap ${styles.layout}`}>
        <div className={styles.intro}>
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">{t.heading}</h1>
        </div>
        <div className="fade-up [animation-delay:200ms]">
          <BookWizard services={serviceCards} doctors={doctorCards} t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
