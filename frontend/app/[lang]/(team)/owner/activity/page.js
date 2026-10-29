import { getDashDictionary } from '@/i18n/dictionaries';
import ActivityLog from '@/components/dash/screens/ActivityLog';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.activity };
}

/** /owner/activity — O8: who changed what, and the emails sent. */
export default function Page() {
  return <ActivityLog />;
}
