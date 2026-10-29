import { getDashDictionary } from '@/i18n/dictionaries';
import Conversations from '@/components/dash/screens/Conversations';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.conversations };
}

/** /dashboard/conversations — S5: every chat, live ones, take over, review, report mistakes. */
export default function Page() {
  return <Conversations />;
}
