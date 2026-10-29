import { getDictionary, getLocale } from '@/i18n/dictionaries';
import Conversations from '@/components/account/Conversations';

/** /account/chats — past conversations with the assistant, read-only. */
export default async function MyConversationsPage() {
  const locale = await getLocale();
  const { accountPage } = await getDictionary();
  return <Conversations t={accountPage.chats} locale={locale} />;
}
