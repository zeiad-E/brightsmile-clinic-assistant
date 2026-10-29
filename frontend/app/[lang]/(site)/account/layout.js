import { getDictionary, getLocale } from '@/i18n/dictionaries';
import AccountShell from '@/components/account/AccountShell';

/**
 * /account/* — the signed-in patient's area. A nested layout: the greeting and tabs stay on screen
 * while only the page below them changes. The data is private, so it's loaded in the browser.
 */

export async function generateMetadata() {
  const { accountPage: t } = await getDictionary();
  return { title: t.title, robots: { index: false } };
}

export default async function AccountLayout({ children }) {
  const locale = await getLocale();
  const { accountPage: t } = await getDictionary();
  return (
    <AccountShell t={t} locale={locale}>
      {children}
    </AccountShell>
  );
}
