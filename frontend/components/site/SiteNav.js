'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { localePath } from '@/i18n/config';
import { buttonClasses } from '@/components/ui/ButtonLink';
import { useSession } from '@/components/providers/SessionProvider';
import LanguageSwitch from './LanguageSwitch';

/**
 * The interactive part of the header (a client component, because it needs the browser):
 * highlights the current page, opens/closes the mobile menu, and shows "Sign in" or the
 * signed-in person's area.
 */
export default function SiteNav({ locale, links, bookHref, labels }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // While the menu is open: Escape closes it, and the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <nav aria-label={labels.nav} className="ms-auto hidden items-center gap-6 text-sm md:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive(link.href) ? 'page' : undefined}
            className="relative py-1 text-ink-2 transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-0.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-mint"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="ms-auto flex items-center gap-3 md:ms-0">
        <LanguageSwitch locale={locale} label={labels.switchLanguage} ariaLabel={labels.switchLanguageLabel} className="hidden sm:inline-flex" />
        <AccountLink locale={locale} labels={labels} className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline" />
        <Link href={bookHref} className={buttonClasses({ variant: 'dark', size: 'sm' })}>
          {labels.book}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? labels.closeMenu : labels.openMenu}
          className="grid size-10 place-items-center rounded-full text-ink md:hidden"
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {/* Mobile menu: slides down under the header on small screens. */}
      <div
        id="mobile-menu"
        hidden={!open}
        className="fixed inset-x-0 top-16 bottom-0 z-40 animate-menu-in overflow-y-auto bg-page px-6 pt-6 pb-10 md:hidden"
      >
        <nav aria-label={labels.nav} className="flex flex-col">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className="border-b border-line py-4 text-2xl font-bold tracking-tight aria-[current=page]:text-mint-deep"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <AccountLink locale={locale} labels={labels} className={buttonClasses({ variant: 'ghost', size: 'lg' })} />
          <LanguageSwitch locale={locale} label={labels.switchLanguage} ariaLabel={labels.switchLanguageLabel} />
        </div>
      </div>
    </>
  );
}

/** "Sign in" for visitors; "My account" for patients; "Dashboard" for the clinic team. */
function AccountLink({ locale, labels, className }) {
  const { status, user } = useSession();

  if (status === 'signed-in') {
    const isPatient = user.role === 'patient';
    return (
      <Link href={localePath(locale, isPatient ? '/account' : '/dashboard')} className={className}>
        {isPatient ? labels.myAccount : labels.dashboard}
      </Link>
    );
  }
  return (
    <Link
      href={localePath(locale, '/login')}
      className={`${className} transition-opacity ${status === 'loading' ? 'opacity-0' : 'opacity-100'}`}
    >
      {labels.signIn}
    </Link>
  );
}

function MenuIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d={open ? 'M6 6l12 12' : 'M4 7h16'} className="transition-all duration-300" />
      <path d={open ? 'M18 6L6 18' : 'M4 17h16'} className="transition-all duration-300" />
    </svg>
  );
}
