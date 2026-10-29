import { getDashDictionary } from '@/i18n/dictionaries';
import Appointments from '@/components/dash/screens/Appointments';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.appointments };
}

/** /dashboard/appointments — S2: list and week calendar, book, cancel, move, mark done / no-show. */
export default function Page() {
  return <Appointments />;
}
