import { getDashDictionary } from '@/i18n/dictionaries';
import Today from '@/components/dash/screens/Today';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.today };
}

/** /dashboard — S1 Today: the day at a glance, per-doctor timeline, quick actions. */
export default function Page() {
  return <Today />;
}
