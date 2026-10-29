import { getDictionary, getLocale } from '@/i18n/dictionaries';
import Profile from '@/components/account/Profile';

/** /account/profile — details, language, personal code and "forget me". */
export default async function ProfilePage() {
  const locale = await getLocale();
  const { accountPage } = await getDictionary();
  return <Profile t={accountPage.profile} locale={locale} />;
}
