import { Geist, Geist_Mono, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { dirOf, locales } from '@/i18n/config';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import SessionProvider from '@/components/providers/SessionProvider';
import '../globals.css';

/**
 * The root layout: the <html> and <body> every page shares, in both languages.
 * It sits inside app/[lang]/, so it knows the language and sets lang="ar" dir="rtl" itself:
 * the page arrives from the server already flipped, with no flash of the wrong direction.
 */

// next/font downloads the fonts at build time and serves them from our own site (no Google request
// from the visitor's browser). Geist has no Arabic letters, so Arabic text falls back to Plex Arabic.
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
});

// Both languages are built ahead of time (needed because the language is part of every URL).
export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata() {
  const dict = await getDictionary();
  return {
    title: { default: dict.meta.title, template: `%s · ${dict.meta.short}` },
    description: dict.meta.description,
  };
}

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const dict = await getDictionary();

  return (
    <html
      lang={locale}
      dir={dirOf(locale)}
      className={`${geist.variable} ${geistMono.variable} ${plexArabic.variable} antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-page font-sans text-ink">
        <a href="#main" className="skip-link">
          {dict.common.skipToContent}
        </a>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
