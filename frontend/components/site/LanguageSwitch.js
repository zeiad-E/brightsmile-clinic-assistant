'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LOCALE_COOKIE, otherLocale } from '@/i18n/config';

/**
 * Switches between English and Arabic while staying on the same page:
 * /en/services ⇄ /ar/services. It also saves the choice in a cookie, so the proxy remembers it
 * the next time the visitor opens the site.
 */
export default function LanguageSwitch({ locale, label, ariaLabel, className = '' }) {
  const pathname = usePathname();
  const target = otherLocale(locale);
  const href = pathname.replace(/^\/(en|ar)(?=\/|$)/, `/${target}`);

  const remember = () => {
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <Link
      href={href}
      onClick={remember}
      hrefLang={target}
      lang={target}
      aria-label={ariaLabel}
      className={`items-center rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-ink-2 transition-colors hover:border-mint hover:text-ink ${className}`}
    >
      {label}
    </Link>
  );
}
