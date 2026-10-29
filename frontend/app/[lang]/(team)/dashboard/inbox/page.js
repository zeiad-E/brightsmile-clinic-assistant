import { getDashDictionary } from '@/i18n/dictionaries';
import Inbox from '@/components/dash/screens/Inbox';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.inbox };
}

/** /dashboard/inbox — S4: what the assistant handed to a human; reply and resolve. */
export default function Page() {
  return <Inbox />;
}
