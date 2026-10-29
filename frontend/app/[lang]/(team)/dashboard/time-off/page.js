import { getDashDictionary } from '@/i18n/dictionaries';
import TimeOff from '@/components/dash/screens/TimeOff';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.timeOff };
}

/** /dashboard/time-off — S6: holidays and blocked hours. */
export default function Page() {
  return <TimeOff />;
}
