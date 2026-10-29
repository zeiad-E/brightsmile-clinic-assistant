import { getDashDictionary } from '@/i18n/dictionaries';
import Doctors from '@/components/dash/screens/Doctors';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.doctors };
}

/** /owner/doctors — O3: doctor profiles, treatments and weekly hours. */
export default function Page() {
  return <Doctors />;
}
