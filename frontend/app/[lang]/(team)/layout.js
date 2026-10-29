import { Suspense } from 'react';
import { getDashDictionary, getLocale } from '@/i18n/dictionaries';
import Logo from '@/components/brand/Logo';
import DashShell from '@/components/dash/DashShell';

/**
 * Layout for the clinic team: /dashboard/* (staff + owner) and /owner/* (owner + the demo viewer).
 * "(team)" is a route group like "(site)": it keeps the URLs short and gives these pages their own
 * frame (sidebar + top bar) instead of the public header and footer.
 * Everything here is private and loaded in the browser after sign-in, so search engines are told
 * to stay out.
 *
 * Suspense: the frame reads the URL (usePathname). On a page whose address holds an id
 * (/dashboard/patients/[id]) the URL is only known when someone opens it, so Next.js builds the
 * fallback below ahead of time and streams the real frame in when the page is requested.
 */
export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: { default: shell.teamArea, template: `%s · ${shell.brand}` }, robots: { index: false, follow: false } };
}

export default async function TeamLayout({ children }) {
  const locale = await getLocale();
  const words = await getDashDictionary();
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-content-center justify-items-center gap-3 text-ink-2">
          <Logo />
          <p>{words.shell.guardLoading}</p>
        </div>
      }
    >
      <DashShell words={words} locale={locale}>
        {children}
      </DashShell>
    </Suspense>
  );
}
