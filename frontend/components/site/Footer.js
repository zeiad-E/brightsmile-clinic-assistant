import Link from 'next/link';
import { cacheLife } from 'next/cache';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import { getClinic } from '@/lib/api/public';
import { summarizeOpeningHours } from '@/lib/format';
import Logo from '@/components/brand/Logo';

/**
 * The public site footer, with live clinic details (hours, address, phone) from the API.
 * 'use cache' makes Next.js build this once and reuse it for an hour, per language, instead of
 * calling the API on every page view.
 */
export default async function Footer() {
  'use cache';
  cacheLife('hours');

  const locale = await getLocale();
  const dict = await getDictionary();
  const clinic = await getClinic();
  const t = dict.footer;

  const hours = clinic?.opening_hours?.length ? summarizeOpeningHours(clinic.opening_hours, locale) : [t.hoursFallback];
  const address = clinic?.[`address_${locale}`];
  const links = [
    { href: localePath(locale, '/services'), label: dict.nav.services },
    { href: localePath(locale, '/about'), label: dict.nav.about },
    { href: localePath(locale, '/assistant'), label: dict.nav.assistant },
    { href: localePath(locale, '/book'), label: dict.nav.book },
    { href: localePath(locale, '/privacy'), label: t.privacy },
  ];

  return (
    <footer className="bg-night text-sm leading-relaxed text-white/70">
      <div className="wrap grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <Logo className="size-6" color="var(--color-mint-light)" />
            {dict.brand}
          </p>
          <p className="mt-3 max-w-[30ch]">{t.tagline}</p>
        </div>

        <div>
          <h2 className="eyebrow text-mint-light">{t.hoursTitle}</h2>
          <ul className="mt-3 space-y-1">
            {hours.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="eyebrow text-mint-light">{t.visitTitle}</h2>
          <address className="mt-3 space-y-1 not-italic">
            {address && <p>{address}</p>}
            {clinic?.phone && (
              <p>
                <a href={`tel:${clinic.phone.replace(/\s/g, '')}`} dir="ltr" className="text-mint-light hover:underline">
                  {clinic.phone}
                </a>
              </p>
            )}
            {clinic?.email && (
              <p>
                <a href={`mailto:${clinic.email}`} className="text-mint-light hover:underline">
                  {clinic.email}
                </a>
              </p>
            )}
          </address>
        </div>

        <nav aria-label={t.linksTitle}>
          <h2 className="eyebrow text-mint-light">{t.linksTitle}</h2>
          <ul className="mt-3 space-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="wrap py-5 text-xs text-white/45">
          © {new Date().getFullYear()} {dict.clinicName}. {t.rights}
        </p>
      </div>
    </footer>
  );
}
