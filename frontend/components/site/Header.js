import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import Logo from '@/components/brand/Logo';
import SiteNav from './SiteNav';

/**
 * The public site header. A server component: it reads the words for the current language on the
 * server and hands them to SiteNav, the small interactive part that runs in the browser.
 */
export default async function Header() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const t = dict.nav;

  const links = [
    { href: localePath(locale, '/services'), label: t.services },
    { href: localePath(locale, '/about'), label: t.about },
    { href: localePath(locale, '/assistant'), label: t.assistant },
  ];

  return (
    // No backdrop-blur here: a blurred parent becomes the frame for `position: fixed` children, which
    // squeezed the mobile menu into the 64px header (and trial 003 found blur makes the 3D hero stutter).
    <header className="sticky top-0 z-50 h-16 border-b border-line/80 bg-page/95">
      <div className="wrap flex h-full items-center gap-7">
        <Link href={localePath(locale)} className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <Logo />
          {dict.brand}
        </Link>
        <SiteNav
          locale={locale}
          links={links}
          bookHref={localePath(locale, '/book')}
          labels={{
            nav: t.label,
            book: t.book,
            signIn: t.signIn,
            myAccount: t.myAccount,
            dashboard: t.dashboard,
            openMenu: t.openMenu,
            closeMenu: t.closeMenu,
            switchLanguage: t.switchLanguage,
            switchLanguageLabel: t.switchLanguageLabel,
          }}
        />
      </div>
    </header>
  );
}
